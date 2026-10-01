// ============================================================
// 模考引擎（v0.3）：组卷蓝图 / 分段计时 / 作答与标记 / 结算判分
// 纯状态机无 IO —— 计时由调用方喂数据（now()），UI 只读派生状态
// ============================================================
import type { Question } from "./types";
import { grade, type GradeResult } from "./answer";

// ---------- 蓝图 ----------
export type SectionSource = "real" | "mock" | "mixed";

export interface BlueprintSection {
  name: string;
  count: number;
  scoreEach: number;
  source: SectionSource;
  types: Question["type"][];    // 允许的题型（空 = 不限）
}

export interface Blueprint {
  id: string;
  name: string;
  durationS: number;            // 总时长
  passLine: number;             // 及格线（百分制）
  shuffleOptions: boolean;
  sectionTimed: boolean;        // 分段计时
  sections: BlueprintSection[];
}

export interface AssembleReport {
  paper: Question[];            // 顺序：按 section 依次拼接
  sectionOf: Map<string, string>;      // qid → section name
  scoreOf: Map<string, number>;        // qid → 分值
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
  const matchesTypes = (q: Question, s: BlueprintSection) =>
    !s.types.length || s.types.includes(q.type);

  for (const s of bp.sections) {
    let pool = bank.filter((q) => !used.has(q.id) && matchesSource(q, s) && matchesTypes(q, s));
    const strictCount = pool.length;
    // strict 不够且允许 mixed → 用其他来源补齐（显式计数，蓝图配置器出警告）
    if (strictCount < s.count && s.source !== "mixed") {
      const extra = bank.filter(
        (q) => !used.has(q.id) && !pool.includes(q) && matchesTypes(q, s),
      );
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
  answeredAt: number;           // 相对开考 ms
  changes: number;
}

export interface MockState {
  blueprint: Blueprint;
  qids: string[];
  startedAt: number;            // wall clock
  finishedAt?: number;
}

export class MockSession {
  readonly state: MockState;
  private readonly sectionOf: Map<string, string>;
  private readonly scoreOf: Map<string, number>;
  readonly answers = new Map<string, MockAnswer>();
  readonly flags = new Set<string>();
  screenSwitches = 0;
  private readonly byId: Map<string, Question>;
  private readonly sectionStart: Record<string, number> = {};   // section 名 → 进入时刻（相对 ms）
  /** 已提交（含自动交卷）标记 */
  submitted = false;

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
    if (bp.sectionTimed && paper[0]) {
      const first = this.sectionOf.get(paper[0].id);
      if (first) this.sectionStart[first] = 0;
    }
  }

  sectionOfQ(qid: string): string { return this.sectionOf.get(qid) ?? ""; }

  /** 相对开考的经过毫秒 */
  elapsed(now: number): number { return Math.max(0, now - this.state.startedAt); }

  /** 剩余总时长 ms（负数=已超时） */
  remaining(now: number): number { return this.bp.durationS * 1000 - this.elapsed(now); }

  /** 当前段剩余（分段计时模式）：按该段题量折算份额；归零即应跳段 */
  sectionRemaining(section: string, now: number): number | null {
    if (!this.bp.sectionTimed) return null;
    const totalQ = this.state.qids.length || 1;
    const secQ = this.state.qids.filter((id) => this.sectionOf.get(id) === section).length || 1;
    const budget = (this.bp.durationS * 1000 * secQ) / totalQ;
    const spent = this.elapsed(now) - (this.sectionStart[section] ?? 0);
    return budget - spent;
  }

  /** 段切换：记录新段起始（UI 跳段时调用） */
  enterSection(section: string, now: number) {
    if (this.bp.sectionTimed && this.sectionStart[section] === undefined) {
      this.sectionStart[section] = this.elapsed(now);
    }
  }

  setAnswer(qid: string, answer: string | null, now: number) {
    const prev = this.answers.get(qid);
    const q = this.byId.get(qid);
    if (!q) return;
    const g = grade(q, answer);
    this.answers.set(qid, {
      qid,
      answer,
      verdict: g.verdict,
      timeMs: (prev?.timeMs ?? 0) + 500,
      answeredAt: this.elapsed(now),
      changes: (prev?.changes ?? 0) + (prev?.answer != null ? 1 : 0),
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
    if (!this.submitted) this.state.finishedAt = now;
    this.submitted = true;
  }

  /** 结算（docs/11 S7 四维）：未作答按 not_attempted 计 0 分 */
  score(): MockScore {
    const sections = new Map<string, { name: string; score: number; full: number; correct: number; total: number; timeSpentMs: number; overtimeQ: number }>();
    for (const s of this.bp.sections) {
      sections.set(s.name, { name: s.name, score: 0, full: s.count * s.scoreEach, correct: 0, total: 0, timeSpentMs: 0, overtimeQ: 0 });
    }
    for (const [qid, a] of this.answers) {
      const name = this.sectionOf.get(qid);
      const sec = name ? sections.get(name) : undefined;
      if (!sec) continue;
      sec.total++;
      sec.timeSpentMs += a.timeMs;
      if (a.verdict === "correct") { sec.correct++; sec.score += this.scoreOf.get(qid) ?? 0; }
    }
    // 未答的题占满额
    for (const qid of this.state.qids) {
      const name = this.sectionOf.get(qid);
      const sec = name ? sections.get(name) : undefined;
      if (sec && !this.answers.has(qid)) sec.total++;
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
    let attempted = 0, correct = 0;
    for (const a of this.answers.values()) {
      if (a.answeredAt >= cutoff) { attempted++; if (a.verdict === "correct") correct++; }
    }
    return { attempted, correct };
  }
}

export interface MockScore {
  total: number;
  full: number;
  pass: boolean;
  percent: number;
  sections: { name: string; score: number; full: number; correct: number; total: number; timeSpentMs: number; overtimeQ: number }[];
  flagsUsed: number;
  changes: number;
  screenSwitches: number;
  last20min: { attempted: number; correct: number };
}
