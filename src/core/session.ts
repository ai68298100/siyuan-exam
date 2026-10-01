// ============================================================
// 练习会话引擎（纯状态机；持久化/事件写入由上层组装）
// 单活动语义：finish 后归档；drafts 逐题草稿；恢复=按 qids+cursor 重建
// ============================================================
import type { Question, SessionState } from "./types";
import { grade, type GradeResult } from "./answer";
import { newSessionId } from "./ids";

export type SessionPhase = "running" | "finished";

export class PracticeSession {
  readonly state: SessionState;
  private readonly byId: Map<string, Question>;
  private readonly requeued = new Set<string>();
  /** 需要写入流水的事件（作答），上层读取后批量 append */
  readonly answered: { qid: string; grade: GradeResult; timeMs: number }[] = [];

  constructor(questions: Question[], mode: string, existing?: SessionState, private readonly now: () => number = Date.now) {
    this.byId = new Map(questions.map((q) => [q.id, q]));
    if (existing) {
      this.state = { ...existing, finishedAt: undefined };
    } else {
      this.state = {
        id: newSessionId(),
        mode,
        qids: questions.map((q) => q.id),
        cursor: 0,
        drafts: {},
        startedAt: now(),
        updatedAt: now(),
      };
    }
  }

  get id() { return this.state.id; }
  get phase(): SessionPhase { return this.state.finishedAt ? "finished" : "running"; }
  get current(): Question | null {
    const id = this.state.qids[this.state.cursor];
    return id ? this.byId.get(id) ?? null : null;
  }
  get progress() { return { done: this.state.cursor, total: this.state.qids.length }; }

  setDraft(qid: string, value: string) {
    this.state.drafts[qid] = value;
    this.touch();
  }

  getDraft(qid: string): string { return this.state.drafts[qid] ?? ""; }

  /** 提交当前题：判分 + 记录待写流水事件；返回判分结果（UI 渲染反馈态） */
  submit(myAnswer: string | null, timeMs = 0): { q: Question; grade: GradeResult } | null {
    const q = this.current;
    if (!q || this.phase === "finished") return null;
    const g = grade(q, myAnswer);
    this.answered.push({ qid: q.id, grade: g, timeMs });
    // 学习科学 re-review：答错且尚未重排过 → 排到队尾再来一次（每题至多一次，防死循环）
    if (g.verdict === "wrong" && !this.requeued.has(q.id)) {
      this.requeued.add(q.id);
      this.state.qids.push(q.id);
    }
    this.touch();
    return { q, grade: g };
  }

  next(): boolean {
    if (this.state.cursor < this.state.qids.length - 1) {
      this.state.cursor++;
      this.touch();
      return true;
    }
    return false;
  }

  prev(): boolean {
    if (this.state.cursor > 0) {
      this.state.cursor--;
      this.touch();
      return true;
    }
    return false;
  }

  /** 结束会话（幂等）：返回本会话统计 */
  finish(): { total: number; correct: number; wrong: number } {
    if (!this.state.finishedAt) {
      this.state.finishedAt = this.now();
      this.touch();
    }
    const correct = this.answered.filter((a) => a.grade.verdict === "correct").length;
    const wrong = this.answered.filter((a) => a.grade.verdict === "wrong").length;
    return { total: this.answered.length, correct, wrong };
  }

  private touch() { this.state.updatedAt = this.now(); }
}

/** 抽题策略：随机 n 题（快刷）；后续模式（错题/收藏/cram）在此扩展 */
export function pickRandom(questions: Question[], n: number, rnd: () => number = Math.random): Question[] {
  const pool = [...questions];
  const out: Question[] = [];
  while (pool.length && out.length < n) {
    out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  }
  return out;
}

/** 材料组聚拢：同 exam-group 的题目排到相邻位置，组间保持首次出现顺序 */
export function groupAdjacent(questions: Question[]): Question[] {
  const groups = new Map<string, Question[]>();
  const loose: Question[] = [];
  for (const q of questions) {
    if (q.group) {
      const arr = groups.get(q.group) ?? [];
      arr.push(q);
      groups.set(q.group, arr);
    } else {
      loose.push(q);
    }
  }
  return [...Array.from(groups.values()).flat(), ...loose];
}
