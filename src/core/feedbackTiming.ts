// ============================================================
// 44-01 反馈时机策略（Feedback Timing Policy）
// 1) 支持逐题即时（immediate）、小组延迟批次（group）、会话末复盘（end）三档策略。
// 2) 三种策略产生完全相同且不可篡改的作答流水事件，仅在交互反馈呈现时机上解耦。
// 3) 小组批次判定与小组作答复盘统计纯函数。
// ============================================================

export type FeedbackTimingMode = "immediate" | "group" | "end";

export const DEFAULT_GROUP_FEEDBACK_SIZE = 5;

export const FEEDBACK_TIMING_LABELS: Record<FeedbackTimingMode, string> = {
  immediate: "逐题即时反馈（做一题判一题）",
  group: "小组延迟复盘（每 5 题小结反馈）",
  end: "会话末尾复盘（全部做完统一回看）",
};

/** 解析反馈时机设置，平滑向后兼容旧版布尔设置 feedbackEndReview */
export function resolveFeedbackTimingMode(
  timingSetting: unknown,
  legacyEndReviewSetting?: unknown,
): FeedbackTimingMode {
  if (timingSetting === "group") return "group";
  if (timingSetting === "end") return "end";
  if (timingSetting === "immediate") return "immediate";

  if (legacyEndReviewSetting === true || legacyEndReviewSetting === "true") {
    return "end";
  }
  return "immediate";
}

/** 判断当前已作答题数是否正好到达小组批次边界（例如第 5、10、15 题） */
export function isGroupBatchBoundary(
  completedCount: number,
  groupSize = DEFAULT_GROUP_FEEDBACK_SIZE,
): boolean {
  if (completedCount <= 0 || groupSize <= 0) return false;
  return completedCount % groupSize === 0;
}

export interface GroupBatchItem {
  qid: string;
  verdict: "correct" | "wrong" | "not_attempted";
  myAnswer: string | null;
}

export interface GroupBatchSummary {
  fromIndex: number; // 1-based 起始题号
  toIndex: number; // 1-based 结束题号
  total: number;
  correct: number;
  wrong: number;
  accuracy: number; // 0-100
  items: GroupBatchItem[];
}

/** 计算当前小组批次的作答统计与题目列表 */
export function calculateGroupBatchSummary(
  answeredList: readonly GroupBatchItem[],
  fromIndex: number,
  toIndex: number,
): GroupBatchSummary {
  const slice = answeredList.slice(Math.max(0, fromIndex - 1), toIndex);
  const correct = slice.filter((a) => a.verdict === "correct").length;
  const wrong = slice.filter((a) => a.verdict === "wrong").length;
  const total = slice.length;
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

  return {
    fromIndex,
    toIndex,
    total,
    correct,
    wrong,
    accuracy,
    items: [...slice],
  };
}
