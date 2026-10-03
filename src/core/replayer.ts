// ============================================================
// 幂等重算器：流水（唯一真相）→ 错题本/题目统计/日统计（派生缓存）
// 规则（docs/02 附录 A）：答错收录；连对 ELIMINATE_STREAK 次移出；
// not_attempted 不改变任何状态；同 eid 只计一次（AttemptLog 已去重，此处双保险）
// ============================================================
import type { AttemptEvent, ReplayResult, WrongItem, DayStats } from "./types";

export const ELIMINATE_STREAK = 2;
/** 背诵连击毕业线：连续 ≥4 次"会"从背诵池出清（形态升级回选择题） */
export const RECITE_GRADUATE_STREAK = 4;

export function replay(events: readonly AttemptEvent[]): ReplayResult {
  const wrongbook = new Map<string, WrongItem>();
  const byQuestion = new Map<string, { attempts: number; correct: number; lastAt: number }>();
  const days = new Map<string, DayStats>();
  const reciteStreak = new Map<string, number>();
  const seen = new Set<string>();
  let skipped = 0;
  let clockAnomalies = 0;
  let lastTs = 0;

  // 时间+序号有序回放：乱序输入也得到确定性结果（TODO 26.1 幂等要求）
  const ordered = [...events].sort((a, b) => a.ts - b.ts || a.seq - b.seq);

  for (const e of ordered) {
    if (!e || typeof e.eid !== "string" || !e.eid || typeof e.qid !== "string" || !e.qid) {
      skipped++;
      continue;
    }
    if (seen.has(e.eid)) {
      skipped++;
      continue;
    }
    seen.add(e.eid);
    if (e.ts < lastTs - 60_000) clockAnomalies++;
    lastTs = Math.max(lastTs, e.ts);

    // 题目统计：not_attempted 不计入 attempts 分母
    if (e.verdict !== "not_attempted") {
      const s = byQuestion.get(e.qid) ?? { attempts: 0, correct: 0, lastAt: 0 };
      s.attempts++;
      s.lastAt = e.ts;
      if (e.verdict === "correct") s.correct++;
      byQuestion.set(e.qid, s);
    }

    // 日统计：任一事件（含背诵自评）计活动；对错仅判分口径
    const day = localDate(e.ts);
    const d = days.get(day) ?? { date: day, attempts: 0, correct: 0 };
    if (e.verdict !== "not_attempted") {
      d.attempts++;
      if (e.verdict === "correct") d.correct++;
    }
    days.set(day, d);

    // 错题状态机
    // 挑战码（友谊赛）作答不入错题本（13 组审计）：对手题不属本人题库资产，
    // 且 exam-id 不在库中永无消灭路径，只会成为永久 active 的孤儿条目
    const entersWrongbook = e.mode !== "challenge";
    let w = wrongbook.get(e.qid);
    if (e.kind === "recite" || e.kind === "card") {
      // 形态分离：只更新背诵连击（≥4 毕业出清背诵池），不碰错题本
      if (e.kind === "recite") {
        const s = reciteStreak.get(e.qid) ?? 0;
        if (e.verdict === "correct") reciteStreak.set(e.qid, s + 1);
        else if (e.verdict === "wrong") reciteStreak.set(e.qid, 0);
      }
      continue;
    }
    if (e.verdict === "wrong" && entersWrongbook) {
      if (!w) {
        w = {
          qid: e.qid,
          firstWrongAt: e.ts,
          lastWrongAt: e.ts,
          wrongCount: 1,
          streakCorrect: 0,
          myAnswer: e.myAnswer,
          status: "active",
        };
        wrongbook.set(e.qid, w);
      } else if (w.status === "active") {
        w.wrongCount++;
        w.lastWrongAt = e.ts;
        w.myAnswer = e.myAnswer;
      } else if (w.status === "eliminated" || w.status === "mastered") {
        // 消灭后再错：重新收录（新一轮）
        w.status = "active";
        w.wrongCount = 1;
        w.streakCorrect = 0;
        w.firstWrongAt = e.ts;
        w.lastWrongAt = e.ts;
        w.myAnswer = e.myAnswer;
      }
    } else if (e.verdict === "correct" && entersWrongbook) {
      if (w && w.status === "active") {
        w.streakCorrect++;
        if (w.streakCorrect >= ELIMINATE_STREAK) w.status = "eliminated";
      }
    }
  }

  return { wrongbook, byQuestion, days, reciteStreak, skipped, clockAnomalies };
}

/** 本地时区自然日（streak/热力/每日口径；事件 ts 为 UTC） */
export function localDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function activeWrongItems(r: ReplayResult): WrongItem[] {
  return [...r.wrongbook.values()]
    .filter((w) => w.status === "active")
    .sort((a, b) => b.wrongCount - a.wrongCount || b.firstWrongAt - a.firstWrongAt);
}

/** 连续学习天数（自然日有任一有效事件即保号） */
export function streak(r: ReplayResult, today = new Date()): number {
  let n = 0;
  const cur = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (;;) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
    if (!r.days.get(key)?.attempts) break;
    n++;
    cur.setDate(cur.getDate() - 1);
  }
  return n;
}
