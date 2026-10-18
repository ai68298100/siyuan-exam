// ============================================================
// 57-04 争议题状态与处置单（Disputed Question Status & Resolution）
// 对多解、缺条件、错误答案和过期资料设争议状态，记录证据与修订/更正/解决结果。
// 所有日常刷题/模考组卷默认排除未解决的争议题，用户可查历史与解除。
// ============================================================

export type DisputeReason =
  | "multi_answer" // 答案多解/不唯一
  | "missing_condition" // 题干缺条件/表述不严谨
  | "wrong_answer" // 标准答案有误/存疑
  | "expired_data" // 引用考点/法规已过期
  | "other"; // 其他争议

export interface QuestionDispute {
  v: 1;
  reason: DisputeReason;
  note: string;
  at: number;
  resolved?: boolean;
  resolvedAt?: number;
  resolution?: string; // 处置决议/说明
}

export const DISPUTE_REASON_LABELS: Record<DisputeReason, string> = {
  multi_answer: "答案多解/不唯一",
  missing_condition: "题干缺条件/表述有误",
  wrong_answer: "标准答案有误/存疑",
  expired_data: "考点法规已过期",
  other: "其他争议",
};

/** 判定题目是否处于未解决的争议状态 */
export function isQuestionDisputed(q: { dispute?: QuestionDispute } | undefined | null): boolean {
  if (!q?.dispute) return false;
  return !q.dispute.resolved;
}

/** 过滤出可参与正常刷题与模考组卷的有效题目（排除未解决的争议题） */
export function filterEligibleQuestions<T extends { dispute?: QuestionDispute }>(questions: T[]): T[] {
  return questions.filter((q) => !isQuestionDisputed(q));
}

/** 创建争议记录 */
export function createDisputeRecord(
  reason: DisputeReason,
  note: string,
  now = Date.now(),
): QuestionDispute {
  return {
    v: 1,
    reason,
    note: note.trim(),
    at: now,
    resolved: false,
  };
}

/** 解决争议记录 */
export function resolveDisputeRecord(
  dispute: QuestionDispute,
  resolution: string,
  now = Date.now(),
): QuestionDispute {
  return {
    ...dispute,
    resolved: true,
    resolvedAt: now,
    resolution: resolution.trim(),
  };
}
