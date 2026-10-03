// ============================================================
// 报告聚合（纯函数）：热力图/掌握度/薄弱 Top10/时段分布
// 输入全部来自 derived() 流水重算结果 + 题库题面（可离线）
// ============================================================
import type { AttemptEvent, Question, ReplayResult } from "./types";

export interface HeatCell {
  date: string;
  count: number;
}

/** 53 周热力格：以今天所在周收尾，回推 371 天；count=当日做题数 */
export function heatmap(days: ReplayResult["days"], today: Date = new Date()): HeatCell[] {
  const cells: HeatCell[] = [];
  const cur = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  cur.setDate(cur.getDate() - 370);
  for (let i = 0; i < 371; i++) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
    cells.push({ date: key, count: days.get(key)?.attempts ?? 0 });
    cur.setDate(cur.getDate() + 1);
  }
  return cells;
}

export interface KpMastery {
  root: string; // 考点首段
  total: number; // 作答题数
  accuracy: number; // 加权正确率 0-1
  /** FSRS 风格留存率：R=(1+F·t/S)^DECAY，S 由该考点平均间隔粗估 */
  retention: number;
  mastery: number; // mastery = accuracy × retention
}

const DECAY = -0.1542;
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;

/** 考点掌握度（首段聚合）：正确率 × FSRS 式留存衰减；<3 题返回 mastery=-1（数据不足） */
export function masteryByKp(
  questions: Question[],
  _byQuestion: ReplayResult["byQuestion"],
  events: readonly AttemptEvent[],
  now: number = Date.now(),
): KpMastery[] {
  const kpOf = new Map<string, string>();
  for (const q of questions) if (q.kp) kpOf.set(q.id, q.kp);
  const agg = new Map<string, { t: number; c: number; last: number; gaps: number[]; lastTs: number[] }>();
  const ordered = [...events]
    .filter((e) => e.verdict !== "not_attempted" && e.kind !== "card")
    .sort((a, b) => a.ts - b.ts);
  const lastTsByQ = new Map<string, number>();
  for (const e of ordered) {
    const kp = kpOf.get(e.qid);
    if (!kp) continue;
    const root = kp.split("/")[0];
    const a = agg.get(root) ?? { t: 0, c: 0, last: 0, gaps: [], lastTs: [] };
    const prev = lastTsByQ.get(e.qid);
    if (prev) a.gaps.push(Math.max(1, Math.round((e.ts - prev) / 86_400_000)));
    lastTsByQ.set(e.qid, e.ts);
    a.t++;
    if (e.verdict === "correct") a.c++;
    a.last = Math.max(a.last, e.ts);
    a.lastTs.push(e.ts);
    agg.set(root, a);
  }
  const out: KpMastery[] = [];
  for (const [root, a] of agg) {
    if (a.t < 3) {
      out.push({ root, total: a.t, accuracy: 0, retention: 0, mastery: -1 });
      continue;
    }
    const accuracy = a.c / a.t;
    const avgGapDays = a.gaps.length ? a.gaps.reduce((x, y) => x + y, 0) / a.gaps.length : 7;
    const daysSince = Math.max(0, (now - a.last) / 86_400_000);
    const retention = Math.pow(1 + FACTOR * (daysSince / Math.max(1, avgGapDays)), DECAY);
    out.push({
      root,
      total: a.t,
      accuracy,
      retention: Math.max(0, Math.min(1, retention)),
      mastery: accuracy * retention,
    });
  }
  return out.sort((x, y) => y.mastery - x.mastery);
}

export interface WeakItem {
  root: string;
  accuracy: number;
  total: number;
}

/** 薄弱考点（升序，仅数据足的） */
export function weakTop(mast: KpMastery[], n = 10): WeakItem[] {
  return mast
    .filter((m) => m.mastery >= 0)
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, n)
    .map((m) => ({ root: m.root, accuracy: m.accuracy, total: m.total }));
}

/** 学习时段分布（0-23 点做题数，Anki 式 hourly） */
export function hourly(events: readonly AttemptEvent[]): number[] {
  const h = new Array(24).fill(0) as number[];
  for (const e of events) {
    if (e.verdict === "not_attempted") continue;
    h[new Date(e.ts).getHours()]++;
  }
  return h;
}

// ---------- 置信度校准（U12 最小切片）：自评信心 × 客观对错 ----------

export type ConfidenceLevel = "sure" | "fuzzy" | "guess";

export interface CalibrationRow {
  confidence: ConfidenceLevel;
  attempts: number;
  correct: number;
  /** 实际正确率 0-100（分母=该档作答数；无分母不显示） */
  accuracy: number;
}

export interface CalibrationReport {
  rows: CalibrationRow[];
  unreported: number; // 未报信心的客观作答数（区分"没填"与"猜"）
  /** 校准差：自评"确定"档正确率 − 自评"蒙"档正确率（正数越大区分度越好；样本不足为 null） */
  spread: number | null;
}

const CONF_ORDER: ConfidenceLevel[] = ["sure", "fuzzy", "guess"];

/** 校准聚合：只统计客观判分的 practice/mock 作答（recite 自评、card 不参与）；
 *  同一事件流里 confidence 缺失 → unreported，不并入任何档。 */
