// ============================================================
// ExamApp：应用组装层（控制器）—— UI 与测试共用的唯一入口
// 依赖全部注入（KernelApiClient / StorageAdapter），headless 可驱动
// ============================================================
import { KernelApiClient } from "./kernel/client";
import type { StorageAdapter } from "./core/attemptLog";
import { AttemptLog } from "./core/attemptLog";
import type { AttemptEvent, Question, ReplayResult, WrongItem, SessionState } from "./core/types";
import { replay, activeWrongItems } from "./core/replayer";
import { PracticeSession, pickRandom, groupAdjacent } from "./core/session";
import { randomSeedId, seededPickN } from "./core/random";
import { inferAnswerSpec } from "./core/structuredAnswer";
import { appendRevision, specChanged, type QuestionRevision, type RevisionStore } from "./core/revision";
import { interleaveGroups } from "./core/interleave";
import { deckNameForBank, selfRatingToRiffRating, pickSameKp, cramQueue, dailySet } from "./core/memory";
import { SaveGate } from "./core/saveGate";
import { normalizeAnswer, questionHash } from "./core/answer";
import { questionToMarkdown } from "./core/blockTemplate";
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
  /** 46-03：用户取消 → 已写文档保留，未写部分不计入 missing（如实区分"未处理"与"写失败"） */
  cancelled?: boolean;
}

export class ExamApp {
  readonly attempts: AttemptLog;
  /** 对象级保存确认（Q2/U06）：每个持久化目标独立状态，顶栏可定位失败对象 */
  readonly saves = new SaveGate();
  private replayCache: ReplayResult | null = null;
  private banks: BankInfo[] = [];
  private materialsRegistry: MaterialRegistry = EMPTY_REGISTRY;
  private materialsVersionTooNew = false;
  private materialNoteStore: MaterialNoteStore = EMPTY_NOTE_STORE;
  private materialLinkStore: MaterialLinkStore = EMPTY_LINK_STORE;
  private misdiagnosisStore: MisdiagnosisStore = EMPTY_MISDIAGNOSIS;
  private syllabus: SyllabusDoc = EMPTY_SYLLABUS;
  private syllabusTooNew = false;
  private activeSession: PracticeSession | null = null;
  private mockRunSaveTail: Promise<void> = Promise.resolve();
  kernelOnline = false;
  probeMessage = "";

  /** 运行时连接标记（传输层 retryable 失败/恢复时回调；启动初值由探针设定） */
  setKernelOnline(ok: boolean) {
    if (this.kernelOnline === ok) return;
    this.kernelOnline = ok;
    emitExamEvent("kernel-connection", { online: ok });
  }

  constructor(readonly deps: ExamAppDeps) {
    this.attempts = new AttemptLog(deps.storage, "attempts/log", deps.now ?? (() => Date.now()));
  }

  /** 启动：能力探测 → 流水加载 → 重算 → 会话恢复（任何一步失败都不阻塞后续） */
  async init(deviceId?: string): Promise<void> {
    try {
      const probe = await this.deps.client.probe();
      this.kernelOnline = probe.kernelOk;
      this.probeMessage = probe.kernelOk
        ? `内核 ${probe.version} · md2html ${probe.md2html ? "✓" : "✗"} · SQL ${probe.query ? "✓" : "✗"} · riff ${probe.riff ? "✓" : "✗"}`
        : "内核不可达：将显示离线降级界面";
    } catch {
      this.kernelOnline = false;
      this.probeMessage = "内核不可达：离线降级";
    }
    try {
      await this.attempts.load(deviceId);
    } catch {
      /* 流水损坏已在 load 内部兜底 */
    }
    try {
      await this.loadWrongOverlay();
    } catch {
      this.wrongOverlay = new Map();
    }
    try {
      await this.loadWrongReasons();
    } catch {
      this.wrongReasons = new Map();
    }
    try {
      await this.loadWrongReflections();
    } catch {
      this.wrongReflections = {};
    }
    this.invalidate();
    try {
      const banks = await this.deps.storage.load(BANK_REGISTRY_KEY);
      if (Array.isArray(banks)) this.banks = banks as BankInfo[];
    } catch {
      this.banks = [];
    }
    // 学习资料注册表（120-01）：损坏/过版本时以空表继续（versionTooNew 标记如实显示，不回写覆盖）
    try {
      const parsed = parseRegistry(await this.deps.storage.load(MATERIALS_KEY));
      this.materialsRegistry = parsed.registry;
      this.materialsVersionTooNew = parsed.versionTooNew;
    } catch {
      this.materialsRegistry = EMPTY_REGISTRY;
    }
    // 资料笔记（121-03/122-03）：同口径容错
    try {
      const parsedNotes = parseNoteStore(await this.deps.storage.load(MATERIAL_NOTES_KEY));
      this.materialNoteStore = parsedNotes.store;
    } catch {
      this.materialNoteStore = EMPTY_NOTE_STORE;
    }
    // 题目↔资料关联（120-05 lite）
    try {
      const parsedLinks = parseLinkStore(await this.deps.storage.load(MATERIAL_QREFS_KEY));
      this.materialLinkStore = parsedLinks.store;
    } catch {
      this.materialLinkStore = EMPTY_LINK_STORE;
    }
    // AI 错因假设（116-01/U14：与用户复盘分层独立保存）
    try {
      const parsedMis = parseMisdiagnosis(await this.deps.storage.load(MISDIAGNOSIS_KEY));
      this.misdiagnosisStore = parsedMis.store;
    } catch {
      this.misdiagnosisStore = EMPTY_MISDIAGNOSIS;
    }
    // 考纲对照（51-01/03 lite）
    try {
      const parsedSyl = parseSyllabusDoc(await this.deps.storage.load(SYLLABUS_KEY));
      this.syllabus = parsedSyl.doc;
      this.syllabusTooNew = parsedSyl.versionTooNew;
    } catch {
      this.syllabus = EMPTY_SYLLABUS;
    }
  }

