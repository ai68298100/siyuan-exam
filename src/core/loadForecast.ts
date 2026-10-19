// ============================================================
// 39-06 遗忘曲线、未来到期负荷预测与建议每日量（Review Load Forecast & Daily Target）
// 验收要求（TODO 39-06）：
//   1) 明确“已练题目 / 内核卡片”双口径，统一 7 / 14 / 30 天预测窗口；
//   2) 严格按本地自然日划分时区，杜绝“未来幽灵数据”（今天已到期归入积压 backlog，
//      未来预测仅从明日开始按日累加）；
//   3) 依据艾宾浩斯/FSRS 间隔增长模型估算未来每题到期日，未练习题不参与衰减曲线；
//   4) 计算防雪崩的建议每日做题量（recommendedDailyQuota），避免缺席导致指数爆量；
//   5) 提供 UTF-8 BOM CSV 文本等价物导出（满足 45-08 契约）。
// 纯函数无 IO。
// ============================================================

import type { Question, AttemptEvent } from "./types";
import { reportDateKey } from "./reportWindow";

export interface DayForecast {
  /** 相对今天的偏移天数（0 = 今天/积压，1 = 明天，依此类推） */
  dayOffset: number;
  /** 本地日期字符串 (YYYY-MM-DD) */
  dateKey: string;
  /** 当天预计到期需复习的题数 */
  dueCount: number;
  /** 累计待复习题数（前序各天到期之和） */
  cumulativeDue: number;
  /** 预计到期题目 ID 清单 */
  qids: string[];
}

export interface LoadForecastResult {
  /** 预测窗口天数（如 7、14、30） */
  windowDays: number;
  /** 当前已到期/积压未练题数（截至今日 23:59:59） */
  backlogCount: number;
  /** 题库总题数与已练题数口径 */
  calibers: {
    totalQuestions: number;
    practicedQuestions: number;
    unpracticedQuestions: number;
    /** 提供了直接到期时间的卡片数（若有） */
    cardDueCount: number;
  };
  /** 未来逐日预测明细（从明天 dayOffset=1 开始） */
  days: DayForecast[];
  /** 窗口内总预测到期数（含积压） */
  totalDueInWindow: number;
  /** 建议每日复习量（均衡消除积压与到期） */
  recommendedDaily: number;
  /** 生成预测的时间戳 */
  generatedAt: number;
}

export interface LoadForecastOptions {
  /** 预测天数窗口，默认 14 天（可选 7 / 14 / 30） */
  windowDays?: number;
  /** 每日建议复习量上限，默认 50 题（防爆量） */
  maxDailyCap?: number;
  /** 每日建议复习量下限，默认 5 题 */
  minDailyFloor?: number;
  /** 基准时间戳，默认当前时刻 */
  now?: number;
  /** 已有内核卡片到期映射（cardId/blockId → 到期时间戳毫秒），可选 */
  cardDues?: ReadonlyMap<string, number>;
}

/**
 * 依据单题的作答流水估算其下一次复习到期时刻（毫秒）。
 * 规则：
 *   - 无作答记录：返回 null（未学题目不参与复习预测）；
 *   - 最近一次答错：间隔收缩为 1 天（立即巩固）；
 *   - 连续答对：间隔按 1.8^streak 递增（第1次对=1天，第2次对=2天，第3次对=4天，第4次对=7天，上限 60 天）；
 *   - 到期时间 = lastAt + intervalMs。
 */
export function estimateNextDueMs(
  events: readonly AttemptEvent[],
  _now: number = Date.now(),
): number | null {
  if (!events.length) return null;
  // 找出最近一次有效作答
  const last = events[events.length - 1];
  if (last.verdict === "not_attempted") return null;

  if (last.verdict === "wrong") {
    // 答错后 24 小时到期
    return last.ts + 86_400_000;
  }

  // 统计尾部连续正确数
  let streak = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].verdict === "correct") streak++;
    else if (events[i].verdict === "wrong") break;
  }

  // 间隔天数增长公式：min(60, round(1.8^(streak - 1)))
  const intervalDays = Math.min(60, Math.max(1, Math.round(Math.pow(1.8, Math.max(0, streak - 1)))));
  return last.ts + intervalDays * 86_400_000;
}

/**
 * 计算未来到期负荷预测与建议每日量（39-06 纯函数）。
 */
