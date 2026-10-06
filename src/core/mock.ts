// ============================================================
// 模考引擎（v0.3）：组卷蓝图 / 分段计时 / 作答与标记 / 结算判分
// 纯状态机无 IO —— 计时由调用方喂数据（now()），UI 只读派生状态
// ============================================================
import type { Question } from "./types";
import { SCHEMA_VERSION } from "./types";
import { grade, type GradeResult } from "./answer";
import { gradeIndefinite, guardLockout } from "./cbt";

// ---------- 蓝图 ----------
export type SectionSource = "real" | "mock" | "mixed";

export interface BlueprintSection {
  name: string;
  count: number;
  scoreEach: number;
  source: SectionSource;
  types: Question["type"][]; // 允许的题型（空 = 不限）
  /** 55-02 lite：考点配额（前缀匹配，"资料" 命中 "资料/比重"）；缺口显式计入 shortages，不用其他考点偷偷补齐 */
  kp?: string;
  indefinite?: boolean; // 不定项：少选按比例部分分、错选全扣（cbt.gradeIndefinite）
}

export interface Blueprint {
  id: string;
  name: string;
  durationS: number; // 总时长
  passLine: number; // 及格线（百分制）
  shuffleOptions: boolean;
  sectionTimed: boolean; // 分段计时
  lockout?: boolean; // 人机对话作答流锁：不可回退、顺序作答
  sections: BlueprintSection[];
}

/** 蓝图健康检查（40-02 lite）：返回人类可读问题清单（空数组=健康）。
 *  重名段必须处理——sectionOf/成绩按段名聚合，重名会把两段统计挤成一团 */
export function validateBlueprint(bp: Blueprint): string[] {
  const issues: string[] = [];
  const seen = new Map<string, number>();
  for (const s of bp.sections) {
    const name = s.name.trim();
    if (!name) issues.push(`存在未命名段（段名不能为空）`);
    else seen.set(name, (seen.get(name) ?? 0) + 1);
    if (s.count === 0) issues.push(`段「${name || "未命名"}」题数为 0（将不参与组卷）`);
    if (s.scoreEach <= 0) issues.push(`段「${name || "未命名"}」每题分值 ≤ 0`);
  }
  for (const [name, n] of seen) {
    if (n > 1) issues.push(`段名「${name}」重复 ${n} 次（统计将按段名合并）`);
  }
  if (bp.durationS <= 0) issues.push("总时长 ≤ 0");
  if (bp.passLine < 0 || bp.passLine > 100) issues.push(`及格线 ${bp.passLine} 超出 0-100`);
  return issues;
}

/** 重名段自动改名（40-02 lite）：加 -2/-3 后缀去重；返回新蓝图（不改原对象） */
export function dedupeSectionNames(bp: Blueprint): Blueprint {
  const seen = new Map<string, number>();
  return {
    ...bp,
    sections: bp.sections.map((s) => {
      const name = s.name.trim() || "未命名";
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      return n === 1 ? { ...s, name } : { ...s, name: `${name}-${n}` };
    }),
  };
}

export interface AssembleReport {
  paper: Question[]; // 顺序：按 section 依次拼接
  sectionOf: Map<string, string>; // qid → section name
  scoreOf: Map<string, number>; // qid → 分值
  shortages: { name: string; need: number; have: number; filledFromMixed: number }[];
}

