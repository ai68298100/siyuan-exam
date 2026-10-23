/**
 * 主观题采分点智能对齐与诊断引擎 (Rubric Semantic Evaluator)
 * 职责：
 * 1. 自动提取采分点（Criterion）关键论断与专业术语词组；
 * 2. 纯函数比对学员主观作答文本与标准采分点，计算多级语义重合度；
 * 3. 评定每个采分点的命中程度（full 完全命中 / partial 部分提及 / none 遗漏）；
 * 4. 给出机器建议得分与各要点的诊断建议（遵循 45-08 与诚实边界：辅助参考，自评优先）；
 * 5. 生成一键回填自评表单的预选字典。
 */

import type { RubricSpec, RubricCriterion, RubricLevelKey } from "./rubric";
import { generateAutoRubric } from "./excerptCard";

export interface CriterionMatchResult {
  criterionId: string;
  label: string;
  weight: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  matchLevel: "full" | "partial" | "none";
  recommendedLevel: RubricLevelKey;
  scoreContribution: number;
  diagnosticAdvice: string;
}

export interface RubricEvaluationResult {
  fullScore: number;
  estimatedScore: number;
  matchRatio: number; // 0 - 100
  criteriaResults: CriterionMatchResult[];
  recommendedRatings: Record<string, RubricLevelKey>;
  overallSummary: string;
}

/** 常见中文与英文停用词/符号过滤 */
const STOP_WORDS = new Set([
  "的", "了", "和", "与", "及", "或", "在", "是", "为", "由", "对", "以",
  "等", "其", "于", "中", "上", "下", "把", "被", "将", "并", "但", "而",
  "要点", "核心", "包括", "主要", "the", "a", "an", "and", "or", "in", "of", "to",
]);

/**
 * 从采分点说明或例句中提取核心特征词组
 */