export function forecastFutureLoad(
  questions: readonly Question[],
  attempts: readonly AttemptEvent[],
  options: LoadForecastOptions = {},
): LoadForecastResult {
  const now = options.now ?? Date.now();
  const windowDays = Math.max(1, Math.min(90, options.windowDays ?? 14));
  const maxDailyCap = options.maxDailyCap ?? 50;
  const minDailyFloor = options.minDailyFloor ?? 5;

  // 今天 23:59:59.999 的本地时间戳
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const todayEndMs = todayEnd.getTime();

  // 1. 按题目聚合作答事件
  const eventsByQid = new Map<string, AttemptEvent[]>();
  for (const e of attempts) {
    if (e.verdict === "not_attempted") continue;
    let list = eventsByQid.get(e.qid);
    if (!list) {
      list = [];
      eventsByQid.set(e.qid, list);
    }
    list.push(e);
  }

  // 2. 统计各题预计到期时刻
  let practicedCount = 0;
  let backlogCount = 0;
  const dueBuckets = new Map<number, string[]>(); // offset(1..windowDays) -> qids
  for (let i = 1; i <= windowDays; i++) dueBuckets.set(i, []);

  let cardDueUsed = 0;

  for (const q of questions) {
    // 优先采用直接传入的卡片到期时间（如果匹配到）
    const blockId = (q as { blockId?: string }).blockId;
    const directCardDue = options.cardDues?.get(q.id) ?? (blockId ? options.cardDues?.get(blockId) : undefined);
    let dueMs: number | null = null;

    if (directCardDue != null && Number.isFinite(directCardDue)) {
      dueMs = directCardDue;
      cardDueUsed++;
      practicedCount++;
    } else {
      const qEvents = eventsByQid.get(q.id);
      if (qEvents && qEvents.length > 0) {
        practicedCount++;
        dueMs = estimateNextDueMs(qEvents, now);
      }
    }

    if (dueMs == null) continue; // 未练题目

    if (dueMs <= todayEndMs) {
      // 截至今天已到期（积压量）
      backlogCount++;
    } else {
      // 未来天数偏移（明天=1，后天=2...）
      const diffMs = dueMs - todayEndMs;
      const offset = Math.ceil(diffMs / 86_400_000);
      if (offset >= 1 && offset <= windowDays) {
        dueBuckets.get(offset)?.push(q.id);
      }
    }
  }

  // 3. 构建逐日预测序列
  const days: DayForecast[] = [];
  let cumulative = backlogCount;
  for (let i = 1; i <= windowDays; i++) {
    const targetDate = new Date(todayEndMs + (i - 1) * 86_400_000 + 86_400_000);
    const dateKey = reportDateKey(targetDate.getTime());
    const qids = dueBuckets.get(i) ?? [];
    cumulative += qids.length;
    days.push({
      dayOffset: i,
      dateKey,
      dueCount: qids.length,
      cumulativeDue: cumulative,
      qids,
    });
  }

  const totalDueInWindow = cumulative;

  // 4. 计算建议每日做题量（平摊积压与预测窗口期负荷）
  // 算法：(积压 + 窗口期到期) / 窗口天数，并向上取整；夹取在 [minDailyFloor, maxDailyCap]
  const rawDaily = Math.ceil(totalDueInWindow / windowDays);
  const recommendedDaily = Math.max(
    totalDueInWindow > 0 ? minDailyFloor : 0,
    Math.min(maxDailyCap, rawDaily),
  );

  return {
    windowDays,
    backlogCount,
    calibers: {
      totalQuestions: questions.length,
      practicedQuestions: practicedCount,
      unpracticedQuestions: Math.max(0, questions.length - practicedCount),
      cardDueCount: cardDueUsed,
    },
    days,
    totalDueInWindow,
    recommendedDaily,
    generatedAt: now,
  };
}

/**
 * 45-08 文本等价物：导出未来负荷预测 CSV（UTF-8 BOM）。
 */
export function exportLoadForecastCsv(forecast: LoadForecastResult): string {
  const rows: string[] = [];
  rows.push("小驴考试(内测版) 未来复习到期负荷预测与建议量");
  rows.push(`预测窗口,近 ${forecast.windowDays} 天`);
  rows.push(`题库总题数,${forecast.calibers.totalQuestions}`);
  rows.push(`已练题数,${forecast.calibers.practicedQuestions}`);
  rows.push(`未练题数,${forecast.calibers.unpracticedQuestions}`);
  rows.push(`当前已到期积压,${forecast.backlogCount} 题`);
  rows.push(`建议每日复习量,${forecast.recommendedDaily} 题/天`);
  rows.push(`窗口内总到期负荷,${forecast.totalDueInWindow} 题`);
  rows.push("");
  rows.push("日期,相对偏移,当天到期数,累计待复习数");
  rows.push(`今日积压,0,${forecast.backlogCount},${forecast.backlogCount}`);
  for (const d of forecast.days) {
    rows.push(`${d.dateKey},+${d.dayOffset}天,${d.dueCount},${d.cumulativeDue}`);
  }
  rows.push("");
  rows.push("说明,预测基于作答间隔遗忘衰减模型计算，实际到期取决于每日做题与自评反馈");
  return "\uFEFF" + rows.join("\r\n");
}
