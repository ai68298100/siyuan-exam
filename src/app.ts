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
import { deckNameForBank, selfRatingToRiffRating, pickSameKp, cramQueue, dailySet } from "./core/memory";
import type { ImportReport } from "./importer/pipeline";

export interface BankInfo { id: string; name: string; createdAt: number }

export interface MockRecord {
  id: string;               // 蓝图 id
  name: string;
  startedAt: number;
  total: number;
  full: number;
  percent: number;
  pass: boolean;
  /** 分模块明细（历史详情回看；旧记录无此字段需容错） */
  sections?: { name: string; score: number; full: number; correct: number; total: number }[];
}

const MOCK_RESULTS_KEY = "mock/results";

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

  async listQuestions(bankId: string): Promise<(Question & { blockId: string; rootId: string })[]> {
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

  /** 手工录题：按考点落文档（无考点 → /手工录入），写块入库 */
  async writeManualQuestion(bankId: string, q: Question): Promise<void> {
    const docId = await this.ensureDoc(bankId, q.kp ? `/${q.kp.split("/")[0]}` : "/手工录入");
    await this.deps.client.appendQuestions(docId, [q]);
    this.invalidate();
  }

  /** 题目笔记子块（docs/02 §2.4）：kind = mnemonic | note | ai-explain */
  async appendQuestionNote(qid: string, blockId: string | undefined, text: string, kind: "mnemonic" | "note" | "ai-explain"): Promise<void> {
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

  // ---------- 题库包分享（v1.0；.sy.zip 原生格式） ----------
  async exportBankSyZip(bankId: string): Promise<{ zipPath: string; filename: string }> {
    const { zipPath } = await this.deps.client.exportNotebookSy(bankId);
    const filename = decodeURIComponent(zipPath.split("/").pop() ?? "bank.sy.zip");
    return { zipPath, filename };
  }

  async importBankSyZip(zipAbsPath: string): Promise<void> {
    await this.deps.client.importSy(zipAbsPath);
    this.banks = [];   // 触发题库列表重建
  }

  // ---------- 导出与模考历史（v0.5） ----------
  /** 错题册导出：生成 Markdown 并写入题库笔记本"导出"文档，返回文档 id
   *  过滤（27 组 P2）：kpRoot（考点首段）/ reason（错因）/ sinceDays（最近 N 天首次答错） */
  async exportWrongbook(bankId: string, bankName: string, opts: { kpRoot?: string; reason?: string; sinceDays?: number } = {}): Promise<string> {
    const { wrongbookToMarkdown } = await import("./core/exportMd");
    let items = this.wrongItems();
    if (opts.kpRoot || opts.reason || opts.sinceDays != null) {
      const qs = await this.listQuestions(bankId);
      const byId = new Map(qs.map((q) => [q.id, q]));
      const sinceTs = opts.sinceDays != null ? Date.now() - opts.sinceDays * 86_400_000 : 0;
      items = items.filter((w) => {
        const q = byId.get(w.qid);
        if (!q) return false;
        if (opts.kpRoot && q.kp?.split("/")[0] !== opts.kpRoot) return false;
        if (opts.reason && w.reason !== opts.reason) return false;
        if (opts.sinceDays != null && w.firstWrongAt < sinceTs) return false;
        return true;
      });
      const md = wrongbookToMarkdown(items.map((w) => ({ wrong: w, q: byId.get(w.qid)! })), { bankName, exportedAt: new Date() });
      await this.ensureDoc(bankId, "/导出");
      const tag = [opts.kpRoot, opts.reason, opts.sinceDays ? `${opts.sinceDays}d` : ""].filter(Boolean).join("-");
      const ymd = new Date().toISOString().slice(0, 10);
      return this.deps.client.createDocWithMd(bankId, `/导出/错题册 ${ymd} ${tag}`, md);
    }
    const qs = await this.listQuestions(bankId);
    const byId = new Map(qs.map((q) => [q.id, q]));
    const pairs = items.map((w) => ({ wrong: w, q: byId.get(w.qid)! })).filter((p) => p.q);
    const md = wrongbookToMarkdown(pairs, { bankName, exportedAt: new Date() });
    await this.ensureDoc(bankId, "/导出");
    const ymd = new Date().toISOString().slice(0, 10);
    return this.deps.client.createDocWithMd(bankId, `/导出/错题册 ${ymd}`, md);
  }

  /** 模考成绩持久化（上限 200 条，FIFO） */
  async saveMockResult(rec: MockRecord): Promise<void> {
    const list = await this.listMockResults();
    list.push(rec);
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
  async convertToCards(_bankId: string, bankName: string, questions: (Question & { blockId?: string })[]): Promise<number> {
    const blockIds = questions.map((q) => q.blockId).filter((s): s is string => !!s);
    if (!blockIds.length) return 0;
    const deckId = await this.ensureDeck(bankName);
    await this.deps.client.addRiffCards(deckId, blockIds);
    return blockIds.length;
  }

  /** 背诵/闪卡作答：写流水（kind=recite + selfRating）；若块已转卡则同步 riff 评级 */
  async reciteAnswer(bankName: string, q: Question & { blockId?: string }, selfRating: 1 | 2 | 3 | 4, sessionId: string, timeMs = 0): Promise<void> {
    const remembered = selfRating >= 3;
    this.recordAttempt({
      qid: q.id, kind: "recite", mode: "recite",
      verdict: remembered ? "correct" : "wrong",
      myAnswer: null, selfRating, sessionId, queue: "normal", timeMs,
    });
    if (q.blockId && this.kernelOnline) {
      try {
        const deckId = await this.ensureDeck(bankName);
        const ids = await this.deps.client.getCardIDsByBlockIDs([q.blockId]);
        const cardId = ids.get(q.blockId);
        if (cardId) await this.deps.client.reviewRiffCard(cardId, deckId, selfRatingToRiffRating(selfRating));
      } catch { /* riff 失败不阻塞背诵流水（离线降级语义） */ }
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
      const html = await this.deps.client.renderMarkdown(q.stem);
      this.renderCache.set(q.id, html);
      return html;
    } catch {
      return "";
    }
  }

  // ---------- 常用抽题 ----------
  /** 背诵池：优先错题；已毕业（背诵连击 ≥4）的题出清，回选择题形态 */
  recitePool(questions: Question[]): Question[] {
    const graduated = new Set(
      [...this.derived().reciteStreak.entries()].filter(([, s]) => s >= 4).map(([qid]) => qid),
    );
    const wrongs = this.wrongDrill(questions).filter((q) => !graduated.has(q.id));
    const rest = questions.filter((q) => !graduated.has(q.id) && !wrongs.includes(q));
    return wrongs.length ? wrongs : rest;
  }

  quickDrill(questions: Question[], n: number): Question[] {
    return pickRandom(questions, n);
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
