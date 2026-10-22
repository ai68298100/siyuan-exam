/**
 * 试卷预估难度与考纲分值契合度体检引擎 (Paper Difficulty Predictor & Syllabus Balance Checker)
 * 职责：
 * 1. 结合题目历史实测通过率（P值）与设定星级难度，智能预测整卷难度系数（0-1.0）与难度分级；
 * 2. 统计各知识点/大纲章节的分值与题量权重，检出“空白考点”与“过度集中偏科考点”；
 * 3. 统计客观题 vs 主观题分值比例与各题型分布；
 * 4. 纯函数领域层，支持导出试卷综合质量与大纲体检报告（Markdown）。
 */

import type { Question, AttemptEvent } from "./types";
import type { SyllabusNode } from "./syllabus";

export type PaperDifficultyGrade = "easy" | "medium" | "hard" | "extreme";

export interface PaperDifficultyPrediction {
  totalQuestions: number;
  totalScore: number;
  averageP: number; // 0 - 1.0 (越接近 1 越容易)
  grade: PaperDifficultyGrade;
  difficultyLabel: string;
  measuredSampleCount: number; // 基于真实作答流水测算的题目数
  estimatedCount: number; // 基于星级推断的题目数
  summaryAdvice: string;
}

export interface KpScoreDistributionItem {
  kp: string;
  questionCount: number;
  scoreTotal: number;
  scoreSharePct: number; // 占全卷分值百分比
  status: "balanced" | "crowded" | "light";
}

export interface PaperBalanceReport {
  objectiveScore: number;
  subjectiveScore: number;
  objectiveRatio: number; // 0 - 100
  subjectiveRatio: number; // 0 - 100
  kpDistributions: KpScoreDistributionItem[];
  crowdedKps: string[]; // 占分值 >= 35% 的偏科考点
  missingSyllabusNodes: string[]; // 大纲中未被任何试题覆盖的节点
  balanceGrade: "excellent" | "acceptable" | "skewed";
  advice: string;
}

/** 星级难度到预估通过率 P 的映射（5星最难通过率 0.15，1星最容易通过率 0.85） */
const STARS_TO_P: Record<number, number> = {
  1: 0.85,
  2: 0.70,
  3: 0.50,
  4: 0.30,
  5: 0.15,
};

/**
 * 预测整套试卷的综合难度与分数分布
 */
export function predictPaperDifficulty(
  questions: readonly Question[],
  attempts: readonly AttemptEvent[] = [],
): PaperDifficultyPrediction {
  const validQs = questions.filter((q) => q.type !== "material");
  const totalQuestions = validQs.length;
  if (!totalQuestions) {
    return {
      totalQuestions: 0,
      totalScore: 0,
      averageP: 0.5,
      grade: "medium",
      difficultyLabel: "无可用题目",
      measuredSampleCount: 0,
      estimatedCount: 0,
      summaryAdvice: "试卷中暂无题目。",
    };
  }

  // 1. 建立题目流水正确率索引
  const attemptMap = new Map<string, { correct: number; total: number }>();
  for (const e of attempts) {
    if (e.verdict === "not_attempted") continue;
    const cur = attemptMap.get(e.qid) ?? { correct: 0, total: 0 };
    cur.total++;
    if (e.verdict === "correct") cur.correct++;
    attemptMap.set(e.qid, cur);
  }

  let weightedPSum = 0;
  let totalScore = 0;
  let measuredSampleCount = 0;
  let estimatedCount = 0;

  for (const q of validQs) {
    const score = q.score || 1;
    totalScore += score;

    const stat = attemptMap.get(q.id);
    let itemP: number;

    if (stat && stat.total >= 3) {
      // 拥有真实作答样本（>=3人次）
      itemP = Math.max(0.05, Math.min(0.95, stat.correct / stat.total));
      measuredSampleCount++;
    } else {
      // 依据人工设定的星级难度折算
      const stars = q.difficulty ? Math.min(5, Math.max(1, q.difficulty)) : 3;
      itemP = STARS_TO_P[stars] ?? 0.5;
      estimatedCount++;
    }

    weightedPSum += itemP * score;
  }

  const averageP = totalScore > 0 ? Math.round((weightedPSum / totalScore) * 100) / 100 : 0.5;

  let grade: PaperDifficultyGrade = "medium";
  let difficultyLabel = "适中难度（标准模考）";
  let summaryAdvice = "难度配比均衡，既能有效检验基础掌握，又兼具区分度。";

  if (averageP >= 0.75) {
    grade = "easy";
    difficultyLabel = "基础通关卷（难度偏低）";
    summaryAdvice = "全卷难度偏低，适合阶段验收或考前建立信心，建议适当增补压轴题。";
  } else if (averageP < 0.35) {
    grade = "extreme";
    difficultyLabel = "高难挑战密卷（极难）";
    summaryAdvice = "🚨 全卷难度极高，易挫伤考生士气，请确认是否为专项尖子生攻坚特训。";
  } else if (averageP < 0.50) {
    grade = "hard";
    difficultyLabel = "拔高冲刺卷（偏难）";
    summaryAdvice = "综合难度偏高，对核心原理与综合解题速度要求严苛，适合冲刺提分。";
  }

  return {
    totalQuestions,
    totalScore,
    averageP,
    grade,
    difficultyLabel,
    measuredSampleCount,
    estimatedCount,
    summaryAdvice,
  };
}

