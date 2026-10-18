// ============================================================
// 55-04 版本化评分政策与样例验算（Scoring Policies & Penalty Rules）
// 1) 统一全对（standard）、多选/逐空部分分（partial）、错题倒扣分（penalty）与舍入政策。
// 2) 同一作答在预览、考试、报告、导出中评分严格一致；历史成绩随快照保留当时规则。
// 3) 提供每种政策的对照验算样例，配置变更前直观显示评分差异。
// ============================================================

import type { Question } from "./types";

export type ScoringPolicyKind =
  | "standard" // 标准政策：全对得满分，错题与未答得 0 分
  | "partial_indefinite" // 不定项部分分：少选按比例得部分分，错选 0 分
  | "partial_all" // 全面部分分：多选少选、多空按填对空数均按比例得分
  | "penalty"; // 倒扣分惩罚机制：答错扣分（如扣 0.5×分值），未答得 0 分不倒扣

export type RoundingStrategy = "raw" | "round" | "floor" | "ceil";

export interface ScoringPolicy {
  v: 1;
  kind: ScoringPolicyKind;
  /** 倒扣分比例（仅 penalty 生效，如 0.5 表示答错扣 50% 本题分值，默认 0.5） */
  penaltyRatio?: number;
  /** 最低分是否保底为 0 分（防出现负总分，默认 true） */
  floorZero?: boolean;
  /** 分数舍入取整策略（默认 raw 保留两位小数） */
  rounding?: RoundingStrategy;
}

export const DEFAULT_SCORING_POLICY: ScoringPolicy = {
  v: 1,
  kind: "standard",
  floorZero: true,
  rounding: "raw",
};

export const SCORING_POLICY_LABELS: Record<ScoringPolicyKind, string> = {
  standard: "标准计分（全对给分，错题 0 分）",
  partial_indefinite: "多选少选部分分（错选 0 分）",
  partial_all: "多选与多空按比例给分",
  penalty: "倒扣分制（答错扣分，未答 0 分）",
};

/** 舍入函数 */
export function applyScoreRounding(score: number, strategy: RoundingStrategy = "raw"): number {
  switch (strategy) {
    case "round":
      return Math.round(score);
    case "floor":
      return Math.floor(score);
    case "ceil":
      return Math.ceil(score);
    case "raw":
    default:
      return Math.round(score * 100) / 100;
  }
}

export interface ScoreItemInput {
  scoreEach: number;
  verdict: "correct" | "wrong" | "not_attempted";
  /** 题目类型，用于区分不定项与多空填空部分分 */
  type?: Question["type"];
  /** 部分分比例 0-1（如少选或多空正确比例） */
  factor?: number;
}

/** 55-04 纯函数：根据评分政策计算单题得分 */
export function calculateItemScore(
  input: ScoreItemInput,
  policy: ScoringPolicy = DEFAULT_SCORING_POLICY,
): number {
  const { scoreEach, verdict, factor, type } = input;
  if (verdict === "not_attempted") return 0;

  if (verdict === "correct") {
    return scoreEach;
  }

  // 答错情况判定
  if (policy.kind === "penalty") {
    const ratio = policy.penaltyRatio ?? 0.5;
    const penaltyScore = -1 * scoreEach * ratio;
    return penaltyScore;
  }

  if (policy.kind === "partial_indefinite") {
    // 仅不定项/多选少选给部分分，填空等题型不给
    if (type && type !== "multiple") return 0;
    if (typeof factor === "number" && factor > 0 && factor < 1) {
      return scoreEach * factor;
    }
  }

  if (policy.kind === "partial_all") {
    // 多选与多空均给部分分
    if (typeof factor === "number" && factor > 0 && factor < 1) {
      return scoreEach * factor;
    }
  }

  return 0;
}

/** 55-04 纯函数：计算整卷/某模块在指定政策下的总得分 */
export function calculateSectionScore(
  items: readonly ScoreItemInput[],
  policy: ScoringPolicy = DEFAULT_SCORING_POLICY,
): {
  totalScore: number;
  fullScore: number;
  correctCount: number;
  wrongCount: number;
  notAttemptedCount: number;
} {
  let rawScore = 0;
  let fullScore = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let notAttemptedCount = 0;

  for (const item of items) {
    fullScore += item.scoreEach;
    if (item.verdict === "correct") correctCount++;
    else if (item.verdict === "wrong") wrongCount++;
    else notAttemptedCount++;

    const itemScore = calculateItemScore(item, policy);
    rawScore += itemScore;
  }

  // 最低保底 0 分检查
  if (policy.floorZero !== false && rawScore < 0) {
    rawScore = 0;
  }

  const rounded = applyScoreRounding(rawScore, policy.rounding);
  return {
    totalScore: rounded,
    fullScore: applyScoreRounding(fullScore, policy.rounding),
    correctCount,
    wrongCount,
    notAttemptedCount,
  };
}

// ---------- 55-04 样例验算（Policy Comparison & Simulation） ----------

export interface PolicySampleCase {
  title: string;
  desc: string;
  input: ScoreItemInput;
}

/** 固定对照算例：总分 10 分（5 道题，每题 2 分）
 * 1. 题1：单选答对 (2分)
 * 2. 题2：多选少选（factor=0.5，得半对）
 * 3. 题3：完全答错 (0分，倒扣分时扣 1分)
 * 4. 题4：未作答 (0分)
 * 5. 题5：填空多空对 1 空（factor=0.5）
 */
export const SCORING_POLICY_SAMPLE_CASES: readonly PolicySampleCase[] = [
  { title: "单选全对", desc: "标准答案 A，作答 A", input: { type: "single", scoreEach: 2, verdict: "correct", factor: 1 } },
  { title: "多选少选", desc: "答案 AB，作答 A（少选得半对）", input: { type: "multiple", scoreEach: 2, verdict: "wrong", factor: 0.5 } },
  { title: "完全答错", desc: "答案 A，作答 B", input: { type: "single", scoreEach: 2, verdict: "wrong", factor: 0 } },
  { title: "未作答", desc: "跳过该题，不作答", input: { type: "single", scoreEach: 2, verdict: "not_attempted" } },
  { title: "多空填空对一半", desc: "两空填对一空（factor=0.5）", input: { type: "fill", scoreEach: 2, verdict: "wrong", factor: 0.5 } },
];

export interface PolicySimulationResult {
  kind: ScoringPolicyKind;
  name: string;
  totalScore: number;
  fullScore: number;
  itemScores: number[];
}

/** 55-04 纯函数：执行全政策对照样例验算 */
export function simulateAllPolicySamples(
  cases: readonly PolicySampleCase[] = SCORING_POLICY_SAMPLE_CASES,
): Record<ScoringPolicyKind, PolicySimulationResult> {
  const kinds: ScoringPolicyKind[] = ["standard", "partial_indefinite", "partial_all", "penalty"];
  const out: Partial<Record<ScoringPolicyKind, PolicySimulationResult>> = {};

  for (const kind of kinds) {
    const policy: ScoringPolicy = {
      v: 1,
      kind,
      penaltyRatio: 0.5,
      floorZero: true,
      rounding: "raw",
    };
    const itemScores = cases.map((c) => calculateItemScore(c.input, policy));
    const section = calculateSectionScore(cases.map((c) => c.input), policy);

    out[kind] = {
      kind,
      name: SCORING_POLICY_LABELS[kind],
      totalScore: section.totalScore,
      fullScore: section.fullScore,
      itemScores,
    };
  }

  return out as Record<ScoringPolicyKind, PolicySimulationResult>;
}
