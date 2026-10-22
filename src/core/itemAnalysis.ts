// ============================================================
// 43-02 题目使用分析与干扰项效率（Item Analysis & Distractor Efficiency）
// 1) 作答量、正确率、跳过率、平均耗时与低样本置信度判定。
// 2) 逐选项选择率直方统计、正确选项 vs 干扰项识别、零命中失效干扰项（Dead Distractor）检出。
// 3) 错因分布统计与结构化 CSV 导出。
// ============================================================

import type { AttemptEvent, Question } from "./types";
import { normalizeAnswer } from "./answer";

export interface OptionPickStat {
  letter: string;
  text: string;
  count: number;
  pct: number; // 0-100 整数
  isCorrect: boolean;
  isDistractor: boolean;
  isDeadDistractor: boolean; // 零命中干扰项（总作答数达到门槛但该干扰项选择率为 0）
}

export interface ItemAnalysisReport {
  qid: string;
  stem: string;
  type: Question["type"];
  totalAttempts: number;
  correctCount: number;
  wrongCount: number;
  accuracy: number; // 0-100
  skippedCount: number;
  skipRate: number; // 0-100
  avgTimeMs: number;
  isLowSample: boolean; // 样本不足门槛（默认 < 5 题次）
  options: OptionPickStat[];
  effectiveDistractorsCount: number;
  deadDistractorsCount: number;
  reasonCounts: Record<string, number>;
  lastAttemptAt: number | null;
}

export const MIN_ITEM_ANALYSIS_SAMPLE = 5;

/** 43-02 纯函数：根据题目与作答流水生成使用深度分析与干扰项效率报告 */
export function analyzeQuestionUsage(
  q: Question,
  allEvents: readonly AttemptEvent[],
  opts?: {
    minSample?: number;
    wrongReasonMap?: ReadonlyMap<string, string>;
  },
): ItemAnalysisReport {
  const minSample = opts?.minSample ?? MIN_ITEM_ANALYSIS_SAMPLE;
  const qEvents = allEvents.filter((e) => e.qid === q.id);

  let correctCount = 0;
  let wrongCount = 0;
  let skippedCount = 0;
  let totalTimeMs = 0;
  let timedCount = 0;
  let lastAttemptAt: number | null = null;

  const letterPicks: Record<string, number> = {};
  const reasonCounts: Record<string, number> = {};

  for (const e of qEvents) {
    if (e.ts) {
      if (lastAttemptAt === null || e.ts > lastAttemptAt) lastAttemptAt = e.ts;
    }

    if (e.verdict === "not_attempted") {
      skippedCount++;
      continue;
    }

    if (e.verdict === "correct") {
      correctCount++;
    } else if (e.verdict === "wrong") {
      wrongCount++;
    }

    if (typeof e.timeMs === "number" && e.timeMs > 0) {
      totalTimeMs += e.timeMs;
      timedCount++;
    }

    // 记录错因（若有）
    const reason = opts?.wrongReasonMap?.get(q.id);
    if (reason && e.verdict === "wrong") {
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    }

    // 选项选择分布统计（针对选择题）
    if ((q.type === "single" || q.type === "multiple") && e.myAnswer) {
      const normalized = normalizeAnswer(q.type, e.myAnswer);
      if (normalized) {
        for (const ch of normalized) {
          letterPicks[ch] = (letterPicks[ch] ?? 0) + 1;
        }
      }
    }
  }

  const validAttempts = correctCount + wrongCount;
  const totalAll = validAttempts + skippedCount;
  const accuracy = validAttempts > 0 ? Math.round((correctCount / validAttempts) * 100) : 0;
  const skipRate = totalAll > 0 ? Math.round((skippedCount / totalAll) * 100) : 0;
  const avgTimeMs = timedCount > 0 ? Math.round(totalTimeMs / timedCount) : 0;
  const isLowSample = validAttempts < minSample;

  // 选项细化统计
  const optionsStats: OptionPickStat[] = [];
  let effectiveDistractors = 0;
  let deadDistractors = 0;

  if (q.type === "single" || q.type === "multiple") {
    const correctLetters = new Set(normalizeAnswer(q.type, q.answer)?.split("") ?? []);
    const optsList = q.options ?? [];

    for (let i = 0; i < optsList.length; i++) {
      const letter = String.fromCharCode(65 + i);
      const text = optsList[i] ?? "";
      const count = letterPicks[letter] ?? 0;
      const pct = validAttempts > 0 ? Math.round((count / validAttempts) * 100) : 0;
      const isCorrect = correctLetters.has(letter);
      const isDistractor = !isCorrect;
      const isDead = isDistractor && !isLowSample && count === 0;

      if (isDistractor) {
        if (count > 0) effectiveDistractors++;
        if (isDead) deadDistractors++;
      }

      optionsStats.push({
        letter,
        text,
        count,
        pct,
        isCorrect,
        isDistractor,
        isDeadDistractor: isDead,
      });
    }
  }

  return {
    qid: q.id,
    stem: q.stem,
    type: q.type,
    totalAttempts: validAttempts,
    correctCount,
    wrongCount,
    accuracy,
    skippedCount,
    skipRate,
    avgTimeMs,
    isLowSample,
    options: optionsStats,
    effectiveDistractorsCount: effectiveDistractors,
    deadDistractorsCount: deadDistractors,
    reasonCounts,
    lastAttemptAt,
  };
}