/**
 * 试卷知识点分值分布与大纲契合度检查
 */
export function auditPaperSyllabusBalance(
  questions: readonly Question[],
  syllabusRoots: readonly SyllabusNode[] = [],
): PaperBalanceReport {
  const validQs = questions.filter((q) => q.type !== "material");
  let totalScore = 0;
  let objectiveScore = 0;
  let subjectiveScore = 0;

  const kpScoreMap = new Map<string, { count: number; score: number }>();

  for (const q of validQs) {
    const sc = q.score || 1;
    totalScore += sc;

    if (q.type === "single" || q.type === "multiple" || q.type === "judge") {
      objectiveScore += sc;
    } else {
      subjectiveScore += sc;
    }

    const kp = (q.kp || "综合/未分类").trim();
    const cur = kpScoreMap.get(kp) ?? { count: 0, score: 0 };
    cur.count++;
    cur.score += sc;
    kpScoreMap.set(kp, cur);
  }

  const objectiveRatio = totalScore > 0 ? Math.round((objectiveScore / totalScore) * 100) : 0;
  const subjectiveRatio = totalScore > 0 ? Math.round((subjectiveScore / totalScore) * 100) : 0;

  const crowdedKps: string[] = [];
  const kpDistributions: KpScoreDistributionItem[] = [];

  for (const [kp, data] of kpScoreMap) {
    const pct = totalScore > 0 ? Math.round((data.score / totalScore) * 100) : 0;
    let status: KpScoreDistributionItem["status"] = "balanced";

    if (pct >= 35 && kpScoreMap.size > 1) {
      status = "crowded";
      crowdedKps.push(kp);
    } else if (pct < 10) {
      status = "light";
    }

    kpDistributions.push({
      kp,
      questionCount: data.count,
      scoreTotal: data.score,
      scoreSharePct: pct,
      status,
    });
  }

  // 按分值占比降序排列
  kpDistributions.sort((a, b) => b.scoreTotal - a.scoreTotal);

  // 检出考纲覆盖盲区
  const missingSyllabusNodes: string[] = [];
  const traverse = (node: SyllabusNode) => {
    const isLeaf = !node.children?.length;
    if (isLeaf) {
      const isCovered = Array.from(kpScoreMap.keys()).some(
        (k) => k === node.kpPrefix || k.includes(node.title) || node.kpPrefix.includes(k),
      );
      if (!isCovered) {
        missingSyllabusNodes.push(node.title);
      }
    }
    for (const ch of node.children || []) traverse(ch);
  };
  for (const root of syllabusRoots) traverse(root);

  let balanceGrade: PaperBalanceReport["balanceGrade"] = "excellent";
  let advice = "分值与考点分布均衡，客观/主观题搭配合理。";

  if (crowdedKps.length > 0 || (missingSyllabusNodes.length >= 3 && syllabusRoots.length > 0)) {
    balanceGrade = "skewed";
    advice = "⚠️ 试卷考点分布略有偏科，部分章节分值占比过高，且有多个考纲考点未覆盖。";
  } else if (missingSyllabusNodes.length > 0) {
    balanceGrade = "acceptable";
    advice = "考点结构基本合理，仍有少数考纲节点未覆盖，可作为补充试题引入。";
  }

  return {
    objectiveScore,
    subjectiveScore,
    objectiveRatio,
    subjectiveRatio,
    kpDistributions,
    crowdedKps,
    missingSyllabusNodes: missingSyllabusNodes.slice(0, 10),
    balanceGrade,
    advice,
  };
}

/**
 * 导出试卷预估难度与大纲契合度诊断卡 Markdown
 */
export function exportPaperAuditMarkdown(
  prediction: PaperDifficultyPrediction,
  balance: PaperBalanceReport,
  paperTitle = "试卷诊断报告",
): string {
  const lines: string[] = [];
  lines.push(`# 📊 ${paperTitle} · 预估难度与大纲体检报告`);
  lines.push(`> 试卷总分：**${prediction.totalScore} 分** | 题目量：**${prediction.totalQuestions} 题** | 预估通过率 P：**${prediction.averageP}**（${prediction.difficultyLabel}）\n`);

  lines.push(`## 🎯 试题难度与分值结构`);
  lines.push(`- **客观题分值**：${balance.objectiveScore} 分（占比 ${balance.objectiveRatio}%）`);
  lines.push(`- **主观题分值**：${balance.subjectiveScore} 分（占比 ${balance.subjectiveRatio}%）`);
  lines.push(`- **难度诊断建议**：${prediction.summaryAdvice}\n`);

  lines.push(`## 📋 考点分值分布清单`);
  lines.push(`| 考点名称 | 题目数量 | 分值小计 | 全卷占比 | 状态诊断 |`);
  lines.push(`|---|---|---|---|---|`);

  for (const kd of balance.kpDistributions) {
    const statusText = kd.status === "crowded" ? "🔵 分值较密集" : kd.status === "light" ? "⚪ 轻量考核" : "🟢 适中均衡";
    lines.push(`| ${kd.kp} | ${kd.questionCount} | ${kd.scoreTotal} 分 | ${kd.scoreSharePct}% | ${statusText} |`);
  }

  if (balance.missingSyllabusNodes.length > 0) {
    lines.push(`\n### 🚨 考纲未覆盖考点`);
    lines.push(`以下考点在本次试卷中出题数为 0：${balance.missingSyllabusNodes.join("、")}`);
  }

  return lines.join("\n");
}
