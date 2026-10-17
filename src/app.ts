// ============================================================
// ExamApp：应用组装层（控制器）—— UI 与测试共用的唯一入口
// 依赖全部注入（KernelApiClient / StorageAdapter），headless 可驱动
// ============================================================
import { KernelApiClient, KernelError } from "./kernel/client";
import type { StorageAdapter } from "./core/attemptLog";
import { AttemptLog } from "./core/attemptLog";
import type { AttemptEvent, Question, ReplayResult, WrongItem, SessionState } from "./core/types";
import { replay, activeWrongItems } from "./core/replayer";
import { reportDateKey, reportWindowStart } from "./core/reportWindow";
import { PracticeSession, pickRandom, groupAdjacent } from "./core/session";
import { randomSeedId, seededPickN } from "./core/random";
import { inferAnswerSpec } from "./core/structuredAnswer";
import { appendRevision, specChanged, type QuestionRevision, type RevisionStore } from "./core/revision";
import { interleaveGroups } from "./core/interleave";
import { deckNameForBank, selfRatingToRiffRating, pickSameKp, cramQueue, dailySet, questionToFlashCardMarkdown } from "./core/memory";
import { SaveGate } from "./core/saveGate";
import { normalizeAnswer, questionHash } from "./core/answer";
import { questionToMarkdown } from "./core/blockTemplate";
import { SAMPLE_BANK_NAME, SAMPLE_BANK_INTRO, sampleQuestions } from "./core/sampleBank";
import { BATCH_FIELD_ATTR, type BatchField } from "./core/batchEdit";
import { auditAttemptEvents, type DataAuditReport } from "./core/dataAudit";
import { emitExamEvent } from "./core/bus";
import type { CheckinEventInput } from "./core/checkinBridge";
import type { MockRunSnapshot } from "./core/mock";
import {
  appendActions,
  completeAction,
  cancelAction,
  openActions,
  type ActionItem,
  type ActionKind,
} from "./core/actions";
import type { ImportReport } from "./importer/pipeline";
import { sanitizeRichHtml } from "./libs/sanitize";
import {
  canCopyIntoAssets,
  assetsPathFor,
  attachLocation,
  kindFromFileName,
  parseRegistry,
  registerMaterial,
  removeMaterial,
  serializeRegistry,
  resolveMaterialUrl,
  EMPTY_REGISTRY,
  type MaterialDoc,
  type MaterialRegistry,
} from "./core/materials";
import {
  addNote,
  deleteNote,
  updateNote,
  notesOfMaterial,
  parseNoteStore,
  serializeNoteStore,
  EMPTY_NOTE_STORE,
  type MaterialNote,
  type MaterialNoteStore,
  type NoteInput,
  type NoteLocator,
} from "./core/materialNotes";
import {
  dropMaterial as dropMaterialLinks,
  linkQuestion,
  parseLinkStore,
  questionsOfMaterial,
  refOf,
  serializeLinkStore,
  unlinkQuestion,
  EMPTY_LINK_STORE,
  type MaterialLinkStore,
  type QuestionMaterialRef,
} from "./core/materialLinks";
import {
  addMisdiagnosis,
  latestOf,
  markAdopted,
  parseMisdiagnosis,
  serializeMisdiagnosis,
  EMPTY_MISDIAGNOSIS,
  type MisdiagnosisRecord,
  type MisdiagnosisStore,
} from "./core/misdiagnosis";
import {
  parseSyllabus,
  parseSyllabusDoc,
  serializeSyllabus,
  EMPTY_SYLLABUS,
  type SyllabusDoc,
  type SyllabusMeta,
  type SyllabusNode,
} from "./core/syllabus";

/** ArrayBuffer → base64（分块拼接，避免大文件 String.fromCharCode 展开栈溢出） */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export interface BankInfo {
  id: string;
  name: string;
  createdAt: number;
  /** 显式创建的演示库；pending 允许写入失败后继续，ready 时只打开已有题库。 */
  sampleState?: "pending" | "ready";
  /** 写入前持久化目标文档和题目身份，重试不依赖异步 SQL 索引。 */
  sampleHomeDocId?: string;
  sampleDocId?: string;
  sampleQuestionIds?: Record<string, string>;
}

export interface MockRecord {
  id: string; // 蓝图 id
  /** 本次考试运行 id（r-…；与蓝图分离，同蓝图多次考试互不覆盖；旧记录无此字段） */
  runId?: string;
  name: string;
  startedAt: number;
  total: number;
  full: number;
  percent: number;
  pass: boolean;
  /** 分模块明细（历史详情回看；旧记录无此字段需容错） */
  sections?: { name: string; score: number; full: number; correct: number; total: number }[];
  /** 55-06 lite：累计延时秒（单次条件覆盖；成绩分组比较时"同卷不同条件"的明示依据；旧记录无此字段） */
  extraTimeS?: number;
}

const MOCK_RESULTS_KEY = "mock/results";

/** 已知插件存储键（69-01 lite 盘点口径；docs/02 附录 B 的运行时子集） */
const KNOWN_STORAGE_KEYS = [
  "banks",
  "attempts/log",
  "wrongbook/overlays",
  "wrongbook/reasons",
  "actions/items",
  "mock/blueprint",
  "mock/results",
  "mock/run",
  "session/active",
  "ai/usage",
  "ai/review-queue",
  "ai/task-log",
  "ai/explain-history",
  "ai/misdiagnosis",
  "estimate/history",
  "import/mappings",
  "browse/smartViews",
  "batchedit/last",
  "materials/registry",
  "materials/notes",
  "materials/qrefs",
  "syllabus/tree",
  "kp/relations",
];

export interface ExamAppDeps {
  client: KernelApiClient;
  storage: StorageAdapter;
  now?: () => number;
}

const BANK_REGISTRY_KEY = "banks";
const SESSION_KEY = "session/active";
const WRONG_REASON_KEY = "wrongbook/reasons";
/** 43-01 lite：题目修订时间线（revision.ts 存储键） */
const REVISIONS_KEY = "revisions";
const MOCK_RUN_KEY = "mock/run";
const ACTIONS_KEY = "actions/items";
const MATERIALS_KEY = "materials/registry";
const MATERIAL_NOTES_KEY = "materials/notes";
const MATERIAL_QREFS_KEY = "materials/qrefs";
const MISDIAGNOSIS_KEY = "ai/misdiagnosis";
const SYLLABUS_KEY = "syllabus/tree";

/** 过期草稿（TODO 2.4）：7 天隐藏不再续做入口，30 天清理（流水保留） */
const DRAFT_HIDE_MS = 7 * 86_400_000;
const DRAFT_DROP_MS = 30 * 86_400_000;

/** 导入提交回执（U08）：读回确认只认真实读回的 qid；verified=false = 未能核实（离线/读回失败） */
export interface ImportCommitResult {
  written: number;
  docs: string[];
  readback: { confirmed: string[]; missing: string[]; verified: boolean };
  /** 用户取消时保留已写文档；missing 含所有尚未确认的题，便于安全重试。 */
  cancelled?: boolean;
  /** 尚未进入写入步骤的题目；与已提交但未读回的题目区分。 */
  unprocessed?: string[];
}

export class ExamApp {
  readonly attempts: AttemptLog;
  private deckNameCache = new Map<string, { id: string; ts: number }>();
  private dueCardsCache = new Map<string, { due: Set<string>; ts: number }>();
  /** 对象级保存确认（Q2/U06）：每个持久化目标独立状态，顶栏可定位失败对象 */
  readonly saves = new SaveGate();
  private replayCache: ReplayResult | null = null;
  private banks: BankInfo[] = [];
  private sampleBankCreation: Promise<BankInfo> | null = null;
  private materialsRegistry: MaterialRegistry = EMPTY_REGISTRY;
  private materialsVersionTooNew = false;
  private materialNoteStore: MaterialNoteStore = EMPTY_NOTE_STORE;
  private materialLinkStore: MaterialLinkStore = EMPTY_LINK_STORE;
  private misdiagnosisStore: MisdiagnosisStore = EMPTY_MISDIAGNOSIS;
  private syllabus: SyllabusDoc = EMPTY_SYLLABUS;
  private syllabusTooNew = false;
  private activeSession: PracticeSession | null = null;
  private mockRunSaveTail: Promise<void> = Promise.resolve();
  /** 本地存储按键串行化：读改写操作不能互相覆盖（双击/多窗口同步时保留最后一次完整快照）。 */
  private readonly storageWriteTails = new Map<string, Promise<void>>();
  /** 读取失败与“键不存在”必须区分；出现读取错误时阻止后续写入覆盖未知的磁盘数据。 */
  readonly storageReadErrors = new Map<string, string>();
  kernelOnline = false;
  probeMessage = "";
  /** 最近一次内核故障；保留分类让 UI 能区分离线、授权、权限和校验错误。 */
  lastKernelError: KernelError | null = null;

  get storageReadonly(): boolean {
    return this.storageReadErrors.size > 0;
  }

  /** UI-only auxiliary data still goes through the same read/write gate as
   * core stores. This keeps drafts, queues and preferences from racing or
   * overwriting an unreadable snapshot. */
  async loadAux<T>(key: string): Promise<T | undefined> {
    try {
      const value = (await this.deps.storage.load(key)) as T | undefined;
      this.storageReadErrors.delete(key);
      return value;
    } catch (error) {
      this.noteStorageReadError(key, error);
      throw error;
    }
  }

  async saveAux<T>(key: string, value: T | null): Promise<void> {
    this.assertStorageWritable();
    await this.queueStorageWrite(key, () => this.saves.runLatest(key, () => this.deps.storage.save(key, value)));
  }

  private noteStorageReadError(key: string, error: unknown) {
    this.storageReadErrors.set(key, error instanceof Error ? error.message : String(error));
  }

  private assertStorageWritable() {
    if (this.storageReadonly) throw new Error("插件数据读取失败，已暂停写入以避免覆盖原有数据；请重载思源后重试。");
  }

  /** 将同一键的读改写操作排队；失败不会阻塞后续重试，也不会让旧快照覆盖新快照。 */
  private queueStorageWrite(key: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.storageWriteTails.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.storageWriteTails.set(key, next);
    const cleanup = () => {
      if (this.storageWriteTails.get(key) === next) this.storageWriteTails.delete(key);
    };
    // Handle both fulfillment and rejection on the cleanup branch. Using
    // `void next.finally(...)` alone creates a second rejected promise when a
    // write fails, surfacing as an unhandled page error even when the caller
    // catches the original write promise to show a recoverable UI message.
    void next.then(cleanup, cleanup);
    return next;
  }

  /** 运行时连接标记（传输层 retryable 失败/恢复时回调；启动初值由探针设定） */
  setKernelOnline(ok: boolean) {
    if (this.kernelOnline === ok) return;
    this.kernelOnline = ok;
    if (ok) this.lastKernelError = null;
    emitExamEvent("kernel-connection", { online: ok });
  }

  setKernelError(error: KernelError) {
    this.lastKernelError = error;
    // Fatal endpoint responses (auth/permission/validation/not-found) prove
    // the host is reachable; only retryable transport failures are offline.
    if (error.kind !== "fatal") this.kernelOnline = false;
    emitExamEvent("kernel-connection", { online: this.kernelOnline, category: error.category, code: error.code, message: error.message });
  }

  /** 面向用户的宿主恢复指引；插件不拥有思源 token，因此不伪造登录跳转。 */
  kernelRecoveryHint(): string {
    switch (this.lastKernelError?.category) {
      case "auth": return "思源当前会话未授权，请先在思源中完成登录/解锁后重试。";
      case "permission": return "当前思源会话没有执行此操作的权限，请切换到有权限的工作区或检查只读状态。";
      case "not-found": return "思源未找到目标接口或数据，可能是版本不兼容；请重载插件后重试。";
      case "validation": return "提交的数据不符合思源接口要求，请检查输入后重试。";
      case "network": return "思源内核暂时不可达，请确认思源仍在运行后重试。";
      default: return "思源内核暂时不可用，请重试；若持续失败请重载插件。";
    }
  }

  constructor(readonly deps: ExamAppDeps) {
    this.attempts = new AttemptLog(deps.storage, "attempts/log", deps.now ?? (() => Date.now()));
  }

