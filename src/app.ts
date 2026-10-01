// ============================================================
// ExamApp：应用组装层（控制器）—— UI 与测试共用的唯一入口
// 依赖全部注入（KernelApiClient / StorageAdapter），headless 可驱动
// ============================================================
import { KernelApiClient } from "./kernel/client";
import type { StorageAdapter } from "./core/attemptLog";
import { AttemptLog } from "./core/attemptLog";
import type { AttemptEvent, Question, ReplayResult, WrongItem, SessionState } from "./core/types";
import { replay, activeWrongItems } from "./core/replayer";
import { PracticeSession, pickRandom } from "./core/session";
import type { ImportReport } from "./importer/pipeline";

export interface BankInfo { id: string; name: string; createdAt: number }

export interface ExamAppDeps {
  client: KernelApiClient;
  storage: StorageAdapter;
  now?: () => number;
}

const BANK_REGISTRY_KEY = "banks";
const SESSION_KEY = "session/active";
const WRONG_REASON_KEY_PREFIX = "wrongbook/reasons/";

export class ExamApp {
  readonly attempts: AttemptLog;
  private replayCache: ReplayResult | null = null;
  private banks: BankInfo[] = [];
  private activeSession: PracticeSession | null = null;
  kernelOnline = false;
  probeMessage = "";

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
    try { await this.attempts.load(deviceId); } catch { /* 流水损坏已在 load 内部兜底 */ }
    this.invalidate();
    try {
      const banks = await this.deps.storage.load(BANK_REGISTRY_KEY);
      if (Array.isArray(banks)) this.banks = banks as BankInfo[];
    } catch { this.banks = []; }
  }

  // ---------- 题库 ----------
  listBanks(): BankInfo[] { return [...this.banks]; }

  async createBank(name: string): Promise<BankInfo> {
    const clean = name.trim();
    if (!clean) throw new Error("题库名不能为空");
    const notebookId = await this.deps.client.createNotebook(`题库/${clean}`);
    await this.deps.client.createDocWithMd(notebookId, "/首页", `# 题库：${clean}\n\n> 本笔记本由小驴考试管理。章节文档存放题目块。\n`);
    const info: BankInfo = { id: notebookId, name: clean, createdAt: Date.now() };
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

  /** 导入提交：按考点落章节文档（无考点 → "导入/<批次>"），返回写入数 */
  async commitImport(bankId: string, report: ImportReport): Promise<{ written: number; docs: string[] }> {
    if (!report.ok.length) return { written: 0, docs: [] };
    const byDoc = new Map<string, typeof report.ok>();
    for (const q of report.ok) {
      const doc = q.kp ? `/${q.kp.split("/")[0]}` : `/导入/${report.batch}`;
      if (!byDoc.has(doc)) byDoc.set(doc, []);
      byDoc.get(doc)!.push(q);
    }
    let written = 0;
    const docs: string[] = [];
    for (const [doc, qs] of byDoc) {
      const docId = await this.ensureDoc(bankId, doc);
      await this.deps.client.appendQuestions(docId, qs);
      written += qs.length;
      docs.push(doc);
    }
    this.invalidate();
    return { written, docs };
  }

  private async ensureDoc(bankId: string, hpath: string): Promise<string> {
    // createDocWithMd 幂等：已存在返回 ""（思源行为）——先查再建
    const existing = await this.deps.client.sql(
      `SELECT id FROM blocks WHERE box='${bankId.replace(/'/g, "''")}' AND hpath='${hpath.replace(/'/g, "''")}' AND type='d' LIMIT 1`,
    );
    if (existing[0]?.id) return String(existing[0].id);
    return this.deps.client.createDocWithMd(bankId, hpath, `# ${hpath.split("/").pop()}\n\n`);
  }

  async listQuestions(bankId: string): Promise<(Question & { blockId: string })[]> {
    return this.deps.client.listQuestions(bankId);
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

  wrongItems(): WrongItem[] { return activeWrongItems(this.derived()); }

  async saveWrongReason(qid: string, reason: "careless" | "unknown" | "trap"): Promise<void> {
    const key = WRONG_REASON_KEY_PREFIX + qid;
    await this.deps.storage.save(key, { reason, at: Date.now() });
  }

  async loadWrongReason(qid: string): Promise<string | undefined> {
    const v = await this.deps.storage.load(WRONG_REASON_KEY_PREFIX + qid) as { reason?: string } | undefined;
    return v?.reason;
  }

  private invalidate() { this.replayCache = null; }

  async flush(): Promise<void> { await this.attempts.flush(); }

  // ---------- 会话（单活动） ----------
  currentSession(): PracticeSession | null { return this.activeSession; }

  async startSession(questions: Question[], mode: string): Promise<PracticeSession> {
    if (this.activeSession && this.activeSession.phase === "running") {
      throw new Error("已有进行中的会话：请先继续或放弃");
    }
    this.activeSession = new PracticeSession(questions, mode, undefined, this.deps.now ?? (() => Date.now()));
    await this.saveSession();
    return this.activeSession;
  }

  /** 恢复（含启动时）：questionLoader 负责按 qids 补题面 */
  async resumeSession(questionLoader: (qids: string[]) => Promise<Question[]>): Promise<PracticeSession | null> {
    if (this.activeSession?.phase === "running") return this.activeSession;
    try {
      const saved = await this.deps.storage.load(SESSION_KEY) as SessionState | undefined;
      if (!saved?.qids?.length || saved.finishedAt) return null;
      const qs = await questionLoader(saved.qids);
      if (!qs.length) return null;
      this.activeSession = new PracticeSession(qs, saved.mode, saved, this.deps.now ?? (() => Date.now()));
      return this.activeSession;
    } catch {
      return null;
    }
  }

  async saveSession(): Promise<void> {
    const s = this.activeSession;
    if (!s) return;
    if (s.phase === "finished") await this.deps.storage.save(SESSION_KEY, null);
    else await this.deps.storage.save(SESSION_KEY, s.state);
  }

  async discardSession(): Promise<void> {
    this.activeSession = null;
    await this.deps.storage.save(SESSION_KEY, null);
  }

  // ---------- 常用抽题 ----------
  quickDrill(questions: Question[], n: number): Question[] {
    return pickRandom(questions, n);
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