  // ---------- 题库 ----------
  listBanks(): BankInfo[] {
    return [...this.banks];
  }

  /** 新建题库一键流程（2.2 P0）：笔记本 + 首页 + 章节骨架 + 示例题文档（真实入库，建完即可练）。
   *  骨架失败不阻断建库：逐段 try，返回 info 时尽力而为（部分骨架缺失可后续手动补/重导）。 */
  async createBank(name: string): Promise<BankInfo> {
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
    this.banks.push(info);
    await this.deps.storage.save(BANK_REGISTRY_KEY, this.banks);
    return info;
  }

  removeBank(id: string): boolean {
    const before = this.banks.length;
    this.banks = this.banks.filter((b) => b.id !== id);
    if (this.banks.length !== before) {
      void this.deps.storage.save(BANK_REGISTRY_KEY, this.banks);
      return true;
    }
    return false;
  }

  /** 导入提交：按考点落章节文档（无考点 → "导入/<批次>"），返回写入数与真实读回清单（U08）。
   *  46-03：onProgress 逐文档回传 (已写, 总数)；isCancelled 在文档间检查，取消时如实返回 partial。
   *  取消不回滚已写文档（batch 可在题库健康面板整批撤销），written 只计真实写出的题。 */
  async commitImport(
    bankId: string,
    report: ImportReport,
    opts?: { onProgress?: (done: number, total: number) => void; isCancelled?: () => boolean },
  ): Promise<ImportCommitResult> {
    if (!report.ok.length) return { written: 0, docs: [], readback: { confirmed: [], missing: [], verified: false } };
    const expected = report.ok.map((q) => q.id);
    const baseline = this.kernelOnline
      ? await this.listQuestions(bankId)
          .then((qs) => qs.length)
          .catch(() => 0)
      : 0;
    const byDoc = new Map<string, typeof report.ok>();
    for (const q of report.ok) {
      const doc = q.kp ? `/${q.kp.split("/")[0]}` : `/导入/${report.batch}`;
      if (!byDoc.has(doc)) byDoc.set(doc, []);
      byDoc.get(doc)!.push(q);
    }
    const total = report.ok.length;
    let written = 0;
    let cancelled = false;
    const writtenIds: string[] = [];
    const docs: string[] = [];
    for (const [doc, qs] of byDoc) {
      if (opts?.isCancelled?.()) {
        cancelled = true;
        break;
      }
      const docId = await this.ensureDoc(bankId, doc);
      const writtenBlocks = await this.deps.client.appendQuestions(docId, qs);
      // 54-01 lite：结构化作答规则随导入写入块属性（custom-exam-answer-spec）——往返不丢；失败不影响题目入库
      for (const { qid, blockId } of writtenBlocks) {
        const spec = qs.find((q) => q.id === qid)?.answerSpec;
        if (!spec) continue;
        try {
          await this.deps.client.setExamAttrs(blockId, { "exam-answer-spec": JSON.stringify(spec) });
        } catch { /* spec 写失败不影响题目入库；读回时该题按旧口径判分（如实降级） */ }
      }
      written += qs.length;
      for (const q of qs) writtenIds.push(q.id);
      docs.push(doc);
      opts?.onProgress?.(written, total);
    }
    this.invalidate();
    // 3.8.5 实测：IAL 属性入 attributes 表有 1-3s 异步索引滞后，
    // 立即 listQuestions 会查不到刚导入的题 → 轮询到账后再返回
    if (this.kernelOnline) {
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 700));
        try {
          const n = await this.listQuestions(bankId);
          if (n.length >= baseline + written) break;
        } catch {
          /* 索引未就绪，继续等 */
        }
      }
    }
    // 读回确认（U08）：完成页只认真实读回的 qid；读回失败如实报告"未核实"，不冒充成功。
    // 取消时只对已写文档的题做读回（未处理 ≠ 写失败，missing 不掺入未处理部分）
    const readbackScope = cancelled ? writtenIds : expected;
    let readback: ImportCommitResult["readback"] = { confirmed: [], missing: [], verified: false };
    if (this.kernelOnline) {
      try {
        const qs = await this.listQuestions(bankId);
        const have = new Set(qs.map((q) => q.id));
        readback = {
          confirmed: readbackScope.filter((id) => have.has(id)),
          missing: readbackScope.filter((id) => !have.has(id)),
          verified: true,
        };
      } catch {
        readback = { confirmed: [], missing: [], verified: false };
      }
    }
    return cancelled ? { written, docs, readback, cancelled } : { written, docs, readback };
  }

  private async ensureDoc(bankId: string, hpath: string): Promise<string> {
    // createDocWithMd 幂等：已存在返回 ""（思源行为）——先查再建；
    // 建后重查一次：与思源日记自动建档存在竞态时 createDocWithMd 可能返回 ""
    // 而真实文档由宿主创建（真机走查实测出现同 hpath 双文档块，写入静默落空）
    const existing = await this.deps.client.sql(
      `SELECT id FROM blocks WHERE box='${bankId.replace(/'/g, "''")}' AND hpath='${hpath.replace(/'/g, "''")}' AND type='d' ORDER BY updated DESC LIMIT 1`,
    );
    if (existing[0]?.id) return String(existing[0].id);
    const created = await this.deps.client.createDocWithMd(bankId, hpath, `# ${hpath.split("/").pop()}\n\n`);
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
    await this.saves.run(`edit-q/${q.blockId}`, () =>
      this.deps.client.updateBlock(q.blockId, questionToMarkdown(next)),
    );
    const kd = await this.deps.client.getBlockKramdown(q.blockId);
    if (!kd.includes(`exam-id="${q.id}"`) && !kd.includes(`exam-id='${q.id}'`)) {
      throw new Error("编辑读回异常：题目身份（exam-id）丢失，请勿关闭窗口并反馈诊断");
    }
    // 54/63-03：规格同步。优先级：作者显式规格 > 答案变更重推断 > 不触碰。
    // （陈旧 spec 会让新答案全判错；填空答案改为不可识别文本 → 清空属性回旧字符串口径）
    let specWasChanged = false;
    if (q.type === "fill" && draft.answerSpec) {
      next.answerSpec = draft.answerSpec;
      specWasChanged = specChanged(q.answerSpec, draft.answerSpec);
      try {
        await this.deps.client.setExamAttrs(q.blockId, {
          "exam-answer-spec": JSON.stringify(draft.answerSpec),
        });
      } catch { /* 属性同步失败不影响题面编辑本身；读回时按块内旧属性如实判分 */ }
    } else if (q.type === "fill" && answer !== q.answer) {
      const spec = inferAnswerSpec("fill", answer);
      specWasChanged = specChanged(q.answerSpec, spec);
      next.answerSpec = spec;
      try {
        await this.deps.client.setExamAttrs(q.blockId, {
          "exam-answer-spec": spec ? JSON.stringify(spec) : "",
        });
      } catch { /* 属性同步失败不影响题面编辑本身；读回时按块内旧属性如实判分 */ }
    }
    // 43-01 lite：修订时间线快照（答案/考点变更才记；每题 FIFO 10 条）
    if (answer !== q.answer || (draft.kp.trim() || undefined) !== q.kp || specWasChanged) {
      await this.appendRevision(q.id, {
        ts: this.deps.now?.() ?? Date.now(),
        answer,
        kp: draft.kp.trim() || undefined,
        specChanged: specWasChanged || undefined,
      });
    }
    return next;
  }

  private revisionCache: RevisionStore | null = null;

  /** 修订时间线（43-01 lite）：读缓存 + 惰性加载 */
  async questionRevisions(qid: string): Promise<QuestionRevision[]> {
    if (!this.revisionCache) {
      this.revisionCache = ((await this.deps.storage.load(REVISIONS_KEY)) as RevisionStore | undefined) ?? {};
    }
    return this.revisionCache[qid] ?? [];
  }

  private async appendRevision(qid: string, entry: QuestionRevision): Promise<void> {
    if (!this.revisionCache) {
      this.revisionCache = ((await this.deps.storage.load(REVISIONS_KEY)) as RevisionStore | undefined) ?? {};
    }
    this.revisionCache = appendRevision(this.revisionCache, qid, entry);
    await this.deps.storage.save(REVISIONS_KEY, this.revisionCache);
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
    const current = this.derived().wrongbook.get(qid);
    const key = "wrongbook/overlays";
    const v = (await this.deps.storage.load(key)) as
      Record<string, { status: string; at: number; wrongCount: number; until?: number }> | undefined;
    const map: Record<string, { status: string; at: number; wrongCount: number; until?: number }> = v ?? {};
    if (status === "active") delete map[qid];
    else map[qid] = { status, at: Date.now(), wrongCount: current?.wrongCount ?? 0 };
    await this.deps.storage.save(key, map);
    this.wrongOverlay = new Map(Object.entries(map));
    this.invalidate();
    emitExamEvent("wrongbook-changed", { qid, status }); // 48-02 lite：生态消费者按需重读
  }

  /** 顽固题暂缓（52-06 lite）：days 天内不进错题重练/每日计划，到期自动回册；期间再错立即回册 */
  async snoozeWrong(qid: string, days = 7): Promise<void> {
    const current = this.derived().wrongbook.get(qid);
    const key = "wrongbook/overlays";
    const v = (await this.deps.storage.load(key)) as
      Record<string, { status: string; at: number; wrongCount: number; until?: number }> | undefined;
    const map: Record<string, { status: string; at: number; wrongCount: number; until?: number }> = v ?? {};
    const at = this.deps.now?.() ?? Date.now();
    map[qid] = { status: "snoozed", at, wrongCount: current?.wrongCount ?? 0, until: at + days * 86_400_000 };
    await this.deps.storage.save(key, map);
    this.wrongOverlay = new Map(Object.entries(map));
    this.invalidate();
    emitExamEvent("wrongbook-changed", { qid, status: "snoozed" });
  }

  // ---------- 错题自诊断（52-04 lite）：个人复盘短模板，与官方解析分离存储 ----------
  /** 保存自诊断复盘（覆盖式：一次一份当前检查点；官方解析与作答流水不受影响） */
  async saveWrongReflection(qid: string, text: string): Promise<void> {
    const key = "wrongbook/reflections";
    const v = (await this.deps.storage.load(key)) as Record<string, { text: string; at: number }> | undefined;
    const map = v ?? {};
    const trimmed = text.trim();
    if (!trimmed) delete map[qid];
    else map[qid] = { text: trimmed, at: this.deps.now?.() ?? Date.now() };
    await this.deps.storage.save(key, map);
    this.wrongReflections = map;
  }

  /** 读取自诊断复盘（52-04 验收：复习能回看上次检查点） */
  async loadWrongReflection(qid: string): Promise<{ text: string; at: number } | null> {
    const v = (this.wrongReflections[qid] ?? null) as { text: string; at: number } | null;
    return v;
  }

  private wrongReflections: Record<string, { text: string; at: number }> = {};

  private async loadWrongReflections(): Promise<void> {
    const v = (await this.deps.storage.load("wrongbook/reflections")) as
      Record<string, { text: string; at: number }> | undefined;
    this.wrongReflections = v ?? {};
  }

  private wrongOverlay = new Map<string, { status: string; at: number; wrongCount: number; until?: number }>();

  private async loadWrongOverlay(): Promise<void> {
    const v = (await this.deps.storage.load("wrongbook/overlays")) as
      Record<string, { status: string; at: number; wrongCount: number; until?: number }> | undefined;
    this.wrongOverlay = new Map(Object.entries(v ?? {}));
  }

  /** 错因（单键 map；计划加权回流的数据源） */
  private wrongReasons = new Map<string, "careless" | "unknown" | "trap">();

  async saveWrongReason(qid: string, reason: "careless" | "unknown" | "trap"): Promise<void> {
    const map =
      ((await this.deps.storage.load(WRONG_REASON_KEY)) as
        Record<string, { reason: string; at: number }> | undefined) ?? {};
    map[qid] = { reason, at: Date.now() };
    await this.deps.storage.save(WRONG_REASON_KEY, map);
    this.wrongReasons.set(qid, reason);
    this.invalidate();
  }

  async loadWrongReason(qid: string): Promise<string | undefined> {
    const map = (await this.deps.storage.load(WRONG_REASON_KEY)) as Record<string, { reason?: string }> | undefined;
    return map?.[qid]?.reason;
  }

  private async loadWrongReasons(): Promise<void> {
    const map = (await this.deps.storage.load(WRONG_REASON_KEY)) as Record<string, { reason?: string }> | undefined;
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
      const v = await this.deps.storage.load(ACTIONS_KEY);
      return Array.isArray(v) ? (v as ActionItem[]) : [];
    } catch {
      return [];
    }
  }

  private async saveActions(list: ActionItem[]): Promise<void> {
    await this.saves.run(ACTIONS_KEY, () => this.deps.storage.save(ACTIONS_KEY, list));
  }

  /** 加入行动（同 kind+qid 去重）；返回实际新增与跳过数 */
  async addActions(
    drafts: { kind: ActionKind; qid?: string; sessionId?: string; detail: string }[],
  ): Promise<{ added: number; skipped: number }> {
    const list = await this.loadActions();
    const r = appendActions(list, drafts, this.deps.now?.() ?? Date.now());
    if (r.added) await this.saveActions(r.list);
    return { added: r.added, skipped: r.skipped };
  }

  async listOpenActions(): Promise<ActionItem[]> {
    return openActions(await this.loadActions());
  }

  /** 完成（用户确认为最小证据）；幂等 */
  async completeAction(id: string, evidence = "user-confirmed"): Promise<void> {
    const list = await this.loadActions();
    await this.saveActions(completeAction(list, id, evidence, this.deps.now?.() ?? Date.now()));
  }

  /** 取消/暂缓（保留记录）；幂等 */
  async cancelAction(id: string): Promise<void> {
    const list = await this.loadActions();
    await this.saveActions(cancelAction(list, id, this.deps.now?.() ?? Date.now()));
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
    if (this.activeSession?.phase === "running") return this.activeSession;
    this.lastResumeMissing = [];
    try {
      const saved = (await this.deps.storage.load(SESSION_KEY)) as SessionState | undefined;
      if (!saved?.qids?.length || saved.finishedAt) return null;
      if (saved.bankId && expectedBankId && saved.bankId !== expectedBankId) return null; // 跨库不串
      const now = this.deps.now ?? Date.now;
      const age = now() - (saved.updatedAt || saved.startedAt);
      if (age > DRAFT_DROP_MS) {
        await this.deps.storage.save(SESSION_KEY, null);
        return null;
      }
      if (age > DRAFT_HIDE_MS) return null;
      const found = await questionLoader(saved.qids);
      if (!found.length) return null;
      // 缺题如实剔除（删题/读不到），不用其他题顶替
      const foundIds = new Set(found.map((q) => q.id));
      this.lastResumeMissing = saved.qids.filter((id) => !foundIds.has(id));
      const sanitized: SessionState = this.lastResumeMissing.length
        ? { ...saved, qids: saved.qids.filter((id) => foundIds.has(id)) }
        : saved;
      this.activeSession = new PracticeSession(found, saved.mode, sanitized, now);
      return this.activeSession;
    } catch {
      return null;
    }
  }

  async saveSession(): Promise<void> {
    const s = this.activeSession;
    if (!s) return;
    if (s.phase === "finished") await this.saves.run(SESSION_KEY, () => this.deps.storage.save(SESSION_KEY, null));
    else await this.saves.run(SESSION_KEY, () => this.deps.storage.save(SESSION_KEY, s.state));
  }

  async discardSession(): Promise<void> {
    this.activeSession = null;
    await this.deps.storage.save(SESSION_KEY, null);
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
    const next = !q.fav;
    if (q.blockId && this.kernelOnline) {
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
  async storageUsage(): Promise<{ key: string; bytes: number; present: boolean }[]> {
    const rows: { key: string; bytes: number; present: boolean }[] = [];
    for (const key of KNOWN_STORAGE_KEYS) {
      try {
        const v = await this.deps.storage.load(key);
        rows.push({ key, bytes: v === undefined ? 0 : JSON.stringify(v).length, present: v !== undefined });
      } catch {
        rows.push({ key, bytes: 0, present: false });
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
      this.deps.storage.load("wrongbook/overlays"),
      this.deps.storage.load("wrongbook/reasons"),
      this.deps.storage.load(ACTIONS_KEY),
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
    await this.saves.run(MATERIALS_KEY, () =>
      this.deps.storage.save(MATERIALS_KEY, serializeRegistry(this.materialsRegistry)),
    );
  }

  /** 文件登记（120-02）：读文件 → 拷入工作区 assets（putFile）→ 注册/归并位置。
   *  大文件不默认全拷贝（120-03）：超 30MB 如实拒绝；离线拒绝（putFile 需要内核）。 */
  async registerMaterialFromFile(
    file: File,
    meta: { subject?: string; chapter?: string; title?: string } = {},
  ): Promise<{ material: MaterialDoc; deduped: boolean }> {
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
    this.materialsRegistry = result.registry;
    await this.saveMaterialsRegistry();
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
    this.materialsRegistry = result.registry;
    await this.saveMaterialsRegistry();
    return { material: result.material, deduped: result.deduped };
  }

  /** 为既有资料追加位置（同一文件第二份副本/镜像）；重复位置如实返回 deduped 不重复写 */
  async attachMaterialLocation(materialId: string, loc: { kind: "assets" | "link"; path: string }): Promise<{ deduped: boolean }> {
    if (this.materialsReadonly) throw new Error("注册表版本较新：只读（降级回滚场景），变更已拒绝");
    const r = attachLocation(this.materialsRegistry, materialId, loc, this.deps.now?.() ?? Date.now());
    if (!r.material) throw new Error("资料不存在");
    this.materialsRegistry = r.registry;
    await this.saveMaterialsRegistry();
    return { deduped: r.deduped };
  }

  /** 移除登记（purgeAssets=true 时尽力删除 assets 附件；失败不阻断——登记移除是主事实） */
  async removeMaterialById(materialId: string, purgeAssets = false): Promise<void> {
    if (this.materialsReadonly) throw new Error("注册表版本较新：只读（降级回滚场景），移除已拒绝");
    const material = this.materialsRegistry.materials.find((m) => m.id === materialId);
    if (!material) throw new Error("资料不存在");
    this.materialsRegistry = removeMaterial(this.materialsRegistry, materialId);
    await this.saveMaterialsRegistry();
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
      await this.saveMaterialNotes();
    }
    // 题目↔资料关联同样随资料移除清理（120-05：不残留断链）
    if (questionsOfMaterial(this.materialLinkStore, materialId).length) {
      this.materialLinkStore = dropMaterialLinks(this.materialLinkStore, materialId);
      await this.saves.run(MATERIAL_QREFS_KEY, () =>
        this.deps.storage.save(MATERIAL_QREFS_KEY, serializeLinkStore(this.materialLinkStore)),
      );
    }
  }

  // ---------- 资料定位与个人笔记（121-02/03 + 122-02/03 lite） ----------

  listMaterialNotes(materialId: string): MaterialNote[] {
    return notesOfMaterial(this.materialNoteStore, materialId);
  }

  private async saveMaterialNotes(): Promise<void> {
    await this.saves.run(MATERIAL_NOTES_KEY, () =>
      this.deps.storage.save(MATERIAL_NOTES_KEY, serializeNoteStore(this.materialNoteStore)),
    );
  }

  /** 新增笔记（绑定 materialId+revision；离线也可写——纯插件存储，不动原件） */
  async addMaterialNote(input: NoteInput): Promise<MaterialNote> {
    if (this.materialsReadonly) throw new Error("存储版本较新：只读（降级回滚场景），写入已拒绝");
    const r = addNote(this.materialNoteStore, input, this.deps.now?.() ?? Date.now());
    this.materialNoteStore = r.store;
    await this.saveMaterialNotes();
    return r.note;
  }

  async updateMaterialNote(noteId: string, patch: { locator?: NoteLocator | null; text?: string; tags?: string[] }): Promise<MaterialNote> {
    if (this.materialsReadonly) throw new Error("存储版本较新：只读（降级回滚场景），写入已拒绝");
    const r = updateNote(this.materialNoteStore, noteId, patch, this.deps.now?.() ?? Date.now());
    if (!r.note) throw new Error("笔记不存在");
    this.materialNoteStore = r.store;
    await this.saveMaterialNotes();
    return r.note;
  }

  async deleteMaterialNote(noteId: string): Promise<void> {
    if (this.materialsReadonly) throw new Error("存储版本较新：只读（降级回滚场景），删除已拒绝");
    this.materialNoteStore = deleteNote(this.materialNoteStore, noteId);
    await this.saveMaterialNotes();
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
    if (this.materialsReadonly) throw new Error("存储版本较新：只读（降级回滚场景），写入已拒绝");
    const material = this.materialsRegistry.materials.find((m) => m.id === materialId);
    if (!material) throw new Error("资料不存在");
    const r = linkQuestion(
      this.materialLinkStore,
      { qid, materialId, revision: material.revision, locator },
      this.deps.now?.() ?? Date.now(),
    );
    this.materialLinkStore = r.store;
    await this.saves.run(MATERIAL_QREFS_KEY, () =>
      this.deps.storage.save(MATERIAL_QREFS_KEY, serializeLinkStore(this.materialLinkStore)),
    );
    return { replaced: r.replaced };
  }

  async unlinkQuestionMaterial(qid: string): Promise<void> {
    if (this.materialsReadonly) throw new Error("存储版本较新：只读（降级回滚场景），删除已拒绝");
    const r = unlinkQuestion(this.materialLinkStore, qid);
    if (!r.removed) return;
    this.materialLinkStore = r.store;
    await this.saves.run(MATERIAL_QREFS_KEY, () =>
      this.deps.storage.save(MATERIAL_QREFS_KEY, serializeLinkStore(this.materialLinkStore)),
    );
  }

  // ---------- AI 错因假设（116-01/U14：独立持久化，与用户复盘分层） ----------

  latestMisdiagnosis(qid: string): MisdiagnosisRecord | null {
    return latestOf(this.misdiagnosisStore, qid);
  }

  /** 生成成功后落库（同题保留最新）；纯本地存储，离线也可写 */
  async saveMisdiagnosis(rec: MisdiagnosisRecord): Promise<void> {
    if (this.materialsReadonly) throw new Error("存储版本较新：只读（降级回滚场景），写入已拒绝");
    this.misdiagnosisStore = addMisdiagnosis(this.misdiagnosisStore, rec);
    await this.saves.run(MISDIAGNOSIS_KEY, () =>
      this.deps.storage.save(MISDIAGNOSIS_KEY, serializeMisdiagnosis(this.misdiagnosisStore)),
    );
  }

  /** 采纳打点（用户并入复盘时调用；只记时间戳，不改假设原文） */
  async markMisdiagnosisAdopted(qid: string): Promise<void> {
    if (this.materialsReadonly) throw new Error("存储版本较新：只读（降级回滚场景），写入已拒绝");
    this.misdiagnosisStore = markAdopted(this.misdiagnosisStore, qid, this.deps.now?.() ?? Date.now());
    await this.saves.run(MISDIAGNOSIS_KEY, () =>
      this.deps.storage.save(MISDIAGNOSIS_KEY, serializeMisdiagnosis(this.misdiagnosisStore)),
    );
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
    if (this.syllabusTooNew) throw new Error("考纲存储版本较新：只读（降级回滚场景），写入已拒绝");
    if (!roots.length) throw new Error("考纲为空（解析后无节点）");
    this.syllabus = { v: 1, meta, roots, importedAt: this.deps.now?.() ?? Date.now() };
    await this.saves.run(SYLLABUS_KEY, () =>
      this.deps.storage.save(SYLLABUS_KEY, serializeSyllabus(this.syllabus)),
    );
  }

  /** 清除插件数据（58-03 lite）：逐键置空并返回逐对象回执（不冒充全部删除）。
   *  边界：思源笔记本/题块本体不动；内存态重载后归零；已外发 AI 数据无法撤回（UI 说明）。 */
  async purgeAllData(): Promise<{ key: string; ok: boolean }[]> {
    const receipts: { key: string; ok: boolean }[] = [];
    for (const key of KNOWN_STORAGE_KEYS) {
      try {
        await this.deps.storage.save(key, null);
        receipts.push({ key, ok: true });
      } catch {
        receipts.push({ key, ok: false });
      }
    }
    this.banks = [];
    this.invalidate();
    return receipts;
  }

  // ---------- 打卡桥待重试（48-03：失败保留原 externalRef，不换新引用） ----------
  /** 38-03 更新式重导：按 hash 定位库内题，只覆盖答案/解析/别名属性（题干/选项/流水不动）。
   *  返回逐题回执；existing 缺失的更新计 missing（库内找不到=已删除，不猜测） */
  async applyAnswerUpdates(
    updates: { row: number; q: Question }[],
    existing: (Question & { blockId: string })[],
  ): Promise<{ ok: number; failed: number; missing: number }> {
    if (!this.kernelOnline) throw new Error("离线：更新已有题需要内核可写");
    const byHash = new Map(existing.map((q) => [q.hash, q]));
    let ok = 0,
      failed = 0,
      missing = 0;
    for (const u of updates) {
      const target = byHash.get(u.q.hash);
      if (!target?.blockId) {
        missing++;
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
    }
    return { ok, failed, missing };
  }

  // ---------- 打卡桥待重试（48-03：失败保留原 externalRef，不换新引用） ----------
  async getCheckinPending(): Promise<CheckinEventInput | null> {
    const v = (await this.deps.storage.load("checkin/bridge/pending")) as CheckinEventInput | null;
    return v ?? null;
  }

  async setCheckinPending(p: CheckinEventInput | null): Promise<void> {
    await this.deps.storage.save("checkin/bridge/pending", p);
  }

  // ---------- 每日战报（联动小驴复盘预留） ----------
  /** 把当日战报写入思源日记（首个开启"每日笔记"的笔记本），返回日记文档 id */
  async writeDailyReport(bankId: string, bankName: string): Promise<string> {
    const { dailyDocPath } = await import("./core/weekly");
    const d = this.derived();
    let attempts = 0,
      correct = 0;
    for (const s of d.byQuestion.values()) {
      attempts += s.attempts;
      correct += s.correct;
    }
    const eliminated = [...d.wrongbook.values()].filter((w) => w.status === "eliminated").length;
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const md = [
      `# 📝 小驴考试（内测版）战报 · ${ymd}`,
      ``,
      `- 刷题：**${attempts}** 题 · 正确率 **${attempts ? Math.round((correct / attempts) * 100) : 0}%**`,
      `- 消灭错题：**${eliminated}**`,
      `- 题库：${bankName}`,
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
    void bankId;
    throw new Error("未找到开启「每日笔记」的笔记本：请先在思源中为某笔记本开启每日笔记");
  }

  /** AI 用量累计（成本记录 28 组 P2）：tokens/调用次数 累计 + 最近一次 */
  async recordAiUsage(channelId: string, tokens: number, calls: number): Promise<void> {
    const v = (await this.deps.storage.load("ai/usage")) as
      { totalTokens?: number; totalCalls?: number; last?: unknown } | undefined;
    const log = {
      totalTokens: (v?.totalTokens ?? 0) + tokens,
      totalCalls: (v?.totalCalls ?? 0) + calls,
      last: { channelId, tokens, calls, at: Date.now() },
    };
    await this.deps.storage.save("ai/usage", log);
  }

  async aiUsage(): Promise<{ totalTokens: number; totalCalls: number }> {
    const v = (await this.deps.storage.load("ai/usage")) as { totalTokens?: number; totalCalls?: number } | undefined;
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
    if (registered.length) await this.deps.storage.save(BANK_REGISTRY_KEY, this.banks);
    return { registered };
  }

  /** 估分历史（FIFO 20 条） */
  async saveEstimate(rec: { key: string; mine: string; percent: number; score: number; total: number }): Promise<void> {
    const list = (await this.deps.storage.load("estimate/history")) as (typeof rec)[] | undefined;
    const next = [...(list ?? []), { ...rec, at: Date.now() }].slice(-20);
    await this.deps.storage.save("estimate/history", next);
  }

  async listEstimates(): Promise<(Record<string, unknown> & { percent: number })[]> {
    const v = await this.deps.storage.load("estimate/history");
    return Array.isArray(v) ? (v as any[]) : [];
  }

  // ---------- 导出与模考历史（v0.5） ----------
  /** 模考运行快照（U19 最小）：同一 run 恢复答案/标旗/游标/真实剩余时间；交卷后清除 */
  async saveMockRun(snap: MockRunSnapshot): Promise<void> {
    const write = this.mockRunSaveTail.then(() => this.saves.run(MOCK_RUN_KEY, () => this.deps.storage.save(MOCK_RUN_KEY, snap)));
    this.mockRunSaveTail = write.catch(() => undefined);
    await write;
  }

  async loadMockRun(): Promise<MockRunSnapshot | null> {
    try {
      const v = (await this.deps.storage.load(MOCK_RUN_KEY)) as MockRunSnapshot | null | undefined;
      return v && Array.isArray(v.qids) && typeof v.startedAt === "number" ? v : null;
    } catch {
      return null;
    }
  }

  async clearMockRun(): Promise<void> {
    const clear = this.mockRunSaveTail.then(async () => {
      this.saves.clear(MOCK_RUN_KEY);
      await this.deps.storage.save(MOCK_RUN_KEY, null);
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
    const pairs = items.map((w) => ({ wrong: w, q: byId.get(w.qid)! })).filter((p) => p.q);
    const md = wrongbookToMarkdown(pairs, { bankName, exportedAt: new Date() });
    await this.ensureDoc(bankId, "/导出");
    const tag = [opts.kpRoot, opts.reason, opts.sinceDays ? `${opts.sinceDays}d` : ""].filter(Boolean).join("-");
    const ymd = new Date().toISOString().slice(0, 10);
    const name = tag ? `/导出/错题册 ${ymd} ${tag}` : `/导出/错题册 ${ymd}`;
    return this.deps.client.createDocWithMd(bankId, name, md);
  }

  /** 模考成绩持久化（上限 200 条，FIFO） */
  async saveMockResult(rec: MockRecord): Promise<void> {
    const list = await this.listMockResults();
    const existing = rec.runId ? list.findIndex((item) => item.runId === rec.runId) : -1;
    if (existing >= 0) list[existing] = rec;
    else list.push(rec);
    while (list.length > 200) list.shift();
    await this.deps.storage.save(MOCK_RESULTS_KEY, list);
  }

  async listMockResults(): Promise<MockRecord[]> {
    const v = await this.deps.storage.load(MOCK_RESULTS_KEY);
    return Array.isArray(v) ? (v as MockRecord[]) : [];
  }

  // ---------- 记忆层（v0.2：riff 卡包 / 转卡 / 评级） ----------
  /** 确保题库卡包存在并返回 deckID（卡包名 小驴考试/<题库名>，与内置闪卡隔离） */
  async ensureDeck(bankName: string): Promise<string> {
    const full = deckNameForBank(bankName);
    const decks = await this.deps.client.getRiffDecks();
    const found = decks.find((d) => d.name === full);
    if (found) return found.id;
    return this.deps.client.createRiffDeck(full);
  }

  /** 错题/收藏转卡：返回成功送入卡包的块数（bankId 预留：将来按章节拆卡包） */
  async convertToCards(
    _bankId: string,
    bankName: string,
    questions: (Question & { blockId?: string })[],
  ): Promise<number> {
    const blockIds = questions.map((q) => q.blockId).filter((s): s is string => !!s);
    if (!blockIds.length) return 0;
    const deckId = await this.ensureDeck(bankName);
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

  /** FSRS 到期题（planToday.dueFirst 供给；离线/无卡包/无到期返回空，不建卡包） */
  async dueQuestions(bankName: string, questions: (Question & { blockId?: string })[]): Promise<Question[]> {
    if (!this.kernelOnline) return [];
    try {
      const name = deckNameForBank(bankName);
      const deck = (await this.deps.client.getRiffDecks()).find((d) => d.name === name);
      if (!deck) return [];
      const cards = await this.deps.client.getDueCards(deck.id);
      const due = new Set(cards.map((c) => String((c as { blockID?: string }).blockID ?? "")).filter(Boolean));
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