/** 组卷：按蓝图从题库抽题；来源不够时 mixed 兜底并产出短缺报告（docs/11 S5） */
export function assemble(
  bp: Blueprint,
  bank: (Question & { blockId?: string })[],
  rnd: () => number = Math.random,
): AssembleReport {
  const paper: Question[] = [];
  const sectionOf = new Map<string, string>();
  const scoreOf = new Map<string, number>();
  const shortages: AssembleReport["shortages"] = [];
  const used = new Set<string>();

  const matchesSource = (q: Question, s: BlueprintSection) =>
    s.source === "mixed" || (q.sourceKind ?? "mock") === s.source;
  const matchesTypes = (q: Question, s: BlueprintSection) => !s.types.length || s.types.includes(q.type);
  // 55-02 lite：考点配额按前缀命中（"资料" 命中 "资料/比重"）；即使 source=mixed 补齐也必须满足考点——
  // 配额缺口宁可短缺显式报告，不用其他考点偷偷补齐（55-02 验收口径）
  const matchesKp = (q: Question, s: BlueprintSection) =>
    !s.kp || q.kp === s.kp || (q.kp?.startsWith(s.kp + "/") ?? false);

  for (const s of bp.sections) {
    let pool = bank.filter((q) => !used.has(q.id) && matchesSource(q, s) && matchesTypes(q, s) && matchesKp(q, s));
    const strictCount = pool.length;
    // strict 不够且允许 mixed → 用其他来源补齐（考点配额仍生效；显式计数，蓝图配置器出警告）
    if (strictCount < s.count && s.source !== "mixed") {
      const extra = bank.filter((q) => !used.has(q.id) && !pool.includes(q) && matchesTypes(q, s) && matchesKp(q, s));
      pool = pool.concat(extra);
    }
    const picked: Question[] = [];
    while (picked.length < s.count && pool.length) {
      picked.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    }
    const filledFromMixed = Math.max(0, picked.length - strictCount);
    picked.forEach((q) => {
      used.add(q.id);
      paper.push(q);
      sectionOf.set(q.id, s.name);
      scoreOf.set(q.id, s.scoreEach);
    });
    if (picked.length < s.count || filledFromMixed > 0) {
      shortages.push({ name: s.name, need: s.count, have: picked.length, filledFromMixed });
    }
  }
  return { paper, sectionOf, scoreOf, shortages };
}

/** 蓝图合计校验（题数/总分） */
export function blueprintTotals(bp: Blueprint): { questions: number; score: number } {
  return {
    questions: bp.sections.reduce((n, s) => n + s.count, 0),
    score: bp.sections.reduce((n, s) => n + s.count * s.scoreEach, 0),
  };
}

// ---------- 模考会话 ----------
export interface MockAnswer {
  qid: string;
  answer: string | null;
  verdict: GradeResult["verdict"];
  timeMs: number;
  answeredAt: number; // 相对开考 ms
  changes: number;
  /** 不定项部分分系数 0-1（非不定项恒 1/0 随 verdict） */
  factor: number;
}

export interface MockState {
  blueprint: Blueprint;
  qids: string[];
  startedAt: number; // wall clock
  finishedAt?: number;
  /** 55-06 lite：累计延时秒（单次条件覆盖；随快照持久化，成绩单明示） */
  extraTimeS?: number;
}

export class MockSession {
  readonly state: MockState;
  private readonly sectionOf: Map<string, string>;
  private readonly scoreOf: Map<string, number>;
  readonly answers = new Map<string, MockAnswer>();
  readonly flags = new Set<string>();
  screenSwitches = 0;
  /** 当前题索引（人机对话导航） */
  cursor = 0;
  private readonly byId: Map<string, Question>;
  private readonly indefinite: Set<string>;
  private readonly sectionStart: Record<string, number> = {}; // section 名 → 进入时刻（相对 ms）
  /** 逐题驻留计时（40-03）：导航切题时结算上一题，作答时刻取真实累计 */
  private readonly dwell = new Map<string, number>();
  private currentEnter: { qid: string; at: number } = { qid: "", at: 0 };
  /** 已提交（含自动交卷）标记 */
  submitted = false;
  /** 开考冻结题版（55-07 lite）：hash+answer 逐题指纹，改题后成绩可对照开考版本 */
  readonly qVersions: Map<string, { hash: string; answer: string }>;