/** 43-02 导出题目使用分析与选项选择率为结构化 CSV */
export function exportItemAnalysisCsv(report: ItemAnalysisReport): string {
  const lines: string[] = [];
  lines.push(`"题目ID","${report.qid}"`);
  lines.push(`"题干","${report.stem.replace(/"/g, '""')}"`);
  lines.push(`"总作答数",${report.totalAttempts}`);
  lines.push(`"正确数",${report.correctCount}`);
  lines.push(`"错误数",${report.wrongCount}`);
  lines.push(`"正确率","${report.accuracy}%"`);
  lines.push(`"平均用时(秒)",${(report.avgTimeMs / 1000).toFixed(1)}`);
  lines.push(`"跳过率","${report.skipRate}%"`);
  lines.push(`"样本置信","${report.isLowSample ? "低样本（不足5人次）" : "样本充足"}"`);

  if (report.options.length > 0) {
    lines.push("");
    lines.push("选项,类型,选择次数,选择占比,选项内容,状态");
    for (const opt of report.options) {
      const typeLabel = opt.isCorrect ? "正确答案" : "干扰项";
      const statusLabel = opt.isDeadDistractor ? "无效干扰项（0选择）" : opt.count > 0 ? "有效" : "未命中";
      const escText = `"${opt.text.replace(/"/g, '""')}"`;
      lines.push(`${opt.letter},${typeLabel},${opt.count},${opt.pct}%,${escText},${statusLabel}`);
    }
  }

  return "\uFEFF" + lines.join("\r\n");
}

// 43-08 题目难度与区分度引擎联动重导出
export {
  calculateItemDiscrimination,
  auditBankDiscrimination,
  exportDiscriminationCsv,
  computeEmpiricalStars,
  evaluateDiscriminationGrade,
  type ItemDiscriminationResult,
  type BankDiscriminationAudit,
  type DiscriminationGrade,
} from "./itemDiscrimination";

import { auditBankDiscrimination, type DiscriminationGrade } from "./itemDiscrimination";

export interface ItemQualityAuditItem {
  qid: string;
  stem: string;
  kp?: string;
  difficultyP: number;
  discriminationD: number;
  grade: DiscriminationGrade;
  deadDistractorCount: number;
  deadDistractorLetters: string[];
  totalAttempts: number;
  advice: string;
}

export interface ItemQualityAuditReport {
  bankTotal: number;
  evaluatedCount: number;
  averageP: number;
  averageD: number;
  flawedQuestionsCount: number;
  deadDistractorsTotal: number;
  items: ItemQualityAuditItem[];
}

/**
 * 教师教研端：全库试题质量 CTT 指标与死干扰项综合诊断
 */
