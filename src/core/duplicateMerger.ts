// ============================================================
// 43-07 题库全文快速去重合并助手（Duplicate Question Merger）
// 1) 接收保留目标题 targetQ 与待合并重复题 sourceQ。
// 2) 比较两题字段差异，支持保留目标题主干，并智能合入重复题中更有价值的补充信息（如更完整的解析、考点、出处等）。
// 3) 作答流水重映射计算（计算有多少条历史作答将被重定向）。
// ============================================================

import type { Question } from "./types";

export interface MergePlan {
  targetId: string;
  sourceId: string;
  sourceBlockId?: string;
  enrichedQuestion: Question;
  enrichedFields: string[];
}

/** 43-07 纯函数：根据目标题与重复题制定合并计划，智能补充目标题缺失的内容 */
export function planQuestionMerge(
  targetQ: Question,
  sourceQ: Question,
): MergePlan {
  const enriched: Question = { ...targetQ };
  const enrichedFields: string[] = [];

  // 如果目标题没有解析，而重复题有，合入解析
  if (!enriched.analysis?.trim() && sourceQ.analysis?.trim()) {
    enriched.analysis = sourceQ.analysis.trim();
    enrichedFields.push("analysis");
  }

  // 如果目标题没有考点，合入考点
  if (!enriched.kp?.trim() && sourceQ.kp?.trim()) {
    enriched.kp = sourceQ.kp.trim();
    enrichedFields.push("kp");
  }

  // 如果目标题没有来源出处，合入出处
  if (!enriched.source?.trim() && sourceQ.source?.trim()) {
    enriched.source = sourceQ.source.trim();
    enrichedFields.push("source");
  }

  // 如果目标题没有年份，合入年份
  if (!enriched.year?.trim() && sourceQ.year?.trim()) {
    enriched.year = sourceQ.year.trim();
    enrichedFields.push("year");
  }

  // 如果目标题没有难度，合入难度
  if (enriched.difficulty == null && sourceQ.difficulty != null) {
    enriched.difficulty = sourceQ.difficulty;
    enrichedFields.push("difficulty");
  }

  // 收藏状态保留并集
  if (!enriched.fav && sourceQ.fav) {
    enriched.fav = true;
    enrichedFields.push("fav");
  }

  return {
    targetId: targetQ.id,
    sourceId: sourceQ.id,
    sourceBlockId: (sourceQ as { blockId?: string }).blockId,
    enrichedQuestion: enriched,
    enrichedFields,
  };
}