  constructor(
    readonly bp: Blueprint,
    readonly paper: Question[],
    assembleInfo: { sectionOf: Map<string, string>; scoreOf: Map<string, number> },
    startedAt: number,
  ) {
    this.state = { blueprint: bp, qids: paper.map((q) => q.id), startedAt };
    this.sectionOf = assembleInfo.sectionOf;
    this.scoreOf = assembleInfo.scoreOf;
    this.byId = new Map(paper.map((q) => [q.id, q]));
    this.qVersions = new Map(paper.map((q) => [q.id, { hash: q.hash, answer: q.answer }]));
    this.indefinite = new Set();
    for (const q of paper) {
      const secName = assembleInfo.sectionOf.get(q.id);
      const sec = bp.sections.find((s) => s.name === secName);
      if (sec?.indefinite) this.indefinite.add(q.id);
    }
    if (bp.sectionTimed && paper[0]) {
      const first = this.sectionOf.get(paper[0].id);
      if (first) this.sectionStart[first] = 0;
    }
    if (paper[0]) this.currentEnter = { qid: paper[0].id, at: startedAt };
  }

  sectionOfQ(qid: string): string {
    return this.sectionOf.get(qid) ?? "";
  }

  /** 相对开考的经过毫秒 */
  elapsed(now: number): number {
    return Math.max(0, now - this.state.startedAt);
  }

  /** 剩余总时长 ms（负数=已超时）；55-06 lite：含累计延时 */
  remaining(now: number): number {
    return this.bp.durationS * 1000 + (this.state.extraTimeS ?? 0) * 1000 - this.elapsed(now);
  }

  /** 55-06 lite：单次条件覆盖——延长本次考试 N 秒（已交卷拒绝）；返回累计延时秒。
   *  条件入快照，成绩单明示；原蓝图与冻结卷面不变。 */
  extendTime(seconds: number): number | null {
    if (this.submitted || seconds <= 0) return null;
    this.state.extraTimeS = (this.state.extraTimeS ?? 0) + seconds;
    return this.state.extraTimeS;
  }

  /** 当前段剩余（分段计时模式）：按该段题量折算份额（含延时按比例摊入）；归零即应跳段 */
  sectionRemaining(section: string, now: number): number | null {
    if (!this.bp.sectionTimed) return null;
    const totalQ = this.state.qids.length || 1;
    const secQ = this.state.qids.filter((id) => this.sectionOf.get(id) === section).length || 1;
    const budget = ((this.bp.durationS + (this.state.extraTimeS ?? 0)) * 1000 * secQ) / totalQ;
    const spent = this.elapsed(now) - (this.sectionStart[section] ?? 0);
    return budget - spent;
  }

  /** 段切换：记录新段起始（UI 跳段时调用） */
  enterSection(section: string, now: number) {
    if (this.bp.sectionTimed && this.sectionStart[section] === undefined) {
      this.sectionStart[section] = this.elapsed(now);
    }
  }

  /** 导航：lockout 蓝图下强制顺序作答（cbt.guardLockout）；普通蓝图自由跳题。
   *  切题即结算上一题驻留（40-03 真实用时，替代固定 +500ms） */
  navigateTo(index: number, now: number): boolean {
    const last = this.state.qids.length - 1;
    if (this.bp.lockout) {
      const flags = this.state.qids.map((id) => this.answers.has(id));
      this.cursor = guardLockout(index, flags, this.cursor);
    } else {
      this.cursor = Math.max(0, Math.min(last, index));
    }
    const qid = this.state.qids[this.cursor];
    if (qid) this.enterQuestion(qid, now);
    const secName = this.sectionOf.get(qid ?? "");
    if (secName) this.enterSection(secName, now);
    return true;
  }

  cursorIndex(): number {
    return this.cursor;
  }