export function generateItemQualityAuditReport(
  questions: readonly Question[],
  attempts: readonly AttemptEvent[],
): ItemQualityAuditReport {
  const cttAudit = auditBankDiscrimination(questions, attempts);
  const items: ItemQualityAuditItem[] = [];

  let deadDistractorsTotal = 0;
  let flawedQuestionsCount = 0;

  for (const q of questions) {
    if (q.type === "material") continue;
    const usage = analyzeQuestionUsage(q, attempts);
    const disc = cttAudit.items.find((it) => it.qid === q.id);

    const deadLetters = usage.options
      .filter((opt) => opt.isDeadDistractor)
      .map((opt) => opt.letter);

    deadDistractorsTotal += deadLetters.length;

    const grade = disc?.grade ?? "good";
    if (grade === "poor" || grade === "negative" || deadLetters.length > 0) {
      flawedQuestionsCount++;
    }

    let advice = "试题表现正常";
    if (grade === "negative") {
      advice = "🚨 负区分度严重异常：高分组得分率反而低于低分组，提示题面可能有歧义或答案有误，需立即核查修订！";
    } else if (grade === "poor") {
      advice = "⚠️ 区分度偏低（D < 0.2）：试题辨别优劣能力较差，建议优化题干设问或干扰项。";
    } else if (deadLetters.length > 0) {
      advice = `🔧 存在死干扰项（选项 ${deadLetters.join(",")} 零选择）：干扰项缺乏迷惑度，建议替换为典型认知误区。`;
    }

    items.push({
      qid: q.id,
      stem: q.stem,
      kp: q.kp,
      difficultyP: disc?.difficultyP ?? 0.5,
      discriminationD: disc?.discriminationD ?? 0.3,
      grade,
      deadDistractorCount: deadLetters.length,
      deadDistractorLetters: deadLetters,
      totalAttempts: usage.totalAttempts,
      advice,
    });
  }

  return {
    bankTotal: questions.length,
    evaluatedCount: items.length,
    averageP: cttAudit.averageP,
    averageD: cttAudit.averageD,
    flawedQuestionsCount,
    deadDistractorsTotal,
    items,
  };
}

export function exportItemQualityAuditMarkdown(report: ItemQualityAuditReport): string {
  const lines: string[] = [];
  lines.push(`# 📊 题库试题质量 CTT 测验理论与干扰项诊断报告`);
  lines.push(`> 评估题量：**${report.evaluatedCount}** 题 | 全库平均实测难度 P：**${report.averageP}** | 平均区分度 D：**${report.averageD}**\n`);

  lines.push(`## 🚨 教学教研重点关注指标`);
  lines.push(`- 区分度异常或需修订题目：**${report.flawedQuestionsCount}** 题`);
  lines.push(`- 0% 零选择死干扰项总计：**${report.deadDistractorsTotal}** 个\n`);

  lines.push(`## 📋 试题质量诊断清单`);
  lines.push(`| 题号/题干 | 考点 | 实测难度 P | 区分度 D | 评级 | 死干扰项 | 教研修订建议 |`);
  lines.push(`|---|---|---|---|---|---|---|`);

  for (const it of report.items) {
    const stemSnippet = it.stem.replace(/[\r\n|]/g, " ").slice(0, 30);
    const deadText = it.deadDistractorLetters.length ? it.deadDistractorLetters.join(",") : "无";
    lines.push(`| ${stemSnippet} | ${it.kp || "未分类"} | ${it.difficultyP} | ${it.discriminationD} | ${it.grade} | ${deadText} | ${it.advice} |`);
  }

  return lines.join("\n");
}

export function exportItemQualityAuditCsv(report: ItemQualityAuditReport): string {
  const lines: string[] = [];
  lines.push("题目ID,题干摘要,考点,实测难度P,区分度D,质量评级,死干扰项数,死干扰项列表,作答人次,教研修订建议");

  for (const it of report.items) {
    const escStem = `"${it.stem.replace(/"/g, '""').replace(/[\r\n]/g, " ")}"`;
    const escKp = `"${(it.kp || "").replace(/"/g, '""')}"`;
    const escDead = `"${it.deadDistractorLetters.join(",")}"`;
    const escAdvice = `"${it.advice.replace(/"/g, '""')}"`;
    lines.push(`${it.qid},${escStem},${escKp},${it.difficultyP},${it.discriminationD},${it.grade},${it.deadDistractorCount},${escDead},${it.totalAttempts},${escAdvice}`);
  }

  return "\uFEFF" + lines.join("\r\n");
}