  /** 启动：能力探测 → 流水加载 → 重算 → 会话恢复（任何一步失败都不阻塞后续） */
  async init(deviceId?: string): Promise<void> {
    try {
      const probe = await this.deps.client.probe();
      this.kernelOnline = probe.kernelOk;
      this.lastKernelError = probe.kernelOk ? null : new KernelError("retryable", "probe", "内核不可达");
      this.probeMessage = probe.kernelOk
        ? `内核 ${probe.version} · md2html ${probe.md2html ? "✓" : "✗"} · SQL ${probe.query ? "✓" : "✗"} · riff ${probe.riff ? "✓" : "✗"}`
        : "内核不可达：将显示离线降级界面";
    } catch {
      this.kernelOnline = false;
      this.probeMessage = "内核不可达：离线降级";
    }
    try {
      await this.attempts.load(deviceId);
    } catch (e) {
      this.noteStorageReadError("attempts/log", e);
    }
    try {
      await this.loadWrongOverlay();
    } catch (e) {
      this.noteStorageReadError("wrongbook/overlays", e);
    }
    try {
      await this.loadWrongReasons();
    } catch (e) {
      this.noteStorageReadError(WRONG_REASON_KEY, e);
    }
    try {
      await this.loadWrongReflections();
    } catch (e) {
      this.noteStorageReadError("wrongbook/reflections", e);
    }
    this.invalidate();
    try {
      const banks = await this.deps.storage.load(BANK_REGISTRY_KEY);
      if (Array.isArray(banks)) this.banks = banks as BankInfo[];
    } catch (e) {
      this.noteStorageReadError(BANK_REGISTRY_KEY, e);
    }
    // 学习资料注册表（120-01）：损坏/过版本时以空表继续（versionTooNew 标记如实显示，不回写覆盖）
    try {
      const parsed = parseRegistry(await this.deps.storage.load(MATERIALS_KEY));
      this.materialsRegistry = parsed.registry;
      this.materialsVersionTooNew = parsed.versionTooNew;
    } catch (e) {
      this.noteStorageReadError(MATERIALS_KEY, e);
    }
    // 资料笔记（121-03/122-03）：同口径容错
    try {
      const parsedNotes = parseNoteStore(await this.deps.storage.load(MATERIAL_NOTES_KEY));
      this.materialNoteStore = parsedNotes.store;
    } catch (e) {
      this.noteStorageReadError(MATERIAL_NOTES_KEY, e);
    }
    // 题目↔资料关联（120-05 lite）
    try {
      const parsedLinks = parseLinkStore(await this.deps.storage.load(MATERIAL_QREFS_KEY));
      this.materialLinkStore = parsedLinks.store;
    } catch (e) {
      this.noteStorageReadError(MATERIAL_QREFS_KEY, e);
    }
    // AI 错因假设（116-01/U14：与用户复盘分层独立保存）
    try {
      const parsedMis = parseMisdiagnosis(await this.deps.storage.load(MISDIAGNOSIS_KEY));
      this.misdiagnosisStore = parsedMis.store;
    } catch (e) {
      this.noteStorageReadError(MISDIAGNOSIS_KEY, e);
    }
    // 考纲对照（51-01/03 lite）
    try {
      const parsedSyl = parseSyllabusDoc(await this.deps.storage.load(SYLLABUS_KEY));
      this.syllabus = parsedSyl.doc;
      this.syllabusTooNew = parsedSyl.versionTooNew;
    } catch (e) {
      this.noteStorageReadError(SYLLABUS_KEY, e);
    }
  }

  // ---------- 题库 ----------
  listBanks(): BankInfo[] {
    return [...this.banks];
  }

  /** 题库注册表保存：同 key 的后续快照排队，避免旧 banks 覆盖新增/删除结果。 */
  private saveBankRegistry(): Promise<void> {
    this.assertStorageWritable();
    return this.saves.runLatest(BANK_REGISTRY_KEY, () =>
      this.deps.storage.save(
        BANK_REGISTRY_KEY,
        this.banks.map((b) => ({ ...b, sampleQuestionIds: b.sampleQuestionIds ? { ...b.sampleQuestionIds } : undefined })),
      ),
    );
  }

  /** 新建题库一键流程（2.2 P0）：笔记本 + 首页 + 章节骨架 + 示例题文档（真实入库，建完即可练）。
   *  骨架失败不阻断建库：逐段 try，返回 info 时尽力而为（部分骨架缺失可后续手动补/重导）。 */
  async createBank(name: string): Promise<BankInfo> {
    this.assertStorageWritable();
    const clean = name.trim();
    if (!clean) throw new Error("题库名不能为空");
    const notebookId = await this.deps.client.createNotebook(`题库/${clean}`);
    const info: BankInfo = { id: notebookId, name: clean, createdAt: Date.now() };
    try {
      await this.deps.client.createDocWithMd(
        notebookId,
        "/首页",
        `# 题库：${clean}\n\n> 本笔记本由小驴考试（内测版）管理。章节文档存放题目块。\n> 可在练习台导入题目，或删除「示例题」文档后自建章节。\n`,
      );
    } catch { /* 首页失败不阻断 */ }
    // 章节骨架：按官方模板的考点分层示例（47-02 首五分钟任务的最短路径）
    try {
      const docId = await this.deps.client.createDocWithMd(
        notebookId,
        "/示例题",
        `# 示例题\n\n> 体验用：可直接开始练习/转闪卡；正式使用前可整篇删除。\n`,
      );
      const { makeQuestion } = await import("./core/blockTemplate");
      const samples = [
        makeQuestion({ type: "single", stem: "小驴考试（内测版）的作答流水保存在哪里？", options: ["插件本地的 append-only 流水存储", "思源云端", "题目块的 custom-exam-* 属性里"], answer: "A", analysis: "作答流水 append-only 存于插件存储，与题目块解耦（docs/02 §2.3）。", kp: "示例/基础" }),
        makeQuestion({ type: "judge", stem: "错题连对 2 次后自动移出错题本。", options: [], answer: "对", kp: "示例/机制" }),
        makeQuestion({ type: "fill", stem: "FSRS 调度唯一需要理解的参数是期望____率。", options: [], answer: "保留", kp: "示例/记忆" }),
      ];
      if (docId) await this.deps.client.appendQuestions(docId, samples);
    } catch { /* 示例题失败不阻断建库 */ }
    const previous = this.banks;
    this.banks = [...previous, info];
    try {
      await this.saveBankRegistry();
    } catch (e) {
      this.banks = previous;
      throw e;
    }
    return info;
  }

  /** 用户主动创建示例题库；同一应用的并发点击共享任务，重复打开不补回已删除的示例。 */
  createSampleBank(): Promise<BankInfo> {
    if (this.sampleBankCreation) return this.sampleBankCreation;
    this.sampleBankCreation = this.writeSampleBank().finally(() => { this.sampleBankCreation = null; });
    return this.sampleBankCreation;
  }