  /** 进入某题：结算上一题驻留，开新计时；同题重复调用不重复结算 */
  enterQuestion(qid: string, now: number) {
    if (this.currentEnter.qid && this.currentEnter.qid !== qid) {
      const prev = this.dwell.get(this.currentEnter.qid) ?? 0;
      this.dwell.set(this.currentEnter.qid, prev + Math.max(0, now - this.currentEnter.at));
    }
    if (this.currentEnter.qid !== qid) this.currentEnter = { qid, at: now };
  }

  /** 某题到 now 为止的真实驻留毫秒 */
  dwellOf(qid: string, now: number): number {
    let ms = this.dwell.get(qid) ?? 0;
    if (this.currentEnter.qid === qid) ms += Math.max(0, now - this.currentEnter.at);
    return ms;
  }

  setAnswer(qid: string, answer: string | null, now: number) {
    const prev = this.answers.get(qid);
    const q = this.byId.get(qid);
    if (!q) return;
    let g = grade(q, answer);
    let factor = g.verdict === "correct" ? 1 : 0;
    if (this.indefinite.has(qid)) {
      const gi = gradeIndefinite(q, answer);
      g = { verdict: gi.verdict, myAnswer: gi.myAnswer };
      factor = gi.factor;
    }
    this.answers.set(qid, {
      qid,
      answer,
      verdict: g.verdict,
      timeMs: this.dwellOf(qid, now),
      answeredAt: this.elapsed(now),
      changes: (prev?.changes ?? 0) + (prev?.answer != null ? 1 : 0),
      factor,
    });
  }

  toggleFlag(qid: string) {
    if (this.flags.has(qid)) this.flags.delete(qid);
    else this.flags.add(qid);
  }

  /** 是否应自动交卷（总时归零） */
  shouldAutoSubmit(now: number): boolean {
    return !this.submitted && this.remaining(now) <= 0;
  }

  submit(now: number) {
    if (!this.submitted) {
      this.state.finishedAt = now;
      // 交卷即结算当前题驻留（之后不再计时）
      if (this.currentEnter.qid) {
        const prev = this.dwell.get(this.currentEnter.qid) ?? 0;
        this.dwell.set(this.currentEnter.qid, prev + Math.max(0, now - this.currentEnter.at));
        this.currentEnter = { qid: "", at: 0 };
      }
    }
    this.submitted = true;
  }

  /** 结算（docs/11 S7 四维）：未作答按 not_attempted 计 0 分。
   *  40-02 逐段满分标注：full 按实际卷面题数计（短缺段不再虚高），required/short 如实标注短缺。 */
  score(): MockScore {
    const sections = new Map<
      string,
      {
        name: string;
        score: number;
        full: number;
        required: number;
        short: boolean;
        correct: number;
        total: number;
        timeSpentMs: number;
        overtimeQ: number;
      }
    >();
    // 逐段实际卷面（state.qids）：actual full = 该段实际题的分值合计（短缺段不虚高）
    for (const qid of this.state.qids) {
      const name = this.sectionOf.get(qid);
      if (!name) continue;
      if (!sections.has(name)) {
        const bpSec = this.bp.sections.find((s) => s.name === name);
        sections.set(name, {
          name,
          score: 0,
          full: 0,
          required: bpSec?.count ?? 0,
          short: false,
          correct: 0,
          total: 0,
          timeSpentMs: 0,
          overtimeQ: 0,
        });
      }
      const sec = sections.get(name)!;
      sec.full += this.scoreOf.get(qid) ?? 0;
    }
    for (const [qid, a] of this.answers) {
      const name = this.sectionOf.get(qid);
      const sec = name ? sections.get(name) : undefined;
      if (!sec) continue;
      sec.total++;
      sec.timeSpentMs += a.timeMs;
      if (a.verdict === "correct") {
        sec.correct++;
      }
      // 不定项部分分：scoreEach × factor；整题对=1；错=0
      sec.score += (this.scoreOf.get(qid) ?? 0) * (a.verdict === "correct" ? 1 : a.factor);
    }
    // 未答的题占满额
    for (const qid of this.state.qids) {
      const name = this.sectionOf.get(qid);
      const sec = name ? sections.get(name) : undefined;
      if (sec && !this.answers.has(qid)) sec.total++;
    }
    // 40-02：required/short 在 total 统计完成后判定（提前算 total=0 会全段误标短缺）
    for (const s of sections.values()) {
      const bpSec = this.bp.sections.find((x) => x.name === s.name);
      s.required = bpSec?.count ?? s.total;
      s.short = s.total < s.required;
    }
    const last20 = this.last20min();
    const total = [...sections.values()].reduce((n, s) => n + s.score, 0);
    const full = [...sections.values()].reduce((n, s) => n + s.full, 0);
    return {
      total,
      full,
      pass: total >= this.bp.passLine,
      percent: full ? Math.round((total / full) * 1000) / 10 : 0,
      sections: [...sections.values()],
      flagsUsed: this.flags.size,
      changes: [...this.answers.values()].reduce((n, a) => n + a.changes, 0),
      screenSwitches: this.screenSwitches,
      last20min: last20,
    };
  }