export function calibration(events: readonly AttemptEvent[]): CalibrationReport {
  const buckets = new Map<ConfidenceLevel, { attempts: number; correct: number }>();
  let unreported = 0;
  for (const e of events) {
    if (e.verdict === "not_attempted") continue;
    if (e.kind !== "practice" && e.kind !== "mock") continue;
    if (!e.confidence) {
      unreported++;
      continue;
    }
    const b = buckets.get(e.confidence) ?? { attempts: 0, correct: 0 };
    b.attempts++;
    if (e.verdict === "correct") b.correct++;
    buckets.set(e.confidence, b);
  }
  const rows: CalibrationRow[] = CONF_ORDER.filter((c) => buckets.has(c)).map((c) => {
    const b = buckets.get(c)!;
    return {
      confidence: c,
      attempts: b.attempts,
      correct: b.correct,
      accuracy: Math.round((b.correct / b.attempts) * 100),
    };
  });
  const sure = buckets.get("sure"),
    guess = buckets.get("guess");
  const spread =
    sure && guess && sure.attempts >= 3 && guess.attempts >= 3
      ? Math.round((sure.correct / sure.attempts - guess.correct / guess.attempts) * 100)
      : null;
  return { rows, unreported, spread };
}

/** confident-wrong 下钻清单（44-02 lite）：自评"确定"却答错的题（按 qid 去重保留最近一次）。
 *  U12：题目/考点维度下钻的依据；样本即真实事件，不合并会话内重复刷题。 */
export function confidentWrongList(
  events: readonly AttemptEvent[],
  limit = 50,
): { qid: string; myAnswer: string | null; ts: number }[] {
  const byQid = new Map<string, { qid: string; myAnswer: string | null; ts: number }>();
  for (const e of events) {
    if (e.verdict !== "wrong" || e.confidence !== "sure") continue;
    if (e.kind !== "practice" && e.kind !== "mock") continue;
    byQid.set(e.qid, { qid: e.qid, myAnswer: e.myAnswer, ts: e.ts }); // 后写覆盖 = 最近一次
  }
  return [...byQid.values()].sort((a, b) => b.ts - a.ts).slice(0, limit);
}

/** uncertain-correct 下钻清单（44-02 lite 对偶）：自评"模糊/蒙"却答对的题——
 *  可能是运气或直觉，值得复核真实掌握；按 qid 去重保留最近一次。 */
export function uncertainCorrectList(
  events: readonly AttemptEvent[],
  limit = 50,
): { qid: string; confidence: ConfidenceLevel; myAnswer: string | null; ts: number }[] {
  const byQid = new Map<string, { qid: string; confidence: ConfidenceLevel; myAnswer: string | null; ts: number }>();
  for (const e of events) {
    if (e.verdict !== "correct" || (e.confidence !== "fuzzy" && e.confidence !== "guess")) continue;
    if (e.kind !== "practice" && e.kind !== "mock") continue;
    byQid.set(e.qid, { qid: e.qid, confidence: e.confidence!, myAnswer: e.myAnswer, ts: e.ts });
  }
  return [...byQid.values()].sort((a, b) => b.ts - a.ts).slice(0, limit);
}

export interface DelayedRecallReport {
  /** 有资格的配对数（错题之后隔日 ≥1 的首次作答） */
  pairs: number;
  /** 隔日首次作答答对且未受助（无提示独立回忆 = 39-08 的目标口径） */
  independentRecall: number;
  /** 答对但受助（讲解/提示后）——不计入独立回忆，单列防虚增 */
  assistedCorrect: number;
  /** 隔日仍错 */
  stillWrong: number;
  /** 独立回忆通过率（pairs=0 时为 null，不输出虚假比率） */
  rate: number | null;
}

/** 延迟独立回忆（39-08 lite）：对每道错题的每个错误周期，取「隔日 ≥1 天」的首次同题作答为一次延迟复测——
 *  同日反复刷不计（防虚增留存）；复测本身再错开启新周期；受助作答（AttemptEvent.help）单列不冒充无提示回忆。 */
export function delayedRecall(events: readonly AttemptEvent[], now = Date.now()): DelayedRecallReport {
  const DAY = 86_400_000;
  const byQid = new Map<string, AttemptEvent[]>();
  for (const e of events) {
    if (e.kind !== "practice" && e.kind !== "mock") continue;
    if (e.verdict === "not_attempted") continue;
    const arr = byQid.get(e.qid) ?? [];
    arr.push(e);
    byQid.set(e.qid, arr);
  }
  let independentRecall = 0;
  let assistedCorrect = 0;
  let stillWrong = 0;
  for (const [, arr] of byQid) {
    arr.sort((a, b) => a.ts - b.ts);
    let lastWrongTs: number | null = null;
    let counted = false; // 本错误周期已计过复测（其后同日/连续作答不重复计）
    for (const e of arr) {
      if (e.verdict === "wrong") {
        // 错误：若距上次错已隔日（复测资格成立）计一次仍错；任何错误都开启新周期
        if (lastWrongTs != null && !counted && e.ts - lastWrongTs >= DAY) stillWrong++;
        lastWrongTs = e.ts;
        counted = false;
        continue;
      }
      if (lastWrongTs != null && !counted && e.ts - lastWrongTs >= DAY) {
        if (e.help) assistedCorrect++;
        else independentRecall++;
        counted = true;
      }
    }
  }
  void now;
  const pairs = independentRecall + assistedCorrect + stillWrong;
  return {
    pairs,
    independentRecall,
    assistedCorrect,
    stillWrong,
    rate: pairs ? Math.round((independentRecall / pairs) * 100) : null,
  };
}
