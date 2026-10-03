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

  constructor(
    questions: Question[],
    mode: string,
    existing?: SessionState,
    private readonly now: () => number = Date.now,
  ) {
    this.byId = new Map(questions.map((q) => [q.id, q]));
    if (existing) {
      this.state = { ...existing, finishedAt: undefined };
      // 37-05 续做完整性：回填已答结果与重排集合——恢复后结算/错题转卡名单与原进度一致
      for (const a of existing.answered ?? []) {
        this.answered.push({ qid: a.qid, grade: { verdict: a.verdict, myAnswer: a.myAnswer }, timeMs: a.timeMs });
      }
      for (const id of existing.requeued ?? []) this.requeued.add(id);
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

  get id() {
    return this.state.id;
  }
  get phase(): SessionPhase {
    return this.state.finishedAt ? "finished" : "running";
  }
  get current(): Question | null {
    const id = this.state.qids[this.state.cursor];
    return id ? (this.byId.get(id) ?? null) : null;
  }
  get progress() {
    return { done: this.state.cursor, total: this.state.qids.length };
  }

  setDraft(qid: string, value: string) {
    this.state.drafts[qid] = value;
    this.touch();
  }

  getDraft(qid: string): string {
    return this.state.drafts[qid] ?? "";
  }

  /** 提交当前题：判分 + 记录待写流水事件；返回判分结果（UI 渲染反馈态）。
   *  已答快照（含位置）与重排集合同步进 state（37-05），暂停/重载后可完整恢复。
   *  已答位置守卫（兜底审计）：K 回退到已答位置再提交返回 null 不重计；重排队错题在新位置可重答 */
  submit(myAnswer: string | null, timeMs = 0): { q: Question; grade: GradeResult } | null {
    const q = this.current;
    if (!q || this.phase === "finished") return null;
    if ((this.state.answered ?? []).some((a) => a.pos === this.state.cursor)) return null;
    const g = grade(q, myAnswer);
    this.answered.push({ qid: q.id, grade: g, timeMs });
    (this.state.answered ??= []).push({
      qid: q.id,
      pos: this.state.cursor,
      verdict: g.verdict,
      myAnswer: g.myAnswer,
      timeMs,
    });
    // 学习科学 re-review：答错且尚未重排过 → 排到队尾再来一次（每题至多一次，防死循环）
    if (g.verdict === "wrong" && !this.requeued.has(q.id)) {
      this.requeued.add(q.id);
      (this.state.requeued ??= []).push(q.id);
      this.state.qids.push(q.id);
    }
    this.touch();
    return { q, grade: g };
  }

  /** 已作答的卷面位置集合（恢复推进用；重排队同 qid 多位置互不影响） */
  answeredPositions(): Set<number> {
    return new Set((this.state.answered ?? []).map((a) => a.pos));
  }

  /** 恢复推进（37-05）：光标跳到首个未答位置；返回跳过的已答数。防重复作答双计事件 */
  advancePastAnswered(): number {
    const done = this.answeredPositions();
    let skipped = 0;
    while (this.state.cursor < this.state.qids.length && done.has(this.state.cursor)) {
      this.state.cursor++;
      skipped++;
    }
    return skipped;
  }

  /** 全部位置均已作答（恢复后可直接进结算） */
  allAnswered(): boolean {
    const done = this.answeredPositions();
    return this.state.qids.length > 0 && this.state.qids.every((_, i) => done.has(i));
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

  private touch() {
    this.state.updatedAt = this.now();
  }
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