  private last20min() {
    const cutoff = this.bp.durationS * 1000 - 20 * 60 * 1000;
    let attempted = 0,
      correct = 0;
    for (const a of this.answers.values()) {
      if (a.answeredAt >= cutoff) {
        attempted++;
        if (a.verdict === "correct") correct++;
      }
    }
    return { attempted, correct };
  }

  /** 导出运行快照（JSON 可序列化；runId 由调用方生成，一次考试固定） */
  toSnapshot(runId: string, now: number = Date.now()): MockRunSnapshot {
    return {
      v: SCHEMA_VERSION,
      runId,
      bp: JSON.parse(JSON.stringify(this.bp)) as Blueprint,
      qids: [...this.state.qids],
      sectionOf: Object.fromEntries(this.sectionOf),
      scoreOf: Object.fromEntries(this.scoreOf),
      indefinite: [...this.indefinite],
      startedAt: this.state.startedAt,
      savedAt: now,
      answers: [...this.answers.values()],
      flags: [...this.flags],
      cursor: this.cursor,
      sectionStart: { ...this.sectionStart },
      screenSwitches: this.screenSwitches,
      dwell: Object.fromEntries(this.dwell),
      currentEnter: { ...this.currentEnter },
      finishedAt: this.state.finishedAt,
      /** 55-07 lite：开考冻结题版（旧快照无此字段 → 恢复后 drift 不可知，如实不标注） */
      qVersions: Object.fromEntries(this.qVersions),
      /** 55-06 lite：累计延时秒（未延时缺省不写字段） */
      ...(this.state.extraTimeS ? { extraTimeS: this.state.extraTimeS } : {}),
    };
  }

  /** 修订漂移（55-07 lite）：当前题库相对开考冻结版本已变化的题（删除另由 missingQids 报告）。
   *  用途：成绩单标注"题目已修订，成绩按开考版本记录"，历史不静默重算。 */
  revisionDrift(live: Question[]): string[] {
    if (!this.qVersions.size) return [];
    const byId = new Map(live.map((q) => [q.id, q]));
    return this.state.qids.filter((qid) => {
      const frozen = this.qVersions.get(qid);
      const q = byId.get(qid);
      return !!frozen && !!q && q.hash !== frozen.hash;
    });
  }