  private async writeSampleBank(): Promise<BankInfo> {
    this.assertStorageWritable();
    if (!this.kernelOnline) throw new Error("思源内核未连接，请恢复连接后再创建示例题库。");
    let info = this.banks.find((bank) => bank.name === SAMPLE_BANK_NAME && bank.sampleState);
    if (info?.sampleState === "ready") return info;
    if (!info) {
      const notebookId = await this.deps.client.createNotebook(`题库/${SAMPLE_BANK_NAME}`);
      info = { id: notebookId, name: SAMPLE_BANK_NAME, createdAt: Date.now(), sampleState: "pending" };
      // 先注册真实笔记本，后续失败可在同一库继续，不会再次新建笔记本。
      this.banks.push(info);
    }
    await this.saveBankRegistry();
    try {
      if (!info.sampleHomeDocId) {
        info.sampleHomeDocId = await this.ensureDoc(info.id, "/首页", SAMPLE_BANK_INTRO);
        await this.saveBankRegistry();
      }
      if (!info.sampleDocId) {
        info.sampleDocId = await this.ensureDoc(info.id, "/示例题", SAMPLE_BANK_INTRO.replace(/^# .*\n/, "# 示例题\n"));
        await this.saveBankRegistry();
      }
      const docId = info.sampleDocId;
      if (!docId) throw new Error("未取得示例题文档 ID");
      const plannedIds = info.sampleQuestionIds ??= {};
      const planned = sampleQuestions().map((q) => ({ ...q, id: plannedIds[q.hash] ??= q.id }));
      // 必须在插题前落盘：请求写入成功但回执丢失、或插件重启时仍可沿用同一身份。
      await this.saveBankRegistry();
      const kramdown = await this.deps.client.getBlockKramdown(docId);
      if (!kramdown) throw new Error("未读取到示例题文档原文，请恢复连接后重试");
      const existingIds = new Set(Array.from(kramdown.matchAll(/\bcustom-exam-id="([^"]+)"/g), ([, id]) => id));
      const missing = planned.filter((q) => !existingIds.has(q.id));
      if (missing.length) {
        const written = await this.deps.client.appendQuestions(docId, missing);
        const confirmed = new Set(written.filter((item) => item.blockId).map((item) => item.qid));
        if (missing.some((q) => !confirmed.has(q.id))) {
          // SiYuan may commit every nested row while returning only a partial
          // doOperations list for one insertBlock request. Confirm the source
          // document before reporting an unknown write result or retrying.
          const afterWrite = await this.deps.client.getBlockKramdown(docId);
          const persisted = new Set(Array.from((afterWrite ?? "").matchAll(/\bcustom-exam-id="([^"]+)"/g), ([, id]) => id));
          if (missing.some((q) => !persisted.has(q.id))) throw new Error("未收到全部示例题的写入回执");
        }
      }
      info.sampleState = "ready";
      try {
        await this.saveBankRegistry();
      } catch (e) {
        info.sampleState = "pending";
        throw e;
      }
      return info;
    } catch (e) {
      throw Object.assign(new Error(`示例题库已保留，题目写入尚未完成。请点击「示例题库」重试：${e instanceof Error ? e.message : String(e)}`), { cause: e });
    }
  }

  async removeBank(id: string): Promise<boolean> {
    this.assertStorageWritable();
    const before = this.banks.length;
    const previous = this.banks;
    this.banks = this.banks.filter((b) => b.id !== id);
    if (this.banks.length !== before) {
      try {
        await this.saveBankRegistry();
      } catch (e) {
        this.banks = previous;
        throw e;
      }
      return true;
    }
    return false;
  }

  /** 导入提交：按考点落章节文档（无考点 → "导入/<批次>"），返回写入数与真实读回清单（U08）。
   *  onProgress 逐文档回传 (已处理, 总数)；isCancelled 在文档间检查，取消时如实返回 partial。
   *  取消不回滚已写文档（batch 可在题库健康面板整批撤销），written 只计真实写出的题。 */
  async commitImport(
    bankId: string,
    report: ImportReport,
    opts?: { onProgress?: (done: number, total: number) => void; isCancelled?: () => boolean },
  ): Promise<ImportCommitResult> {
    if (!report.ok.length) return { written: 0, docs: [], readback: { confirmed: [], missing: [], verified: false } };
    const uniqueQuestions = [...new Map(report.ok.map((q) => [q.id, q])).values()];
    const expected = uniqueQuestions.map((q) => q.id);
    const knownIds = new Set<string>();
    let indexedReadSucceeded = false;
    if (this.kernelOnline) {
      try {
        for (const q of await this.listQuestions(bankId)) knownIds.add(q.id);
        indexedReadSucceeded = true;
      } catch { /* 索引读取失败时仍可核对目标题文档原文；不能把失败当作空题库。 */ }
    }
    const readDocumentIds = async (docId: string): Promise<string[] | null> => {
      // 旧客户端兼容；当前思源客户端始终提供原文接口。
      if (typeof this.deps.client.getBlockKramdown !== "function") return null;
      const raw = await this.deps.client.getBlockKramdown(docId);
      if (!raw) throw new Error("未读取到导入文档原文，请恢复连接后重试。");
      return Array.from(raw.matchAll(/\bcustom-exam-id="([^"]+)"/g), ([, id]) => id);
    };
    const byDoc = new Map<string, typeof report.ok>();
    for (const q of uniqueQuestions) {
      const doc = q.kp ? `/${q.kp.split("/")[0]}` : `/导入/${report.batch}`;
      if (!byDoc.has(doc)) byDoc.set(doc, []);
      byDoc.get(doc)!.push(q);
    }
    const total = expected.length;
    let processed = 0;
    let cancelled = false;
    const processedIds = new Set<string>();
    const submittedIds = new Set<string>();
    const writtenIds = new Set<string>();
    const docs: string[] = [];
    const docIds: string[] = [];
    for (const [doc, qs] of byDoc) {
      if (opts?.isCancelled?.()) {
        cancelled = true;
        break;
      }
      const docId = await this.ensureDoc(bankId, doc);
      if (!docId) throw new Error("未取得导入文档 ID，请稍后重试。");
      const existing = await readDocumentIds(docId);
      if (existing) {
        for (const id of existing) knownIds.add(id);
      } else if (!indexedReadSucceeded) {
        throw new Error("无法核对已导入题目，请恢复连接后重试。");
      }
      const pending = qs.filter((q) => !knownIds.has(q.id));
      for (const q of pending) submittedIds.add(q.id);
      const writtenBlocks = pending.length ? await this.deps.client.appendQuestions(docId, pending) : [];
      // 54-01 lite：结构化作答规则随导入写入块属性（custom-exam-answer-spec）——往返不丢；失败不影响题目入库
      for (const { qid, blockId } of writtenBlocks) {
        if (!blockId || !pending.some((q) => q.id === qid)) continue;
        writtenIds.add(qid);
        knownIds.add(qid);
        const spec = pending.find((q) => q.id === qid)?.answerSpec;
        if (!spec) continue;
        try {
          await this.deps.client.setExamAttrs(blockId, { "exam-answer-spec": JSON.stringify(spec) });
        } catch { /* spec 写失败不影响题目入库；读回时该题按旧口径判分（如实降级） */ }
      }
      processed += qs.length;
      for (const q of qs) processedIds.add(q.id);
      docs.push(doc);
      docIds.push(docId);
      opts?.onProgress?.(processed, total);
    }
    this.invalidate();
    // 3.8.5 实测：IAL 属性入 attributes 表有 1-3s 异步索引滞后，
    // 立即 listQuestions 会查不到刚导入的题 → 轮询到账后再返回
    if (this.kernelOnline) {
      for (let i = 0; i < 6; i++) {
        if (i) await new Promise((r) => setTimeout(r, 700));
        try {
          const indexed = new Set((await this.listQuestions(bankId)).map((q) => q.id));
          indexedReadSucceeded = true;
          for (const id of indexed) {
            knownIds.add(id);
            if (submittedIds.has(id)) writtenIds.add(id);
          }
          if ([...processedIds].every((id) => indexed.has(id))) break;
        } catch {
          /* 索引未就绪，继续等 */
        }
      }
    }
    // 读回确认（U08）：完成页只认真实读回的 qid；读回失败如实报告"未核实"，不冒充成功。
    // 写入回执不能代替读回：原文可补足 attributes 的索引延迟。
    const confirmedIds = new Set<string>();
    let readback: ImportCommitResult["readback"] = { confirmed: [], missing: expected, verified: false };
    if (this.kernelOnline) {
      let verified = false;
      try {
        for (const q of await this.listQuestions(bankId)) confirmedIds.add(q.id);
        verified = true;
      } catch { /* 继续核对目标文档原文。 */ }
      let documentsVerified = docIds.length > 0;
      for (const docId of docIds) {
        try {
          const ids = await readDocumentIds(docId);
          if (!ids) documentsVerified = false;
          else for (const id of ids) confirmedIds.add(id);
        } catch { documentsVerified = false; }
      }
      for (const id of confirmedIds) if (submittedIds.has(id)) writtenIds.add(id);
      readback = {
        confirmed: expected.filter((id) => confirmedIds.has(id)),
        missing: expected.filter((id) => !confirmedIds.has(id)),
        verified: verified || documentsVerified,
      };
    }
    const written = writtenIds.size;
    const unprocessed = expected.filter((id) => !processedIds.has(id) && !confirmedIds.has(id));
    return cancelled ? { written, docs, readback, cancelled, unprocessed } : { written, docs, readback };
  }

  private async ensureDoc(bankId: string, hpath: string, markdown?: string): Promise<string> {
    // createDocWithMd 幂等：已存在返回 ""（思源行为）——先查再建；
    // 建后重查一次：与思源日记自动建档存在竞态时 createDocWithMd 可能返回 ""
    // 而真实文档由宿主创建（真机走查实测出现同 hpath 双文档块，写入静默落空）
    const existing = await this.deps.client.sql(
      `SELECT id FROM blocks WHERE box='${bankId.replace(/'/g, "''")}' AND hpath='${hpath.replace(/'/g, "''")}' AND type='d' ORDER BY updated DESC LIMIT 1`,
    );
    if (existing[0]?.id) return String(existing[0].id);
    const created = await this.deps.client.createDocWithMd(bankId, hpath, markdown ?? `# ${hpath.split("/").pop()}\n\n`);
    if (created) return created;
    const again = await this.deps.client.sql(
      `SELECT id FROM blocks WHERE box='${bankId.replace(/'/g, "''")}' AND hpath='${hpath.replace(/'/g, "''")}' AND type='d' ORDER BY updated DESC LIMIT 1`,
    );
    return String(again[0]?.id ?? "");
  }

  async listQuestions(bankId: string): Promise<(Question & { blockId: string; rootId: string; hpath: string })[]> {
    return this.deps.client.listQuestions(bankId);
  }

  /** 块菜单直通（2.2）：按 blockId 在各题库定位题目；离线返回 null（调用方降级提示） */
  async findQuestionByBlock(
    blockId: string,
  ): Promise<{ q: Question & { blockId: string; rootId: string; hpath: string }; bank: BankInfo } | null> {
    if (!blockId || !this.kernelOnline) return null;
    for (const bank of this.listBanks()) {
      try {
        const q = (await this.listQuestions(bank.id)).find((x) => x.blockId === blockId);
        if (q) return { q, bank };
      } catch {
        /* 该库读取失败 → 试下一个 */
      }
    }
    return null;
  }

  // ---------- 章节树（TODO 2.2：notebook→doc→heading 数据源） ----------
  async docTree(bankId: string) {
    return this.deps.client.docTree(bankId);
  }

  // ---------- 题目编辑（43-01 lite：块菜单「编辑」→ 浏览视图内联表单 → updateBlock 整块重写） ----------
  /** 标记考点（块菜单直通）：写 custom-exam-kp 并同步本地缓存对象 */
  async markQuestionKp(q: Question & { blockId?: string }, kp: string): Promise<void> {
    if (q.blockId && this.kernelOnline) {
      await this.saves.run(`mark-kp/${q.blockId}`, () => this.deps.client.setExamAttrs(q.blockId!, { "exam-kp": kp }));
    }
    q.kp = kp || undefined;
  }

  /** 题目内容编辑（stem/options/answer/analysis/kp/difficulty）：updateBlock 全量重写超级块，
   *  exam-id IAL 不变即身份不变；写后 kramdown 读回核验 exam-id 仍在（丢失则抛错，不冒充成功） */
  async updateQuestionContent(
    q: Question & { blockId: string },
    draft: {
      stem: string;
      options: string[];
      answer: string;
      analysis: string;
      kp: string;
      difficulty?: number;
      /** 54-02 作者规格：显式提供时优先生效并写块属性；未提供走既有推断/保留规则 */
      answerSpec?: import("./core/structuredAnswer").NumericAnswerSpec | import("./core/structuredAnswer").MultiBlankSpec | null;
    },
  ): Promise<Question> {
    if (!this.kernelOnline) throw new Error("离线：题目编辑需要内核可写");
    const answer = q.type === "material" ? "" : normalizeAnswer(q.type, draft.answer) ?? draft.answer;
    const next: Question = {
      ...q,
      stem: draft.stem,
      options: draft.options.map((o) => o.trim()).filter(Boolean),
      answer,
      analysis: draft.analysis || undefined,
      kp: draft.kp || undefined,
      difficulty: draft.difficulty,
      hash: questionHash(draft.stem, draft.options),
    };
    const oldMarkdown = questionToMarkdown(q);
    try {
      await this.saves.run(`edit-q/${q.blockId}`, () =>
        this.deps.client.updateBlock(q.blockId, questionToMarkdown(next)),
      );
      const kd = await this.deps.client.getBlockKramdown(q.blockId);
      if (!kd.includes(`exam-id="${q.id}"`) && !kd.includes(`exam-id='${q.id}'`)) {
        throw new Error("编辑读回异常：题目身份（exam-id）丢失");
      }
    } catch (error) {
      // The block update is a real write. If its read-back fails, restore the
      // previous markdown before surfacing the error so the UI and host cannot
      // silently diverge.
      try {
        await this.saves.run(`edit-q-rollback/${q.blockId}`, () => this.deps.client.updateBlock(q.blockId, oldMarkdown));
      } catch (rollbackError) {
        throw Object.assign(new Error(`题目编辑失败且回滚失败，请保留当前页面并重载思源后核对：${String(rollbackError)}`), { cause: error });
      }
      throw Object.assign(new Error(`题目编辑失败，已恢复编辑前内容：${error instanceof Error ? error.message : String(error)}`), { cause: error });
    }
    // 54/63-03：规格同步。优先级：作者显式规格 > 答案变更重推断 > 不触碰。
    // （陈旧 spec 会让新答案全判错；填空答案改为不可识别文本 → 清空属性回旧字符串口径）
    let specWasChanged = false;
    if (q.type === "fill" && draft.answerSpec !== undefined) {
      next.answerSpec = draft.answerSpec;
      specWasChanged = specChanged(q.answerSpec, draft.answerSpec);
      try {
        await this.deps.client.setExamAttrs(q.blockId, {
          "exam-answer-spec": draft.answerSpec ? JSON.stringify(draft.answerSpec) : "",
        });
      } catch (error) {
        // The answer specification changes grading semantics. A successful
        // block write with a failed attribute write is not a valid commit.
        try { await this.saves.run(`edit-q-rollback/${q.blockId}`, () => this.deps.client.updateBlock(q.blockId, oldMarkdown)); }
        catch (rollbackError) { throw Object.assign(new Error(`答案规格写入失败且回滚失败：${String(rollbackError)}`), { cause: error }); }
        throw Object.assign(new Error(`答案规格写入失败，已恢复编辑前内容：${error instanceof Error ? error.message : String(error)}`), { cause: error });
      }
    } else if (q.type === "fill" && answer !== q.answer) {
      const spec = inferAnswerSpec("fill", answer);
      specWasChanged = specChanged(q.answerSpec, spec);
      next.answerSpec = spec;
      try {
        await this.deps.client.setExamAttrs(q.blockId, {
          "exam-answer-spec": spec ? JSON.stringify(spec) : "",
        });
      } catch (error) {
        try { await this.saves.run(`edit-q-rollback/${q.blockId}`, () => this.deps.client.updateBlock(q.blockId, oldMarkdown)); }
        catch (rollbackError) { throw Object.assign(new Error(`答案规格写入失败且回滚失败：${String(rollbackError)}`), { cause: error }); }
        throw Object.assign(new Error(`答案规格写入失败，已恢复编辑前内容：${error instanceof Error ? error.message : String(error)}`), { cause: error });
      }
    }
    // 43-01 lite：修订时间线快照（答案/考点变更才记；每题 FIFO 10 条）
    if (answer !== q.answer || (draft.kp.trim() || undefined) !== q.kp || specWasChanged) {
      try {
        await this.appendRevision(q.id, {
          ts: this.deps.now?.() ?? Date.now(),
          answer,
          kp: draft.kp.trim() || undefined,
          specChanged: specWasChanged || undefined,
        });
      } catch (error) {
        // Revision history is part of the edit receipt. Roll back the block
        // (and answer spec when applicable) if its durable snapshot fails.
        try {
          await this.saves.run(`edit-q-rollback/${q.blockId}`, () => this.deps.client.updateBlock(q.blockId, oldMarkdown));
          if (q.type === "fill") {
            await this.deps.client.setExamAttrs(q.blockId, {
              "exam-answer-spec": q.answerSpec ? JSON.stringify(q.answerSpec) : "",
            });
          }
        } catch (rollbackError) {
          throw Object.assign(new Error(`修订记录保存失败且题目回滚失败：${String(rollbackError)}`), { cause: error });
        }
        throw Object.assign(new Error(`修订记录保存失败，已恢复编辑前内容：${error instanceof Error ? error.message : String(error)}`), { cause: error });
      }
    }
    return next;
  }

  private revisionCache: RevisionStore | null = null;

  /** 修订时间线（43-01 lite）：读缓存 + 惰性加载 */
  async questionRevisions(qid: string): Promise<QuestionRevision[]> {
    if (!this.revisionCache) {
      this.revisionCache = (await this.loadAux<RevisionStore>(REVISIONS_KEY)) ?? {};
    }
    return this.revisionCache[qid] ?? [];
  }

  private async appendRevision(qid: string, entry: QuestionRevision): Promise<void> {
    await this.queueStorageWrite(REVISIONS_KEY, async () => {
      if (!this.revisionCache) {
        this.revisionCache = (await this.loadAux<RevisionStore>(REVISIONS_KEY)) ?? {};
      }
      const previous = this.revisionCache;
      this.revisionCache = appendRevision(this.revisionCache, qid, entry);
      try {
        await this.saves.runLatest(REVISIONS_KEY, () => this.deps.storage.save(REVISIONS_KEY, this.revisionCache));
      } catch (e) {
        this.revisionCache = previous;
        throw e;
      }
    });
  }

  // ---------- 流水与派生 ----------
  recordAttempt(input: Parameters<AttemptLog["append"]>[0]): AttemptEvent {
    this.invalidate();
    return this.attempts.append(input);
  }

  /** 派生视图（缓存；写流水后失效） */
  derived(): ReplayResult {
    if (!this.replayCache) this.replayCache = replay(this.attempts.all());
    return this.replayCache;
  }

  wrongItems(): WrongItem[] {
    const overlay = this.wrongOverlay;
    const now = this.deps.now?.() ?? Date.now();
    const items = activeWrongItems(this.derived());
    if (!overlay.size) return items;
    // 手动处置覆盖层：按错次计数判断时效——处置后发生更新的错误（wrongCount 增长）自动清除覆盖；
    // 暂缓（52-06 lite）：until 未到期在册隐藏，到期或期间再错自动回册
    return items.filter((w) => {
      const o = overlay.get(w.qid);
      if (!o) return true;
      if (w.wrongCount > o.wrongCount) return true; // 处置后再错 → 覆盖失效
      if (o.status === "snoozed") return (o.until ?? 0) <= now; // 暂缓：到期回册
      return false; // mastered/removed 覆盖生效
    });
  }

  /** 手动处置（docs/02 附录 A）：mastered=已掌握 / removed=永久移除；此后更新的错误自动清覆盖 */
  async setWrongStatus(qid: string, status: "mastered" | "removed" | "active"): Promise<void> {
    this.assertStorageWritable();
    const key = "wrongbook/overlays";
    await this.queueStorageWrite(key, async () => {
      const current = this.derived().wrongbook.get(qid);
      const v = await this.loadAux<Record<string, { status: string; at: number; wrongCount: number; until?: number }>>(key);
      const previous = this.wrongOverlay;
      const map = { ...(v ?? {}) };
      if (status === "active") delete map[qid];
      else map[qid] = { status, at: this.deps.now?.() ?? Date.now(), wrongCount: current?.wrongCount ?? 0 };
      try {
        await this.saves.runLatest(key, () => this.deps.storage.save(key, map));
        this.wrongOverlay = new Map(Object.entries(map));
        this.invalidate();
      } catch (e) {
        this.wrongOverlay = previous;
        throw e;
      }
    });
    emitExamEvent("wrongbook-changed", { qid, status }); // 48-02 lite：生态消费者按需重读
  }

  /** 顽固题暂缓（52-06 lite）：days 天内不进错题重练/每日计划，到期自动回册；期间再错立即回册 */
  async snoozeWrong(qid: string, days = 7): Promise<void> {
    if (!Number.isFinite(days) || days < 1 || days > 3650) throw new Error("暂缓天数应为 1–3650 的有限数字");
    this.assertStorageWritable();
    const key = "wrongbook/overlays";
    await this.queueStorageWrite(key, async () => {
      const current = this.derived().wrongbook.get(qid);
      const v = await this.loadAux<Record<string, { status: string; at: number; wrongCount: number; until?: number }>>(key);
      const previous = this.wrongOverlay;
      const map = { ...(v ?? {}) };
      const at = this.deps.now?.() ?? Date.now();
      map[qid] = { status: "snoozed", at, wrongCount: current?.wrongCount ?? 0, until: at + days * 86_400_000 };
      try {
        await this.saves.runLatest(key, () => this.deps.storage.save(key, map));
        this.wrongOverlay = new Map(Object.entries(map));
        this.invalidate();
      } catch (e) {
        this.wrongOverlay = previous;
        throw e;
      }
    });
    emitExamEvent("wrongbook-changed", { qid, status: "snoozed" });
  }

  // ---------- 错题自诊断（52-04 lite）：个人复盘短模板，与官方解析分离存储 ----------
  /** 保存自诊断复盘（覆盖式：一次一份当前检查点；官方解析与作答流水不受影响） */
  async saveWrongReflection(qid: string, text: string): Promise<void> {
    this.assertStorageWritable();
    const key = "wrongbook/reflections";
    await this.queueStorageWrite(key, async () => {
      const v = await this.loadAux<Record<string, { text: string; at: number }>>(key);
      const previous = this.wrongReflections;
      const map = { ...(v ?? {}) };
      const trimmed = text.trim();
      if (!trimmed) delete map[qid];
      else map[qid] = { text: trimmed, at: this.deps.now?.() ?? Date.now() };
      try {
        await this.saves.runLatest(key, () => this.deps.storage.save(key, map));
        this.wrongReflections = map;
      } catch (e) {
        this.wrongReflections = previous;
        throw e;
      }
    });
  }

  /** 读取自诊断复盘（52-04 验收：复习能回看上次检查点） */
  async loadWrongReflection(qid: string): Promise<{ text: string; at: number } | null> {
    const v = (this.wrongReflections[qid] ?? null) as { text: string; at: number } | null;
    return v;
  }

  private wrongReflections: Record<string, { text: string; at: number }> = {};

  private async loadWrongReflections(): Promise<void> {
    const v = await this.loadAux<Record<string, { text: string; at: number }>>("wrongbook/reflections");
    this.wrongReflections = v ?? {};
  }

  private wrongOverlay = new Map<string, { status: string; at: number; wrongCount: number; until?: number }>();

  private async loadWrongOverlay(): Promise<void> {
    const v = await this.loadAux<Record<string, { status: string; at: number; wrongCount: number; until?: number }>>("wrongbook/overlays");
    this.wrongOverlay = new Map(Object.entries(v ?? {}));
  }

  /** 错因（单键 map；计划加权回流的数据源） */
  private wrongReasons = new Map<string, "careless" | "unknown" | "trap">();

  async saveWrongReason(qid: string, reason: "careless" | "unknown" | "trap"): Promise<void> {
    this.assertStorageWritable();
    await this.queueStorageWrite(WRONG_REASON_KEY, async () => {
      const map = { ...((await this.loadAux<Record<string, { reason: string; at: number }>>(WRONG_REASON_KEY)) ?? {}) };
      const previous = this.wrongReasons;
      map[qid] = { reason, at: this.deps.now?.() ?? Date.now() };
      try {
        await this.saves.runLatest(WRONG_REASON_KEY, () => this.deps.storage.save(WRONG_REASON_KEY, map));
        this.wrongReasons = new Map(Object.entries(map).map(([k, v]) => [k, v.reason as "careless" | "unknown" | "trap"]));
        this.invalidate();
      } catch (e) {
        this.wrongReasons = previous;
        throw e;
      }
    });
  }

  async loadWrongReason(qid: string): Promise<string | undefined> {
    const map = await this.loadAux<Record<string, { reason?: string }>>(WRONG_REASON_KEY);
    return map?.[qid]?.reason;
  }

  private async loadWrongReasons(): Promise<void> {
    const map = await this.loadAux<Record<string, { reason?: string }>>(WRONG_REASON_KEY);
    this.wrongReasons = new Map(
      Object.entries(map ?? {})
        .filter((e): e is [string, { reason: "careless" | "unknown" | "trap" }] => !!e[1]?.reason)
        .map(([k, v]) => [k, v.reason]),
    );
  }

  /** 错因快照（计划引擎加权用；只读） */
  wrongReasonMap(): Map<string, "careless" | "unknown" | "trap"> {
    return new Map(this.wrongReasons);
  }

  private invalidate() {
    this.replayCache = null;
  }

  async flush(): Promise<void> {
    await this.attempts.flush();
  }

  // ---------- 下一行动（U15 lite：持久化 + 去重 + 状态可回看） ----------
  private async loadActions(): Promise<ActionItem[]> {
    try {
      const v = await this.loadAux<ActionItem[]>(ACTIONS_KEY);
      return Array.isArray(v) ? (v as ActionItem[]) : [];
    } catch (error) {
      this.noteStorageReadError(ACTIONS_KEY, error);
      throw error;
    }
  }

  private async saveActions(list: ActionItem[]): Promise<void> {
    this.assertStorageWritable();
    await this.saves.runLatest(ACTIONS_KEY, () => this.deps.storage.save(ACTIONS_KEY, list));
  }

  /** 加入行动（同 kind+qid 去重）；返回实际新增与跳过数 */
  async addActions(
    drafts: { kind: ActionKind; qid?: string; sessionId?: string; detail: string }[],
  ): Promise<{ added: number; skipped: number }> {
    let result = { added: 0, skipped: 0 };
    await this.queueStorageWrite(ACTIONS_KEY, async () => {
      const list = await this.loadActions();
      const r = appendActions(list, drafts, this.deps.now?.() ?? Date.now());
      result = { added: r.added, skipped: r.skipped };
      if (r.added) await this.saveActions(r.list);
    });
    return result;
  }

  async listOpenActions(): Promise<ActionItem[]> {
    return openActions(await this.loadActions());
  }

  /** 完成（用户确认为最小证据）；幂等 */
  async completeAction(id: string, evidence = "user-confirmed"): Promise<void> {
    await this.queueStorageWrite(ACTIONS_KEY, async () => {
      const list = await this.loadActions();
      await this.saveActions(completeAction(list, id, evidence, this.deps.now?.() ?? Date.now()));
    });
  }

  /** 取消/暂缓（保留记录）；幂等 */
  async cancelAction(id: string): Promise<void> {
    await this.queueStorageWrite(ACTIONS_KEY, async () => {
      const list = await this.loadActions();
      await this.saveActions(cancelAction(list, id, this.deps.now?.() ?? Date.now()));
    });
  }

  // ---------- 会话（单活动） ----------
  currentSession(): PracticeSession | null {
    return this.activeSession;
  }

  async startSession(
    questions: Question[],
    mode: string,
    bankId?: string,
    opts?: { interleave?: boolean; seed?: string },
  ): Promise<PracticeSession> {
    if (this.activeSession && this.activeSession.phase === "running") {
      throw new Error("已有进行中的会话：请先继续或放弃");
    }
    // 材料组排序（44-03 lite）：分块连排（默认，groupAdjacent）/ 交错打散（interleaveGroups，
    // 防同材料组连续出现）；策略写入会话状态，结算页如实显示
    const ordered = opts?.interleave ? interleaveGroups(questions) : groupAdjacent(questions);
    this.activeSession = new PracticeSession(ordered, mode, undefined, this.deps.now ?? (() => Date.now()));
    if (bankId) this.activeSession.state.bankId = bankId; // 37-05：会话归属题库
    this.activeSession.state.order = opts?.interleave ? "interleaved" : "adjacent";
    // 65-05 lite：seed 随 checkpoint 持久化（同 seed+同候选池=同卷序；结算页展示复现标识）
    this.activeSession.state.seed = opts?.seed ?? randomSeedId();
    await this.saveSession();
    return this.activeSession;
  }

  /** 最近一次 resume 剔除的缺失题（题库已删/读不到；UI 据此提示，37-05） */
  lastResumeMissing: string[] = [];

  /** 恢复（含启动时）：questionLoader 负责按 qids 补题面；
   *  过期草稿（2.4）：>7 天隐藏（返回 null 但保留），>30 天清理存储；
   *  37-05：bankId 不匹配不跨库恢复；缺题如实剔除并记入 lastResumeMissing */
  async resumeSession(
    questionLoader: (qids: string[]) => Promise<Question[]>,
    expectedBankId?: string,
  ): Promise<PracticeSession | null> {
    this.lastResumeMissing = [];
    if (this.activeSession?.phase === "running") {
      const bankId = this.activeSession.state.bankId;
      return bankId && expectedBankId && bankId !== expectedBankId ? null : this.activeSession;
    }
    try {
      const saved = await this.loadAux<SessionState>(SESSION_KEY);
      if (!saved?.qids?.length || saved.finishedAt) return null;
      if (saved.bankId && expectedBankId && saved.bankId !== expectedBankId) return null; // 跨库不串
      const now = this.deps.now ?? Date.now;
      const age = now() - (saved.updatedAt || saved.startedAt);
      if (age > DRAFT_DROP_MS) {
        await this.saves.runLatest(SESSION_KEY, () => this.deps.storage.save(SESSION_KEY, null));
        return null;
      }
      if (age > DRAFT_HIDE_MS) return null;
      const found = await questionLoader(saved.qids);
      // 缺题如实剔除（删题/读不到），不用其他题顶替
      const foundIds = new Set(found.map((q) => q.id));
      this.lastResumeMissing = saved.qids.filter((id) => !foundIds.has(id));
      // 每个卷面位置独立映射，不能按 qid 去重：答错排到队尾会让同一道题出现两次。
      const positions = new Map<number, number>();
      const qids: string[] = [];
      saved.qids.forEach((id, pos) => {
        if (!foundIds.has(id)) return;
        positions.set(pos, qids.length);
        qids.push(id);
      });
      if (!qids.length) return null;
      const sanitized: SessionState = this.lastResumeMissing.length ? {
        ...saved,
        qids,
        // 当前题删除时落到下一道保留题；前方删除题目时保持原当前题，末尾可保持完成位置。
        cursor: [...positions.keys()].filter((pos) => pos < saved.cursor).length,
        answered: saved.answered?.flatMap((a) => {
          const pos = positions.get(a.pos);
          return pos == null || saved.qids[a.pos] !== a.qid ? [] : [{ ...a, pos }];
        }),
        drafts: Object.fromEntries(Object.entries(saved.drafts).filter(([id]) => foundIds.has(id))),
        requeued: saved.requeued?.filter((id) => foundIds.has(id)),
      } : saved;
      this.activeSession = new PracticeSession(found, saved.mode, sanitized, now);
      return this.activeSession;
    } catch {
      return null;
    }
  }

  async saveSession(): Promise<void> {
    this.assertStorageWritable();
    const s = this.activeSession;
    if (!s) return;
    if (s.phase === "finished") await this.saves.runLatest(SESSION_KEY, () => this.deps.storage.save(SESSION_KEY, null));
    else {
      // 不直接把可变 state 引用交给存储；下一次答题会改动同一对象。
      const snapshot: SessionState = {
        ...s.state,
        qids: [...s.state.qids],
        drafts: { ...s.state.drafts },
        answered: s.state.answered?.map((a) => ({ ...a })),
        requeued: s.state.requeued ? [...s.state.requeued] : undefined,
      };
      await this.saves.runLatest(SESSION_KEY, () => this.deps.storage.save(SESSION_KEY, snapshot));
    }
  }

  async discardSession(): Promise<void> {
    this.assertStorageWritable();
    const previous = this.activeSession;
    this.activeSession = null;
    try {
      await this.queueStorageWrite(SESSION_KEY, () => this.saves.runLatest(SESSION_KEY, () => this.deps.storage.save(SESSION_KEY, null)));
    } catch (e) {
      this.activeSession = previous;
      throw e;
    }
  }

  /** 手工录题：按考点落文档（无考点 → /手工录入），写块入库 */
  async writeManualQuestion(bankId: string, q: Question): Promise<void> {
    const docId = await this.ensureDoc(bankId, q.kp ? `/${q.kp.split("/")[0]}` : "/手工录入");
    const writtenBlocks = await this.deps.client.appendQuestions(docId, [q]);
    // 54 第三刀：手工录题的数值/多空 spec 与导入同口径写入块属性（失败不影响入库，读回降级）
    const blockId = writtenBlocks[0]?.blockId;
    if (blockId && q.answerSpec) {
      try {
        await this.deps.client.setExamAttrs(blockId, { "exam-answer-spec": JSON.stringify(q.answerSpec) });
      } catch { /* 如实降级：读回按旧口径 */ }
    }
    this.invalidate();
    // IAL 属性入 attributes 表有索引滞后（3.8.5 实测 1-3s），等待到账再返回
    if (this.kernelOnline) {
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 700));
        try {
          if (await this.listQuestions(bankId).then((qs) => qs.some((x) => x.id === q.id))) break;
        } catch {
          /* 继续 等 */
        }
      }
    }
  }

  /** 题目笔记子块（docs/02 §2.4）：kind = mnemonic | note | ai-explain */
  async appendQuestionNote(
    qid: string,
    blockId: string | undefined,
    text: string,
    kind: "mnemonic" | "note" | "ai-explain",
  ): Promise<void> {
    if (!blockId) throw new Error("题目块不存在（先完成导入）");
    const md = `{{{row\n${text}\n}}}\n{: exam-note-id="${qid}-n-${Date.now().toString(36)}" exam-note-kind="${kind}"`;
    await this.deps.client.appendBlock(blockId, md);
  }

  /** 收藏切换（写块属性；本地缓存同步更新避免整表刷新） */
  async toggleFav(q: Question & { blockId?: string }): Promise<boolean> {
    if (!this.kernelOnline) throw new Error("离线：收藏题目需要内核可写");
    const next = !q.fav;
    if (q.blockId) {
      await this.deps.client.setExamFav(q.blockId, next);
    }
    q.fav = next;
    return next;
  }

  /** 批量编辑应用（43-06）：逐题写 custom-exam-* 属性；返回 {ok, failed}。
   *  单题失败不中断批次；离线直接拒绝（调用方已有在线守卫，此为兜底）。 */
  async applyBatchEdit(
    changes: { blockId: string; field: BatchField; to: string }[],
  ): Promise<{ ok: number; failed: number }> {
    if (!this.kernelOnline) throw new Error("离线：批量编辑需要内核可写");
    let ok = 0,
      failed = 0;
    for (const c of changes) {
      try {
        await this.saves.run(`batch-edit/${c.blockId}`, () =>
          this.deps.client.setExamAttrs(c.blockId, { [BATCH_FIELD_ATTR[c.field]]: c.to }),
        );
        ok++;
      } catch {
        failed++;
      }
    }
    return { ok, failed };
  }

  // ---------- 导入批次回滚（TODO 12 组） ----------
  /** 题库内的导入批次清单（batch → 题数），新→旧（最近批次排在最前便于回滚） */
  listBatches(questions: (Question & { batch?: string })[]): { batch: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const q of questions) {
      if (!q.batch || q.origin !== "imported") continue;
      counts.set(q.batch, (counts.get(q.batch) ?? 0) + 1);
    }
    return [...counts.entries()].map(([batch, count]) => ({ batch, count })).reverse();
  }