export function extractCriterionKeywords(text: string): string[] {
  if (!text || !text.trim()) return [];
  // 将标点与常见助词/动词连接词替换为分隔符（全面涵盖半角与全角中英文标点）
  const splitPattern = /[0-9、，。！？；：:;,!?~·`^&%*()（）[\]【】{}《》""''“”‘’—…\n\r\t\s]|(?:是|的|了|和|与|及|或|在|为|由|对|以|等|其|于|中|把|被|将|并|但|而|包括|主要|要求)/g;
  const rawTokens = text
    .split(splitPattern)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 12 && !STOP_WORDS.has(s.toLowerCase()));

  // 去重
  const unique = Array.from(new Set(rawTokens)).filter(Boolean);
  if (unique.length > 0) return unique;
  // 兜底：去除所有标点与空白后提取有效字符
  const cleanedAlpha = text.replace(/[\p{P}\p{S}\s]/gu, "").trim().slice(0, 10);
  return cleanedAlpha.length >= 2 ? [cleanedAlpha] : [];
}

/**
 * 评估单条采分点在学员作答中的命中情况
 */
function evaluateSingleCriterion(
  criterion: RubricCriterion,
  answerNormalized: string,
  fullScore: number,
): CriterionMatchResult {
  const sampleText = criterion.example ? `${criterion.example} ${criterion.label}` : criterion.label;
  const keywords = extractCriterionKeywords(sampleText);

  // 空答案或无可用关键词：一律按未作答 none 处理，绝不误判命中
  if (!answerNormalized.trim() || keywords.length === 0) {
    return {
      criterionId: criterion.id,
      label: criterion.label,
      weight: criterion.weight,
      matchedKeywords: [],
      missingKeywords: keywords,
      matchLevel: "none",
      recommendedLevel: "none",
      scoreContribution: 0,
      diagnosticAdvice: !answerNormalized.trim() ? "未作答，无法评估采分点。" : "采分点缺少有效关键词。",
    };
  }

  const matchedKeywords: string[] = [];
  const missingKeywords: string[] = [];

  for (const kw of keywords) {
    if (answerNormalized.includes(kw.toLowerCase())) {
      matchedKeywords.push(kw);
    } else {
      missingKeywords.push(kw);
    }
  }

  const matchRatio = keywords.length > 0 ? matchedKeywords.length / keywords.length : 0;

  let matchLevel: "full" | "partial" | "none" = "none";
  let recommendedLevel: RubricLevelKey = "none";
  let diagnosticAdvice = "未检索到相关核心论据或专业术语，建议对照答案补充。";

  if (matchRatio >= 0.5 || matchedKeywords.length >= 2 || (keywords.length <= 2 && matchedKeywords.length >= 1)) {
    matchLevel = "full";
    recommendedLevel = "full";
    diagnosticAdvice = `✔ 核心关键词命中良好（命中 ${matchedKeywords.join("、")}），要点表述清晰。`;
  } else if (matchRatio > 0.2 || matchedKeywords.length >= 1) {
    matchLevel = "partial";
    recommendedLevel = "partial";
    diagnosticAdvice = `⚠️ 部分提及要点（命中 ${matchedKeywords.join("、")}），但遗漏了【${missingKeywords.slice(0, 2).join("、")}】等关键论证。`;
  }

  const ratio = recommendedLevel === "full" ? 1.0 : recommendedLevel === "partial" ? 0.5 : 0;
  const scoreContribution = Math.round(criterion.weight * fullScore * ratio * 10) / 10;

  return {
    criterionId: criterion.id,
    label: criterion.label,
    weight: criterion.weight,
    matchedKeywords,
    missingKeywords,
    matchLevel,
    recommendedLevel,
    scoreContribution,
    diagnosticAdvice,
  };
}

/**
 * 纯函数：根据学员主观作答文本与题目采分点规格，进行对齐与智能评分诊断
 */
export function evaluateStudentAnswerAgainstRubric(options: {
  studentAnswer: string;
  rubric?: RubricSpec | null;
  fallbackAnalysis?: string;
}): RubricEvaluationResult {
  const rawAns = options.studentAnswer?.trim() ?? "";
  const answerNormalized = rawAns.toLowerCase();

  // 若题目没有显式配置 rubric，则基于解析文本自动派生标准采分点
  const effectiveRubric: RubricSpec =
    options.rubric && options.rubric.criteria?.length
      ? options.rubric
      : generateAutoRubric(options.fallbackAnalysis || "参考要点与标准解析", 5);

  const fullScore = effectiveRubric.fullScore || 5;
  const criteriaResults: CriterionMatchResult[] = [];
  const recommendedRatings: Record<string, RubricLevelKey> = {};

  let totalScore = 0;

  for (const crit of effectiveRubric.criteria) {
    const res = evaluateSingleCriterion(crit, answerNormalized, fullScore);
    criteriaResults.push(res);
    recommendedRatings[crit.id] = res.recommendedLevel;
    totalScore += res.scoreContribution;
  }

  const finalScore = Math.min(fullScore, Math.max(0, Math.round(totalScore * 10) / 10));
  const matchRatio = fullScore > 0 ? Math.round((finalScore / fullScore) * 100) : 0;

  let overallSummary = "作答要点完备，论证逻辑充实。";
  if (matchRatio < 40) {
    overallSummary = "要点覆盖率偏低，关键采分词较少，建议仔细对比标准解析中的推导脉络。";
  } else if (matchRatio < 75) {
    overallSummary = "已掌握核心框架，部分要点细节阐述尚不够精准，注意查漏补缺。";
  }

  return {
    fullScore,
    estimatedScore: finalScore,
    matchRatio,
    criteriaResults,
    recommendedRatings,
    overallSummary,
  };
}

/**
 * 导出主观题智能采分点诊断评估 Markdown 卡片
 */
export function exportRubricEvaluationMarkdown(result: RubricEvaluationResult): string {
  const lines: string[] = [];
  lines.push(`### 📋 主观题采分点对齐与诊断报告`);
  lines.push(`> 预估建议得分：**${result.estimatedScore} / ${result.fullScore} 分**（吻合度 **${result.matchRatio}%**）· *注：机器语义对齐仅供自评参考*`);
  lines.push(`> **综合评语**：${result.overallSummary}\n`);

  lines.push(`| 采分要点 | 权重占比 | 智能评级 | 建议得分 | 诊断分析 |`);
  lines.push(`|---|---|---|---|---|`);

  for (const cr of result.criteriaResults) {
    const tag = cr.recommendedLevel === "full" ? "🟢 完全命中" : cr.recommendedLevel === "partial" ? "🟡 部分提及" : "🔴 未命中";
    const weightPct = `${Math.round(cr.weight * 100)}%`;
    lines.push(`| ${cr.label} | ${weightPct} | ${tag} | +${cr.scoreContribution} | ${cr.diagnosticAdvice} |`);
  }

  return lines.join("\n");
}