  /** 从快照恢复同一 run：答案/标旗/游标/分段起始原样回填；
   *  卷面缺失题（题库读不到）如实剔除并报告，不用其他题顶替。 */
  static restore(snap: MockRunSnapshot, paper: Question[]): MockRestoreResult {
    const byId = new Map(paper.map((q) => [q.id, q]));
    const found = snap.qids.map((id) => byId.get(id)).filter((q): q is Question => !!q);
    const missingQids = snap.qids.filter((id) => !byId.has(id));
    const session = new MockSession(
      snap.bp,
      found,
      { sectionOf: new Map(Object.entries(snap.sectionOf)), scoreOf: new Map(Object.entries(snap.scoreOf)) },
      snap.startedAt,
    );
    for (const a of snap.answers) session.answers.set(a.qid, a);
    for (const f of snap.flags) session.flags.add(f);
    session.cursor = Math.max(0, Math.min(found.length - 1, snap.cursor));
    for (const [k, v] of Object.entries(snap.sectionStart)) session.sectionStart[k] = v;
    session.screenSwitches = snap.screenSwitches;
    for (const [qid, ms] of Object.entries(snap.dwell ?? {})) session.dwell.set(qid, ms);
    if (snap.currentEnter?.qid) session.currentEnter = { qid: snap.currentEnter.qid, at: snap.currentEnter.at };
    session.submitted = !!snap.finishedAt;
    if (snap.finishedAt) session.state.finishedAt = snap.finishedAt;
    // 55-07 lite：冻结题版以快照为准（构造时按当前题库重冻结会掩盖 drift）
    if (snap.qVersions) {
      session.qVersions.clear();
      for (const [qid, ver] of Object.entries(snap.qVersions)) session.qVersions.set(qid, ver);
    }
    // 55-06 lite：延时条件随快照恢复
    if (snap.extraTimeS) session.state.extraTimeS = snap.extraTimeS;
    return { session, missingQids, alreadySubmitted: !!snap.finishedAt };
  }
}

export interface MockScore {
  total: number;
  full: number;
  pass: boolean;
  percent: number;
  sections: {
    name: string;
    score: number;
    full: number;
    /** 40-02：蓝图要求题数（短缺标注用） */
    required: number;
    /** 40-02：实际卷面 < 要求 → 短路段如实标注 */
    short: boolean;
    correct: number;
    total: number;
    timeSpentMs: number;
    overtimeQ: number;
  }[];
  flagsUsed: number;
  changes: number;
  screenSwitches: number;
  last20min: { attempted: number; correct: number };
}

// ---------- 运行快照（v0.6；docs/19 Q4 / U18–U20 最小切片） ----------
// runId 与蓝图 id 分离：同蓝图多次考试互不覆盖；startedAt 为 wall clock，
// 恢复后剩余时间按真实流逝计算（休眠/关页不清零计时）。

export interface MockRunSnapshot {
  v: number; // SCHEMA_VERSION
  runId: string; // 本次考试运行 id（r-…）
  bp: Blueprint; // 开考时冻结的蓝图拷贝
  qids: string[]; // 冻结卷面顺序
  sectionOf: Record<string, string>; // qid → 段名
  scoreOf: Record<string, number>; // qid → 分值
  indefinite: string[]; // 不定项 qids
  startedAt: number; // wall clock 开考时刻
  savedAt: number; // 快照保存时刻
  answers: MockAnswer[];
  flags: string[];
  cursor: number;
  sectionStart: Record<string, number>;
  screenSwitches: number;
  /** 逐题驻留毫秒（40-03；旧快照缺省 = 恢复后重新累计） */
  dwell?: Record<string, number>;
  currentEnter?: { qid: string; at: number };
  finishedAt?: number; // 已交卷（恢复时直接进报告，不重考）
  /** 55-07 lite：开考冻结题版（qid → hash+answer）；旧快照缺省 */
  qVersions?: Record<string, { hash: string; answer: string }>;
  /** 55-06 lite：累计延时秒（单次条件覆盖；成绩单明示「延时 N 分钟」，旧快照缺省） */
  extraTimeS?: number;
}

/** 恢复报告：missingQids = 卷面有但题库已读不到的题（改题/删题后如实降级，不静默补题） */
export interface MockRestoreResult {
  session: MockSession;
  missingQids: string[];
  /** 快照里已交卷（恢复后只应看报告，不允许再次作答） */
  alreadySubmitted: boolean;
}