  /** 撤销整批入库（12 组）：按 custom-exam-batch 定位块并逐块删除；只动题块不动流水。
   *  返回 {deleted, failed}；离线拒绝。真实宿主 deleteBlock 行为待冒烟复核。 */
  async rollbackBatch(bankId: string, batch: string): Promise<{ deleted: number; failed: number }> {
    if (!this.kernelOnline) throw new Error("离线：批次回滚需要内核可写");
    const escaped = batch.replace(/'/g, "''");
    // 分页取全量（3.8.6 默认 64 行截断会让大批次静默漏删）；ORDER BY b.id 保证分页全序
    const rows = await this.deps.client.sqlPaged<{ id?: string }>(
      `SELECT b.id AS id FROM blocks b
       JOIN attributes a ON a.block_id = b.id
       WHERE b.root_id IN (SELECT id FROM blocks WHERE box='${bankId.replace(/'/g, "''")}' AND type='d')
         AND a.name='custom-exam-batch' AND a.value='${escaped}'
       ORDER BY b.id`,
    );
    const ids = rows.map((r) => String(r.id ?? "")).filter(Boolean);
    let deleted = 0,
      failed = 0;
    for (const id of ids) {
      try {
        await this.saves.run(`rollback/${id}`, () => this.deps.client.removeBlock(id));
        deleted++;
      } catch {
        failed++;
      }
    }
    this.invalidate();
    return { deleted, failed };
  }

  // ---------- 存储占用 / 数据体检 / 数据出库（69-01 / 69-06 / 58-01 lite，三十批） ----------
  /** 插件存储占用盘点（69-01 lite）：枚举已知键逐个量大小；额度本体不可知 → 只报占用与缺失，不猜额度 */
  async storageUsage(): Promise<{ key: string; bytes: number; present: boolean; error?: string }[]> {
    const rows: { key: string; bytes: number; present: boolean; error?: string }[] = [];
    for (const key of KNOWN_STORAGE_KEYS) {
      try {
        const v = await this.deps.storage.load(key);
        rows.push({ key, bytes: v === undefined ? 0 : JSON.stringify(v).length, present: v !== undefined });
      } catch (error) {
        // A read error is different from an absent key. Keep it visible so a
        // diagnostics export or UI cannot imply the data was safely empty.
        this.noteStorageReadError(key, error);
        rows.push({ key, bytes: 0, present: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return rows;
  }

  /** 数据体检（69-06 lite，只读）：knownQids = 各已加载题库的题目 id（空集则跳过孤儿检测） */
  auditData(knownQids: Set<string>): DataAuditReport {
    return auditAttemptEvents(this.attempts.all(), knownQids);
  }

  /** 数据出库（58-01 lite）：核心学习资产 JSON（流水/题库注册表/错题处置/错因/行动/资料登记表）。
   *  红线：不含 AI Key（存宿主 getSecret，不在插件 storage）；题干不入包（流水只含 qid）。 */
  async exportAllData(): Promise<string> {
    const [overlays, reasons, actions] = await Promise.all([
      this.loadAux("wrongbook/overlays"),
      this.loadAux("wrongbook/reasons"),
      this.loadAux(ACTIONS_KEY),
    ]);
    return JSON.stringify(
      {
        schema: "lv-exam.export/1",
        exportedAt: new Date().toISOString(),
        banks: this.banks,
        attempts: { v: 2, events: this.attempts.all() },
        wrongbookOverlays: overlays ?? {},
        wrongReasons: reasons ?? {},
        actions: actions ?? [],
        materials: serializeRegistry(this.materialsRegistry),
        materialNotes: serializeNoteStore(this.materialNoteStore),
        materialLinks: serializeLinkStore(this.materialLinkStore),
        misdiagnoses: serializeMisdiagnosis(this.misdiagnosisStore),
        syllabus: serializeSyllabus(this.syllabus),
      },
      null,
      2,
    );
  }

  // ---------- 学习资料（120-01/02/06 lite：登记 / assets 拷贝 / 最低查看） ----------

  listMaterials(): MaterialDoc[] {
    return [...this.materialsRegistry.materials];
  }
  /** 注册表版本比当前代码新（升级回滚场景）：UI 如实显示只读提示，写路径拒绝（不降级覆盖） */
  get materialsReadonly(): boolean {
    return this.materialsVersionTooNew;
  }

  /** 位置解析为可打开 URL（内核 origin 由调用方传入；解析不了返回 null 由 UI 如实显示） */
  resolveMaterialUrlOf(material: MaterialDoc, origin: string): string | null {
    const loc = material.locations[0];
    return loc ? resolveMaterialUrl(loc, origin) : null;
  }

  private async saveMaterialsRegistry(): Promise<void> {
    this.assertStorageWritable();
    await this.saves.runLatest(MATERIALS_KEY, () =>
      this.deps.storage.save(MATERIALS_KEY, serializeRegistry(this.materialsRegistry)),
    );
  }

  /** 文件登记（120-02）：读文件 → 拷入工作区 assets（putFile）→ 注册/归并位置。
   *  大文件不默认全拷贝（120-03）：超 30MB 如实拒绝；离线拒绝（putFile 需要内核）。 */
  async registerMaterialFromFile(
    file: File,
    meta: { subject?: string; chapter?: string; title?: string } = {},
  ): Promise<{ material: MaterialDoc; deduped: boolean }> {
    this.assertStorageWritable();
    this.assertStorageWritable();
    if (this.materialsReadonly) throw new Error("注册表版本较新：只读（降级回滚场景），登记已拒绝");
    if (!this.kernelOnline) throw new Error("离线：登记资料需要内核可写（拷入 assets）");
    const guard = canCopyIntoAssets(file.size);
    if (!guard.ok) throw new Error(guard.reason ?? "文件不可拷入");
    const base64 = arrayBufferToBase64(await file.arrayBuffer());
    const path = assetsPathFor(file.name);
    await this.deps.client.putFile(path, base64);
    const kind = kindFromFileName(file.name);
    const title = meta.title?.trim() || file.name.replace(/\.[^.]+$/, "");
    const result = registerMaterial(
      this.materialsRegistry,
      { title, kind, subject: meta.subject, chapter: meta.chapter, location: { kind: "assets", path } },
      this.deps.now?.() ?? Date.now(),
    );
    const previous = this.materialsRegistry;
    try {
      this.materialsRegistry = result.registry;
      await this.saveMaterialsRegistry();
    } catch (e) {
      this.materialsRegistry = previous;
      throw e;
    }
    return { material: result.material, deduped: result.deduped };
  }

  /** 链接登记（120-02）：稳定 URL（http/https）直接入册，不外发不下载 */
  async registerMaterialFromLink(
    url: string,
    meta: { title?: string; subject?: string; chapter?: string } = {},
  ): Promise<{ material: MaterialDoc; deduped: boolean }> {
    if (this.materialsReadonly) throw new Error("注册表版本较新：只读（降级回滚场景），登记已拒绝");
    const clean = url.trim();
    if (!/^https?:\/\/\S+/i.test(clean)) throw new Error("仅支持 http(s) 链接");
    let name = clean;
    try {
      name = decodeURIComponent(new URL(clean).pathname.split("/").pop() ?? "") || clean;
    } catch { /* URL 解析失败按原文取名 */ }
    const result = registerMaterial(
      this.materialsRegistry,
      {
        title: meta.title?.trim() || name.replace(/\.[^.]+$/, ""),
        kind: kindFromFileName(name),
        subject: meta.subject,
        chapter: meta.chapter,
        location: { kind: "link", path: clean },
      },
      this.deps.now?.() ?? Date.now(),
    );
    const previous = this.materialsRegistry;
    try {
      this.materialsRegistry = result.registry;
      await this.saveMaterialsRegistry();
    } catch (e) {
      this.materialsRegistry = previous;
      throw e;
    }
    return { material: result.material, deduped: result.deduped };
  }

  /** 为既有资料追加位置（同一文件第二份副本/镜像）；重复位置如实返回 deduped 不重复写 */
  async attachMaterialLocation(materialId: string, loc: { kind: "assets" | "link"; path: string }): Promise<{ deduped: boolean }> {
    if (this.materialsReadonly) throw new Error("注册表版本较新：只读（降级回滚场景），变更已拒绝");
    const r = attachLocation(this.materialsRegistry, materialId, loc, this.deps.now?.() ?? Date.now());
    if (!r.material) throw new Error("资料不存在");
    const previous = this.materialsRegistry;
    try {
      this.materialsRegistry = r.registry;
      await this.saveMaterialsRegistry();
    } catch (e) {
      this.materialsRegistry = previous;
      throw e;
    }
    return { deduped: r.deduped };
  }

  /** 移除登记（purgeAssets=true 时尽力删除 assets 附件；失败不阻断——登记移除是主事实） */
  async removeMaterialById(materialId: string, purgeAssets = false): Promise<void> {
    this.assertStorageWritable();
    if (this.materialsReadonly) throw new Error("注册表版本较新：只读（降级回滚场景），移除已拒绝");
    const material = this.materialsRegistry.materials.find((m) => m.id === materialId);
    if (!material) throw new Error("资料不存在");
    const previousRegistry = this.materialsRegistry;
    const previousNotes = this.materialNoteStore;
    const previousLinks = this.materialLinkStore;
    this.materialsRegistry = removeMaterial(this.materialsRegistry, materialId);
    try {
      await this.saveMaterialsRegistry();
    } catch (e) {
      this.materialsRegistry = previousRegistry;
      throw e;
    }
    if (purgeAssets) {
      for (const loc of material.locations) {
        if (loc.kind !== "assets") continue;
        try {
          await this.deps.client.removeFile(loc.path);
        } catch { /* 附件已不在/删除失败：登记移除不受影响，UI 说明保留可能 */ }
      }
    }
    // 资料本体移除 → 其笔记失去归属：一并清除（纯本地数据，无原件副作用），回执由调用方提示
    const orphanCount = notesOfMaterial(this.materialNoteStore, materialId).length;
    if (orphanCount) {
      this.materialNoteStore = { v: 1, notes: this.materialNoteStore.notes.filter((n) => n.materialId !== materialId) };
      try { await this.saveMaterialNotes(); } catch (e) {
        this.materialNoteStore = previousNotes;
        this.materialsRegistry = previousRegistry;
        throw e;
      }
    }
    // 题目↔资料关联同样随资料移除清理（120-05：不残留断链）
    if (questionsOfMaterial(this.materialLinkStore, materialId).length) {
      this.materialLinkStore = dropMaterialLinks(this.materialLinkStore, materialId);
      try {
        await this.saves.runLatest(MATERIAL_QREFS_KEY, () => this.deps.storage.save(MATERIAL_QREFS_KEY, serializeLinkStore(this.materialLinkStore)));
      } catch (e) {
        this.materialLinkStore = previousLinks;
        this.materialsRegistry = previousRegistry;
        throw e;
      }
    }
  }

  // ---------- 资料定位与个人笔记（121-02/03 + 122-02/03 lite） ----------

  listMaterialNotes(materialId: string): MaterialNote[] {
    return notesOfMaterial(this.materialNoteStore, materialId);
  }

  private async saveMaterialNotes(): Promise<void> {
    this.assertStorageWritable();
    await this.saves.runLatest(MATERIAL_NOTES_KEY, () =>
      this.deps.storage.save(MATERIAL_NOTES_KEY, serializeNoteStore(this.materialNoteStore)),
    );
  }

  /** 新增笔记（绑定 materialId+revision；离线也可写——纯插件存储，不动原件） */
  async addMaterialNote(input: NoteInput): Promise<MaterialNote> {
    if (this.materialsReadonly) throw new Error("存储版本较新：只读（降级回滚场景），写入已拒绝");
    const r = addNote(this.materialNoteStore, input, this.deps.now?.() ?? Date.now());
    const previous = this.materialNoteStore;
    this.materialNoteStore = r.store;
    try { await this.saveMaterialNotes(); } catch (e) { this.materialNoteStore = previous; throw e; }
    return r.note;
  }

  async updateMaterialNote(noteId: string, patch: { locator?: NoteLocator | null; text?: string; tags?: string[] }): Promise<MaterialNote> {
    if (this.materialsReadonly) throw new Error("存储版本较新：只读（降级回滚场景），写入已拒绝");
    const r = updateNote(this.materialNoteStore, noteId, patch, this.deps.now?.() ?? Date.now());
    if (!r.note) throw new Error("笔记不存在");
    const previous = this.materialNoteStore;
    this.materialNoteStore = r.store;
    try { await this.saveMaterialNotes(); } catch (e) { this.materialNoteStore = previous; throw e; }
    return r.note;
  }

  async deleteMaterialNote(noteId: string): Promise<void> {
    if (this.materialsReadonly) throw new Error("存储版本较新：只读（降级回滚场景），删除已拒绝");
    const previous = this.materialNoteStore;
    this.materialNoteStore = deleteNote(this.materialNoteStore, noteId);
    try { await this.saveMaterialNotes(); } catch (e) { this.materialNoteStore = previous; throw e; }
  }

  // ---------- 题目↔资料关联（120-05 lite：题目回 PDF 页/视频时间点；资料侧反查题目） ----------

  questionMaterialRef(qid: string): QuestionMaterialRef | null {
    return refOf(this.materialLinkStore, qid);
  }

  listQuestionRefs(materialId: string): QuestionMaterialRef[] {
    return questionsOfMaterial(this.materialLinkStore, materialId);
  }

  /** 关联/改链（一题一主链，改链=替换）；资料须在册，绑定其当前版本 */
  async linkQuestionMaterial(qid: string, materialId: string, locator?: NoteLocator | null): Promise<{ replaced: boolean }> {
    this.assertStorageWritable();
    if (this.materialsReadonly) throw new Error("存储版本较新：只读（降级回滚场景），写入已拒绝");
    const material = this.materialsRegistry.materials.find((m) => m.id === materialId);
    if (!material) throw new Error("资料不存在");
    const r = linkQuestion(
      this.materialLinkStore,
      { qid, materialId, revision: material.revision, locator },
      this.deps.now?.() ?? Date.now(),
    );
    const previous = this.materialLinkStore;
    this.materialLinkStore = r.store;
    try {
      await this.saves.runLatest(MATERIAL_QREFS_KEY, () => this.deps.storage.save(MATERIAL_QREFS_KEY, serializeLinkStore(this.materialLinkStore)));
    } catch (e) {
      this.materialLinkStore = previous;
      throw e;
    }
    return { replaced: r.replaced };
  }

  async unlinkQuestionMaterial(qid: string): Promise<void> {
    this.assertStorageWritable();
    if (this.materialsReadonly) throw new Error("存储版本较新：只读（降级回滚场景），删除已拒绝");
    const r = unlinkQuestion(this.materialLinkStore, qid);
    if (!r.removed) return;
    const previous = this.materialLinkStore;
    this.materialLinkStore = r.store;
    try {
      await this.saves.runLatest(MATERIAL_QREFS_KEY, () => this.deps.storage.save(MATERIAL_QREFS_KEY, serializeLinkStore(this.materialLinkStore)));
    } catch (e) {
      this.materialLinkStore = previous;
      throw e;
    }
  }

  // ---------- AI 错因假设（116-01/U14：独立持久化，与用户复盘分层） ----------

  latestMisdiagnosis(qid: string): MisdiagnosisRecord | null {
    return latestOf(this.misdiagnosisStore, qid);
  }

  /** 生成成功后落库（同题保留最新）；纯本地存储，离线也可写 */
  async saveMisdiagnosis(rec: MisdiagnosisRecord): Promise<void> {
    this.assertStorageWritable();
    if (this.materialsReadonly) throw new Error("存储版本较新：只读（降级回滚场景），写入已拒绝");
    const previous = this.misdiagnosisStore;
    this.misdiagnosisStore = addMisdiagnosis(this.misdiagnosisStore, rec);
    try {
      await this.saves.runLatest(MISDIAGNOSIS_KEY, () => this.deps.storage.save(MISDIAGNOSIS_KEY, serializeMisdiagnosis(this.misdiagnosisStore)));
    } catch (e) {
      this.misdiagnosisStore = previous;
      throw e;
    }
  }

  /** 采纳打点（用户并入复盘时调用；只记时间戳，不改假设原文） */
  async markMisdiagnosisAdopted(qid: string): Promise<void> {
    this.assertStorageWritable();
    if (this.materialsReadonly) throw new Error("存储版本较新：只读（降级回滚场景），写入已拒绝");
    const previous = this.misdiagnosisStore;
    this.misdiagnosisStore = markAdopted(this.misdiagnosisStore, qid, this.deps.now?.() ?? Date.now());
    try {
      await this.saves.runLatest(MISDIAGNOSIS_KEY, () => this.deps.storage.save(MISDIAGNOSIS_KEY, serializeMisdiagnosis(this.misdiagnosisStore)));
    } catch (e) {
      this.misdiagnosisStore = previous;
      throw e;
    }
  }

  // ---------- 考纲对照（51-01/03 lite：粘贴大纲 → 树 → kp 前缀覆盖对照） ----------

  syllabusDoc(): SyllabusDoc {
    return this.syllabus;
  }

  get syllabusReadonly(): boolean {
    return this.syllabusTooNew;
  }

  /** 解析预览（不入库）：文本 → 树 */
  previewSyllabus(text: string): SyllabusNode[] {
    return parseSyllabus(text);
  }

  /** 导入/更新考纲（meta=发行方/年份/来源 51-01 字段） */
  async setSyllabusDoc(meta: SyllabusMeta, roots: SyllabusNode[]): Promise<void> {
    this.assertStorageWritable();
    if (this.syllabusTooNew) throw new Error("考纲存储版本较新：只读（降级回滚场景），写入已拒绝");
    if (!roots.length) throw new Error("考纲为空（解析后无节点）");
    const previous = this.syllabus;
    this.syllabus = { v: 1, meta, roots, importedAt: this.deps.now?.() ?? Date.now() };
    try {
      await this.saves.runLatest(SYLLABUS_KEY, () => this.deps.storage.save(SYLLABUS_KEY, serializeSyllabus(this.syllabus)));
    } catch (e) {
      this.syllabus = previous;
      throw e;
    }
  }

  /** 清除插件数据（58-03 lite）：逐键置空并返回逐对象回执（不冒充全部删除）。
   *  边界：思源笔记本/题块本体不动；内存态重载后归零；已外发 AI 数据无法撤回（UI 说明）。 */
  async purgeAllData(): Promise<{ key: string; ok: boolean }[]> {
    this.assertStorageWritable();
    const receipts: { key: string; ok: boolean }[] = [];
    const cleared = new Set<string>();
    for (const key of KNOWN_STORAGE_KEYS) {
      try {
        await this.queueStorageWrite(key, () => this.saves.runLatest(key, () => this.deps.storage.save(key, null)));
        receipts.push({ key, ok: true });
        cleared.add(key);
      } catch {
        receipts.push({ key, ok: false });
      }
    }
    if (cleared.has(BANK_REGISTRY_KEY)) this.banks = [];
    if (cleared.has(MATERIALS_KEY)) this.materialsRegistry = EMPTY_REGISTRY;
    if (cleared.has(MATERIAL_NOTES_KEY)) this.materialNoteStore = EMPTY_NOTE_STORE;
    if (cleared.has(MATERIAL_QREFS_KEY)) this.materialLinkStore = EMPTY_LINK_STORE;
    if (cleared.has(MISDIAGNOSIS_KEY)) this.misdiagnosisStore = EMPTY_MISDIAGNOSIS;
    if (cleared.has(SYLLABUS_KEY)) this.syllabus = EMPTY_SYLLABUS;
    if (cleared.has("wrongbook/overlays")) this.wrongOverlay = new Map();
    if (cleared.has(WRONG_REASON_KEY)) this.wrongReasons = new Map();
    if (cleared.has("wrongbook/reflections")) this.wrongReflections = {};
    if (cleared.has(REVISIONS_KEY)) this.revisionCache = {};
    if (cleared.has(SESSION_KEY)) this.activeSession = null;
    this.invalidate();
    return receipts;
  }

  // ---------- 打卡桥待重试（48-03：失败保留原 externalRef，不换新引用） ----------
  /** 38-03 更新式重导：按 hash 定位库内题，只覆盖答案/解析/别名属性（题干/选项/流水不动）。
   *  返回逐题回执；existing 缺失的更新计 missing（库内找不到=已删除，不猜测） */
  async applyAnswerUpdates(
    updates: { row: number; q: Question }[],
    existing: (Question & { blockId: string })[],
    opts?: { isCancelled?: () => boolean; onProgress?: (done: number, total: number) => void },
  ): Promise<{ ok: number; failed: number; missing: number; unprocessed?: number }> {
    if (!this.kernelOnline) throw new Error("离线：更新已有题需要内核可写");
    const byHash = new Map(existing.map((q) => [q.hash, q]));
    let ok = 0,
      failed = 0,
      missing = 0;
    for (let i = 0; i < updates.length; i++) {
      if (opts?.isCancelled?.()) return { ok, failed, missing, unprocessed: updates.length - i };
      const u = updates[i];
      const target = byHash.get(u.q.hash);
      if (!target?.blockId) {
        missing++;
        opts?.onProgress?.(i + 1, updates.length);
        continue;
      }
      try {
        await this.saves.run(`answer-update/${target.blockId}`, () =>
          this.deps.client.setExamAttrs(target.blockId, {
            "exam-answer": u.q.answer,
            "exam-analysis": u.q.analysis ?? "",
            ...(u.q.alt?.length ? { "exam-alt": u.q.alt.join("|") } : {}),
          }),
        );
        ok++;
      } catch {
        failed++;
      }
      opts?.onProgress?.(i + 1, updates.length);
    }
    return { ok, failed, missing };
  }

  // ---------- 打卡桥待重试（48-03：失败保留原 externalRef，不换新引用） ----------
  async getCheckinPending(): Promise<CheckinEventInput | null> {
    const v = await this.loadAux<CheckinEventInput | null>("checkin/bridge/pending");
    return v ?? null;
  }

  async setCheckinPending(p: CheckinEventInput | null): Promise<void> {
    this.assertStorageWritable();
    await this.queueStorageWrite("checkin/bridge/pending", () =>
      this.saves.runLatest("checkin/bridge/pending", () => this.deps.storage.save("checkin/bridge/pending", p)),
    );
  }

  // ---------- 每日战报（联动小驴复盘预留） ----------
  /** 把当日战报写入思源日记（首个开启"每日笔记"的笔记本），返回日记文档 id */
  async writeDailyReport(bankId: string, bankName: string): Promise<string> {
    const { dailyDocPath } = await import("./core/weekly");
    const now = this.deps.now?.() ?? Date.now();
    const today = new Date(now);
    const cutoff = reportWindowStart(1, now);
    const ids = new Set((await this.listQuestions(bankId)).map((q) => q.id));
    const bankEvents = this.attempts.all().filter((e) => ids.has(e.qid));
    const d = replay(bankEvents.filter((e) => e.ts >= cutoff && e.ts <= now));
    let attempts = 0,
      correct = 0;
    for (const s of d.byQuestion.values()) {
      attempts += s.attempts;
      correct += s.correct;
    }
    const before = replay(bankEvents.filter((e) => e.ts < cutoff));
    const bankState = replay(bankEvents.filter((e) => e.ts <= now));
    const eliminated = [...bankState.wrongbook.values()].filter((w) => w.status === "eliminated" && before.wrongbook.get(w.qid)?.status !== "eliminated").length;
    const ymd = reportDateKey(now);
    const md = [
      `# 📝 小驴考试（内测版）战报 · ${ymd}`,
      ``,
      `- 刷题：**${attempts}** 题 · 正确率 **${attempts ? Math.round((correct / attempts) * 100) : 0}%**`,
      `- 今日新消灭错题：**${eliminated}**`,
      `- 题库：${bankName}`,
      `- 统计范围：本题库 ${ymd} 的作答记录（含重复作答）`,
      ``,
    ].join("\n");
    // 找第一个启用每日笔记的笔记本
    for (const nb of this.listBanks()) {
      const conf = await this.deps.client.getNotebookConf(nb.id);
      if (conf.dailyNoteSavePath) {
        const hpath = dailyDocPath(conf.dailyNoteSavePath, today);
        // 直接用 ensureDoc 的返回 id：紧跟其后的 SQL 重查会撞属性/块索引滞后，
        // 新建文档在索引可见前查不到 → 误抛「日记文档未找到」（真机走查实测）
        const docId = await this.ensureDoc(nb.id, hpath);
        if (!docId) throw new Error("日记文档未找到");
        // 45-02：每日写回过 SaveGate（对象级状态进报告中心顶栏 SaveStatus 矩阵，不再只有 toast 单点）
        await this.saves.run(`daily-report/${ymd}`, () => this.deps.client.appendBlock(docId, md));
        return docId;
      }
    }
    throw new Error("未找到开启「每日笔记」的笔记本：请先在思源中为某笔记本开启每日笔记");
  }

  /** AI 用量累计（成本记录 28 组 P2）：tokens/调用次数 累计 + 最近一次 */
  async recordAiUsage(channelId: string, tokens: number, calls: number): Promise<void> {
    if (!Number.isFinite(tokens) || tokens < 0 || !Number.isFinite(calls) || calls < 0) throw new Error("AI 用量必须是非负有限数字");
    this.assertStorageWritable();
    await this.queueStorageWrite("ai/usage", async () => {
      const v = await this.loadAux<{ totalTokens?: number; totalCalls?: number; last?: unknown }>("ai/usage");
      const log = {
        totalTokens: (v?.totalTokens ?? 0) + tokens,
        totalCalls: (v?.totalCalls ?? 0) + calls,
        last: { channelId, tokens, calls, at: this.deps.now?.() ?? Date.now() },
      };
      await this.saves.runLatest("ai/usage", () => this.deps.storage.save("ai/usage", log));
    });
  }

  async aiUsage(): Promise<{ totalTokens: number; totalCalls: number }> {
    const v = await this.loadAux<{ totalTokens?: number; totalCalls?: number }>("ai/usage");
    return { totalTokens: v?.totalTokens ?? 0, totalCalls: v?.totalCalls ?? 0 };
  }

  // ---------- 题库包分享（v1.0；.sy.zip 原生格式） ----------
  async exportBankSyZip(bankId: string): Promise<{ zipPath: string; filename: string }> {
    const { zipPath } = await this.deps.client.exportNotebookSy(bankId);
    const filename = decodeURIComponent(zipPath.split("/").pop() ?? "bank.sy.zip");
    return { zipPath, filename };
  }

  /** 原生包导入（38-05 multipart 契约 + 38-06 lite 自动登记）：
   *  上传 .sy.zip → 扫描笔记本 → 自动登记「题库/」命名空间的新库（已知 id 与非题库笔记本不收），
   *  返回本次登记的名称列表（空=无新库，可能为同名覆盖导入）。浏览器/桌面同路径，不依赖 File.path */
  async importBankSyZip(file: Blob, filename = "bank.sy.zip"): Promise<{ registered: string[] }> {
    await this.deps.client.importSyUpload(file, filename);
    const all = await this.deps.client.listNotebooks();
    const known = new Set(this.banks.map((b) => b.id));
    const registered: string[] = [];
    for (const nb of all) {
      if (known.has(nb.id) || !nb.name.startsWith("题库/")) continue;
      this.banks.push({
        id: nb.id,
        name: nb.name.replace(/^题库\//, "") || nb.name,
        createdAt: this.deps.now?.() ?? Date.now(),
      });
      registered.push(nb.name);
    }
    if (registered.length) await this.saveBankRegistry();
    return { registered };
  }

  /** 估分历史（FIFO 20 条） */
  async saveEstimate(rec: { key: string; mine: string; percent: number; score: number; total: number }): Promise<void> {
    if (![rec.percent, rec.score, rec.total].every((v) => Number.isFinite(v)) || rec.percent < 0 || rec.percent > 100 || rec.score < 0 || rec.total < 0 || rec.score > rec.total) {
      throw new Error("估分结果必须是有效数字，得分不能超过总分");
    }
    this.assertStorageWritable();
    await this.queueStorageWrite("estimate/history", async () => {
      const list = await this.loadAux<(typeof rec)[]>("estimate/history");
      const next = [...(list ?? []), { ...rec, at: this.deps.now?.() ?? Date.now() }].slice(-20);
      await this.saves.runLatest("estimate/history", () => this.deps.storage.save("estimate/history", next));
    });
  }

  async listEstimates(): Promise<(Record<string, unknown> & { percent: number })[]> {
    const v = await this.loadAux("estimate/history");
    return Array.isArray(v) ? (v as any[]) : [];
  }

  // ---------- 导出与模考历史（v0.5） ----------
  /** 模考运行快照（U19 最小）：同一 run 恢复答案/标旗/游标/真实剩余时间；交卷后清除 */
  async saveMockRun(snap: MockRunSnapshot): Promise<void> {
    this.assertStorageWritable();
    const snapshot = {
      ...snap,
      qids: [...snap.qids],
      sectionOf: { ...snap.sectionOf },
      scoreOf: { ...snap.scoreOf },
      indefinite: [...snap.indefinite],
      answers: snap.answers.map((a) => ({ ...a })),
      flags: [...snap.flags],
      sectionStart: { ...snap.sectionStart },
      dwell: snap.dwell ? { ...snap.dwell } : snap.dwell,
      currentEnter: snap.currentEnter ? { ...snap.currentEnter } : snap.currentEnter,
      qVersions: snap.qVersions ? { ...snap.qVersions } : snap.qVersions,
    };
    const write = this.mockRunSaveTail.then(() => this.saves.runLatest(MOCK_RUN_KEY, () => this.deps.storage.save(MOCK_RUN_KEY, snapshot)));
    this.mockRunSaveTail = write.catch(() => undefined);
    await write;
  }

  async loadMockRun(): Promise<MockRunSnapshot | null> {
    try {
      const v = await this.loadAux<MockRunSnapshot | null>(MOCK_RUN_KEY);
      return v && Array.isArray(v.qids) && typeof v.startedAt === "number" ? v : null;
    } catch (error) {
      this.noteStorageReadError(MOCK_RUN_KEY, error);
      return null;
    }
  }

  async clearMockRun(): Promise<void> {
    this.assertStorageWritable();
    const clear = this.mockRunSaveTail.then(async () => {
      this.saves.clear(MOCK_RUN_KEY);
      await this.saves.runLatest(MOCK_RUN_KEY, () => this.deps.storage.save(MOCK_RUN_KEY, null));
    });
    this.mockRunSaveTail = clear.catch(() => undefined);
    await clear;
  }

  /** 模考成绩单写入题库"导出"文档（与错题册导出同通道） */
  async writeScoreDoc(bankId: string, md: string): Promise<string> {
    await this.ensureDoc(bankId, "/导出");
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const hms = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return this.deps.client.createDocWithMd(bankId, `/导出/模考成绩单 ${ymd}-${hms}`, md);
  }

  /** 错题册导出：生成 Markdown 并写入题库笔记本"导出"文档，返回文档 id
   *  过滤（27 组 P2）：kpRoot（考点首段）/ reason（错因）/ sinceDays（最近 N 天首次答错） */
  async exportWrongbook(
    bankId: string,
    bankName: string,
    opts: { kpRoot?: string; reason?: string; sinceDays?: number } = {},
  ): Promise<string> {
    const { wrongbookToMarkdown } = await import("./core/exportMd");
    let items = this.wrongItems();
    const qs = await this.listQuestions(bankId);
    const byId = new Map(qs.map((q) => [q.id, q]));
    if (opts.kpRoot || opts.reason || opts.sinceDays != null) {
      const sinceTs = opts.sinceDays != null ? Date.now() - opts.sinceDays * 86_400_000 : 0;
      items = items.filter((w) => {
        const q = byId.get(w.qid);
        if (!q) return false;
        if (opts.kpRoot && q.kp?.split("/")[0] !== opts.kpRoot) return false;
        if (opts.reason && w.reason !== opts.reason) return false;
        if (opts.sinceDays != null && w.firstWrongAt < sinceTs) return false;
        return true;
      });
    }
    const pairs = await Promise.all(
      items.map(async (w) => {
        const q = byId.get(w.qid);
        if (!q) return null;
        let reflectionText: string | undefined;
        try {
          const r = await this.loadWrongReflection(w.qid);
          reflectionText = r?.text;
        } catch { /* 忽略单个读取错误 */ }
        return { wrong: w, q, reflection: reflectionText };
      }),
    );
    const validPairs = pairs.filter((p): p is NonNullable<typeof p> => p !== null);
    const md = wrongbookToMarkdown(validPairs, { bankName, exportedAt: new Date() });
    await this.ensureDoc(bankId, "/导出");
    const tag = [opts.kpRoot, opts.reason, opts.sinceDays ? `${opts.sinceDays}d` : ""].filter(Boolean).join("-");
    const ymd = new Date().toISOString().slice(0, 10);
    const name = tag ? `/导出/错题册 ${ymd} ${tag}` : `/导出/错题册 ${ymd}`;
    return this.deps.client.createDocWithMd(bankId, name, md);
  }

  /** 全量同步当前题库到思源本地笔记文档（即使卸载插件，本地笔记亦完整保留且排版优雅） */
  async syncBankToLocalDocs(bankId: string, bankName: string): Promise<{ wrongbookDocId?: string; flashcardCount?: number }> {
    if (!this.kernelOnline) throw new Error("思源内核离线，无法写入笔记文档");
    let wrongbookDocId: string | undefined;
    let flashcardCount: number | undefined;

    // 1. 同步导出包含个人复盘心得的高清排版《错题复盘本》
    try {
      wrongbookDocId = await this.exportWrongbook(bankId, bankName);
    } catch (e) {
      console.warn("[lv-exam] sync wrongbook doc failed:", e);
    }

    // 2. 将在册错题与收藏题同步转换为标准正反面列表卡片
    try {
      const qs = await this.listQuestions(bankId);
      const wrongIds = new Set(this.wrongItems().map((w) => w.qid));
      const targetQuestions = qs.filter((q) => wrongIds.has(q.id) || q.fav);
      if (targetQuestions.length) {
        flashcardCount = await this.convertToCards(bankId, bankName, targetQuestions);
      }
    } catch (e) {
      console.warn("[lv-exam] sync flashcards doc failed:", e);
    }

    return { wrongbookDocId, flashcardCount };
  }

  /** 模考成绩持久化（上限 200 条，FIFO） */
  async saveMockResult(rec: MockRecord): Promise<void> {
    if (![rec.total, rec.full, rec.percent].every((v) => Number.isFinite(v)) || rec.total < 0 || rec.full < 0 || rec.total > rec.full || rec.percent < 0 || rec.percent > 100) {
      throw new Error("模考成绩包含无效数字，得分不能超过总分");
    }
    this.assertStorageWritable();
    await this.queueStorageWrite(MOCK_RESULTS_KEY, async () => {
      const list = await this.listMockResults();
      const existing = rec.runId ? list.findIndex((item) => item.runId === rec.runId) : -1;
      if (existing >= 0) list[existing] = rec;
      else list.push(rec);
      while (list.length > 200) list.shift();
      await this.saves.runLatest(MOCK_RESULTS_KEY, () => this.deps.storage.save(MOCK_RESULTS_KEY, list));
    });
  }

  async listMockResults(): Promise<MockRecord[]> {
    const v = await this.loadAux(MOCK_RESULTS_KEY);
    return Array.isArray(v) ? (v as MockRecord[]) : [];
  }

  // ---------- 记忆层（v0.2：riff 卡包 / 转卡 / 评级） ----------
  /** 确保题库卡包存在并返回 deckID（卡包名 小驴考试/<题库名>，与内置闪卡隔离；带 60s 内存缓存） */
  async ensureDeck(bankName: string): Promise<string> {
    const full = deckNameForBank(bankName);
    const cached = this.deckNameCache.get(full);
    if (cached && Date.now() - cached.ts < 60_000) return cached.id;
    const decks = await this.deps.client.getRiffDecks();
    const found = decks.find((d) => d.name === full);
    if (found) {
      this.deckNameCache.set(full, { id: found.id, ts: Date.now() });
      return found.id;
    }
    const createdId = await this.deps.client.createRiffDeck(full);
    this.deckNameCache.set(full, { id: createdId, ts: Date.now() });
    return createdId;
  }

  /** 错题/收藏转卡：为每道题生成具有专业正反面遮挡与复习体验的标准闪卡，写入卡册并加入题库卡包 */
  async convertToCards(
    bankId: string,
    bankName: string,
    questions: (Question & { blockId?: string })[],
  ): Promise<number> {
    if (!questions.length) return 0;
    const deckId = await this.ensureDeck(bankName);

    // 若内核在线且传入了有效题库 ID，则为题目在题库内创建专用的正反面闪卡册
    if (this.kernelOnline && bankId) {
      const hpath = "/学习闪卡";
      let docId: string | undefined;
      try {
        const rows = await this.deps.client.sql<{ id: string }>(
          `SELECT id FROM blocks WHERE box = '${bankId}' AND hpath = '${hpath}' AND type = 'p' LIMIT 1`,
        );
        docId = rows[0]?.id;
      } catch {
        /* 查询失败走新建路径 */
      }
      if (!docId) {
        try {
          docId = await this.deps.client.createDocWithMd(
            bankId,
            hpath,
            "# 学习闪卡册\n\n> 本卡册由小驴考试自动生成（单选/多选/判断/填空/简答）。正面思考，背面核对，已送入 FSRS 间隔重复卡包。\n",
          );
        } catch {
          /* 创建文档失败将回退原块转卡 */
        }
      }

      if (docId) {
        // 使用 questionToFlashCardMarkdown 将每道题目转换为具有完美遮挡与答案解析的列表项卡片
        const markdown = questions.map((q) => questionToFlashCardMarkdown(q)).join("\n\n");
        try {
          const newBlockIds = await this.deps.client.appendBlock(docId, markdown);
          if (newBlockIds.length) {
            await this.deps.client.addRiffCards(deckId, newBlockIds);
            return questions.length;
          }
        } catch {
          /* appendBlock 失败回退到原题块 ID */
        }
      }
    }

    // 离线或降级路径：使用原题块 ID 送入卡包
    const blockIds = questions.map((q) => q.blockId).filter((s): s is string => !!s);
    if (!blockIds.length) return 0;
    await this.deps.client.addRiffCards(deckId, blockIds);
    return blockIds.length;
  }

  /** AI 闪卡候选建卡（116-03 lite：确认后走此方法）——卡块落题库「/AI 闪卡」文档（缺则建），
   *  逐块送入题库卡包；不自动评级、不碰 FSRS 参数（边界）。返回新卡块 id 列表。 */
  async createFlashCards(
    bankId: string,
    bankName: string,
    cards: { type: string; front: string; back: string; source: string }[],
  ): Promise<{ blockIds: string[] }> {
    if (!this.kernelOnline) throw new Error("离线：建卡需要内核可写");
    if (!cards.length) throw new Error("无候选卡");
    const deckId = await this.ensureDeck(bankName);
    const hpath = "/AI 闪卡";
    let docId: string | undefined;
    try {
      const rows = await this.deps.client.sql<{ id: string }>(
        `SELECT id FROM blocks WHERE box = '${bankId}' AND hpath = '${hpath}' AND type = 'p' LIMIT 1`,
      );
      docId = rows[0]?.id;
    } catch { /* 查询失败走新建路径 */ }
    if (!docId) {
      docId = await this.deps.client.createDocWithMd(
        bankId,
        hpath,
        "# AI 闪卡\n\n> 由错因/解析生成的最小卡候选（116-03）。删除本文档不影响题目与作答流水。\n",
      );
    }
    if (!docId) throw new Error("无法创建「AI 闪卡」文档");
    const markdown = cards.map((c) => `- 【AI·${c.type}】${c.front}\n  → ${c.back}（来源：${c.source}）`).join("\n");
    const blockIds = await this.deps.client.appendBlock(docId, markdown);
    if (!blockIds.length) throw new Error("卡块写入失败（内核未返回块 id）");
    await this.deps.client.addRiffCards(deckId, blockIds);
    return { blockIds };
  }

  /** FSRS 到期题（planToday.dueFirst 供给；离线/无卡包/无到期返回空，不建卡包；带 15s 内存缓存） */
  async dueQuestions(bankName: string, questions: (Question & { blockId?: string })[]): Promise<Question[]> {
    if (!this.kernelOnline) return [];
    try {
      const name = deckNameForBank(bankName);
      const now = Date.now();
      const cachedDue = this.dueCardsCache.get(name);
      if (cachedDue && now - cachedDue.ts < 15_000) {
        return questions.filter((q) => q.blockId != null && cachedDue.due.has(q.blockId));
      }
      const deckId = await this.ensureDeck(bankName);
      if (!deckId) return [];
      const cards = await this.deps.client.getDueCards(deckId);
      const due = new Set(cards.map((c) => String((c as { blockID?: string }).blockID ?? "")).filter(Boolean));
      this.dueCardsCache.set(name, { due, ts: now });
      if (!due.size) return [];
      return questions.filter((q) => q.blockId != null && due.has(q.blockId));
    } catch {
      return [];
    }
  }

  /** 背诵/闪卡作答：写流水（kind=recite + selfRating）；若块已转卡则同步 riff 评级 */
  async reciteAnswer(
    bankName: string,
    q: Question & { blockId?: string },
    selfRating: 1 | 2 | 3 | 4,
    sessionId: string,
    timeMs = 0,
  ): Promise<void> {
    const remembered = selfRating >= 3;
    this.recordAttempt({
      qid: q.id,
      kind: "recite",
      mode: "recite",
      verdict: remembered ? "correct" : "wrong",
      myAnswer: null,
      selfRating,
      sessionId,
      queue: "normal",
      timeMs,
    });
    if (q.blockId && this.kernelOnline) {
      try {
        const deckId = await this.ensureDeck(bankName);
        const ids = await this.deps.client.getCardIDsByBlockIDs([q.blockId], deckId);
        const cardId = ids.get(q.blockId);
        if (cardId) await this.deps.client.reviewRiffCard(cardId, deckId, selfRatingToRiffRating(selfRating));
      } catch {
        /* riff 失败不阻塞背诵流水（离线降级语义） */
      }
    }
  }

  /** 查询圈题：执行思源 SQL，把结果块中属于本题库的题挑出来（TODO 26.1 增补） */
  async queryQuestions(bankId: string, stmt: string): Promise<(Question & { blockId: string })[]> {
    const rows = await this.deps.client.sql<Record<string, string>>(stmt);
    const ids = new Set(rows.map((r) => String(r.id ?? r.block_id ?? r.blockId ?? "")).filter(Boolean));
    if (!ids.size) return [];
    const all = await this.listQuestions(bankId);
    return all.filter((q) => ids.has(q.blockId));
  }

  // ---------- 富文本渲染（md2html，按题缓存；离线/失败回退纯文本） ----------
  private renderCache = new Map<string, string>();

  async renderStem(q: Question): Promise<string> {
    if (this.renderCache.has(q.id)) return this.renderCache.get(q.id)!;
    if (!this.kernelOnline) return "";
    try {
      const raw = await this.deps.client.renderMarkdown(q.stem);
      // P0-07：题干来自导入（不可信源），内核 md2html 透传裸 HTML——渲染产物必须过白名单
      const html = sanitizeRichHtml(raw);
      this.renderCache.set(q.id, html);
      return html;
    } catch {
      return "";
    }
  }

  // ---------- 常用抽题 ----------
  /** 背诵池：优先错题；已毕业（背诵连击 ≥4）的题出清，回选择题形态 */
  recitePool(questions: Question[]): Question[] {
    const graduated = new Set([...this.derived().reciteStreak.entries()].filter(([, s]) => s >= 4).map(([qid]) => qid));
    const wrongs = this.wrongDrill(questions).filter((q) => !graduated.has(q.id));
    const wrongIds = new Set(wrongs.map((q) => q.id));
    const rest = questions.filter((q) => !graduated.has(q.id) && !wrongIds.has(q.id));
    return wrongs.length ? wrongs : rest;
  }

  quickDrill(questions: Question[], n: number, seed?: string, opts?: { avoid?: Set<string> }): Question[] {
    // 65-05 lite：带 seed 走确定性抽样（可复现）；缺省维持 Math.random
    // 65-06 lite：opts.avoid = 近期已见 qid——池充足时优先未见过的新题；不足则回退全量（如实）
    const avoid = opts?.avoid;
    const pool =
      avoid && avoid.size
        ? questions.filter((q) => !avoid.has(q.id)).length >= n
          ? questions.filter((q) => !avoid.has(q.id))
          : questions
        : questions;
    return seed ? seededPickN(pool, n, seed) : pickRandom(pool, n);
  }

  /** 举一反三：同考点变式题 */
  sameKpDrill(all: Question[], seed: Question, n: number, excludeIds: Set<string>): Question[] {
    return pickSameKp(all, seed, n, excludeIds);
  }

  /** 冲刺 cram：错 ≥minWrong 的题按错次排序 */
  cramDrill(questions: Question[], minWrong = 2, limit = 50): Question[] {
    const counts = new Map<string, number>();
    for (const w of this.derived().wrongbook.values()) counts.set(w.qid, w.wrongCount);
    return cramQueue(questions, counts, minWrong, limit);
  }

  /** 每日一练：到期优先（FSRS 层 v0.2+ 当前传空）→ 高频错题 → 随机补足 */
  dailyDrill(questions: Question[], dueFirst: Question[], n: number): Question[] {
    const counts = new Map<string, number>();
    for (const w of this.derived().wrongbook.values()) counts.set(w.qid, w.wrongCount);
    return dailySet(questions, dueFirst, counts, n);
  }

  /** 收藏练习：只刷 exam-fav 的题 */
  favDrill(questions: Question[]): Question[] {
    return questions.filter((q) => q.fav);
  }

  wrongDrill(questions: Question[]): Question[] {
    const active = new Set(this.wrongItems().map((w) => w.qid));
    return questions.filter((q) => active.has(q.id));
  }

  dailySet(questions: Question[], dueFirst: Question[], n: number): Question[] {
    const seen = new Set<string>();
    const out: Question[] = [];
    for (const q of [...dueFirst, ...questions]) {
      if (out.length >= n) break;
      if (seen.has(q.id)) continue;
      seen.add(q.id);
      out.push(q);
    }
    return out;
  }
}
