/**
 * 考场配时策略与分段节奏沙盘引擎 (Exam Pacing Strategy & Time Budgeting Sandbox)
 * 职责：
 * 1. 依据试卷分段（Sections）、题型配比与总时限，智能推算各大题科学作答节奏；
 * 2. 计算各分段的“目标预算耗时”、“单题建议秒数”与“超时预警阈值”；
 * 3. 考后复盘各模块作答用时分布，诊断“耗时陷阱区（Time Sink）”与“高速提分区（Speed Zone）”；
 * 4. 纯函数领域层，支持导出考后配时复盘沙盘报告（Markdown）。
 */

import type { Blueprint, BlueprintSection } from "./mock";
import type { QuestionType } from "./types";

export interface SectionPacingBudget {
  sectionName: string;
  questionCount: number;
  scoreTotal: number;
  budgetSeconds: number; // 建议分配总秒数
  targetPerQuestionS: number; // 单题建议用时（秒）
  alertThresholdS: number; // 单题超时纠结警报阈值（秒）
}

export interface ExamPacingStrategy {
  totalDurationS: number;
  totalQuestions: number;
  sections: SectionPacingBudget[];
  overallAdvice: string;
}

export interface SectionPacingAudit {
  sectionName: string;
  budgetSeconds: number;
  actualSeconds: number;
  diffSeconds: number; // 实际 - 预算（负数表示抢出时间）
  status: "efficient" | "balanced" | "time_sink";
  timeSharePct: number; // 占全卷实际用时的百分比
  advice: string;
}

export interface PacingPostMortemResult {
  totalActualSeconds: number;
  totalBudgetSeconds: number;
  sections: SectionPacingAudit[];
  timeSinkSections: string[];
  efficientSections: string[];
  rhythmGrade: "master" | "good" | "rushed" | "overtime";
  summary: string;
}

/** 行业标准基准作答单题耗时（秒） */
const BASELINE_SECONDS_PER_TYPE: Record<QuestionType, number> = {
  judge: 30,
  single: 45,
  multiple: 80,
  fill: 60,
  short: 200,
  material: 240,
};

/**
 * 计算考场配时策略与各分段科学时间预算
 */
export function calculateExamPacingStrategy(blueprint: Blueprint): ExamPacingStrategy {
  const totalDurationS = Math.max(60, blueprint.durationS || 3600);
  const sections = blueprint.sections || [];

  let rawTotalBudget = 0;
  const rawSections: Array<{
    sec: BlueprintSection;
    rawBudget: number;
    count: number;
    scoreTotal: number;
  }> = [];

  for (const s of sections) {
    const count = Math.max(1, s.count || 1);
    const scoreTotal = count * (s.scoreEach || 1);

    // 计算基准耗时（若声明了多种题型取均值）
    const types = s.types && s.types.length ? s.types : ["single" as QuestionType];
    const avgTypeSeconds = types.reduce((acc, tp) => acc + (BASELINE_SECONDS_PER_TYPE[tp] ?? 50), 0) / types.length;

    const rawBudget = count * avgTypeSeconds;
    rawTotalBudget += rawBudget;

    rawSections.push({ sec: s, rawBudget, count, scoreTotal });
  }

  // 按总可用时限缩放平账，保留 5% 的机动检查与涂卡时间
  const availableS = totalDurationS * 0.95;
  const scale = rawTotalBudget > 0 ? availableS / rawTotalBudget : 1;

  const sectionBudgets: SectionPacingBudget[] = rawSections.map((it) => {
    const budgetSeconds = Math.max(30, Math.round(it.rawBudget * scale));
    const targetPerQuestionS = Math.max(10, Math.round(budgetSeconds / it.count));
    const alertThresholdS = Math.round(targetPerQuestionS * 1.8);

    return {
      sectionName: it.sec.name,
      questionCount: it.count,
      scoreTotal: it.scoreTotal,
      budgetSeconds,
      targetPerQuestionS,
      alertThresholdS,
    };
  });

  const totalQuestions = sectionBudgets.reduce((acc, s) => acc + s.questionCount, 0);

  let overallAdvice = "整体时限较为宽裕，建议稳扎稳打审题。";
  if (totalQuestions > 0 && totalDurationS / totalQuestions < 60) {
    overallAdvice = "⚡ 全卷作答节奏极快（平均单题不足 1 分钟），客观题需即选即跳，切忌单题过度纠结！";
  }

  return {
    totalDurationS,
    totalQuestions,
    sections: sectionBudgets,
    overallAdvice,
  };
}

/**
 * 考后配时沙盘复盘与耗时偏差诊断
 */
export function auditPacingPostMortem(
  strategy: ExamPacingStrategy,
  actualSectionSeconds: Record<string, number>,
): PacingPostMortemResult {
  const sections: SectionPacingAudit[] = [];
  const timeSinkSections: string[] = [];
  const efficientSections: string[] = [];

  let totalActualSeconds = 0;
  let totalBudgetSeconds = 0;

  for (const b of strategy.sections) {
    const actual = Math.max(0, actualSectionSeconds[b.sectionName] ?? b.budgetSeconds);
    totalActualSeconds += actual;
    totalBudgetSeconds += b.budgetSeconds;
  }

  for (const b of strategy.sections) {
    const actual = Math.max(0, actualSectionSeconds[b.sectionName] ?? 0);
    const diff = actual - b.budgetSeconds;
    const timeSharePct = totalActualSeconds > 0 ? Math.round((actual / totalActualSeconds) * 100) : 0;

    let status: SectionPacingAudit["status"] = "balanced";
    let advice = "作答节奏与考前规划完全契合。";

    if (actual > b.budgetSeconds * 1.25) {
      status = "time_sink";
      timeSinkSections.push(b.sectionName);
      advice = `⚠️ 严重超时（超出预算 ${Math.round(diff / 60)} 分钟），侵占了后续大题时间，建议强化题目取舍能力。`;
    } else if (actual < b.budgetSeconds * 0.8 && actual > 10) {
      status = "efficient";
      efficientSections.push(b.sectionName);
      advice = `⚡ 高效提分模块，比预算节约了 ${Math.round(-diff / 60)} 分钟，为后续攻坚赢得了宝贵时间。`;
    }

    sections.push({
      sectionName: b.sectionName,
      budgetSeconds: b.budgetSeconds,
      actualSeconds: actual,
      diffSeconds: diff,
      status,
      timeSharePct,
      advice,
    });
  }

  let rhythmGrade: PacingPostMortemResult["rhythmGrade"] = "good";
  let summary = "全卷时间把控良好，各题型耗时分配合理。";

  if (timeSinkSections.length >= 2 || totalActualSeconds > strategy.totalDurationS) {
    rhythmGrade = "overtime";
    summary = "🚨 考场时间透支严重，部分分段深陷耗时陷阱，考前必须严格执行单题止损时限！";
  } else if (efficientSections.length >= 2 && timeSinkSections.length === 0) {
    rhythmGrade = "master";
    summary = "🏆 掌控考场节奏大师，客观题极速突进，给主观攻坚预留了充沛思考时间！";
  }

  return {
    totalActualSeconds,
    totalBudgetSeconds,
    sections,
    timeSinkSections,
    efficientSections,
    rhythmGrade,
    summary,
  };
}

/**
 * 导出考场配时复盘沙盘报告 Markdown
 */
export function exportPacingReportMarkdown(postMortem: PacingPostMortemResult): string {
  const lines: string[] = [];
  lines.push(`### ⏱️ 考场配时策略与作答节奏沙盘复盘`);
  lines.push(`> 实际总耗时：**${(postMortem.totalActualSeconds / 60).toFixed(1)} 分钟** | 规划预算：**${(postMortem.totalBudgetSeconds / 60).toFixed(1)} 分钟** | 节奏评级：**${postMortem.rhythmGrade.toUpperCase()}**`);
  lines.push(`> **复盘综述**：${postMortem.summary}\n`);

  lines.push(`| 考试大题分段 | 建议预算 | 实际耗时 | 耗时占比 | 节奏诊断 | 复盘建议 |`);
  lines.push(`|---|---|---|---|---|---|`);

  for (const s of postMortem.sections) {
    const tag = s.status === "efficient" ? "⚡ 快速提分" : s.status === "time_sink" ? "🔴 耗时陷阱" : "🟢 节奏稳健";
    lines.push(`| ${s.sectionName} | ${(s.budgetSeconds / 60).toFixed(1)}m | ${(s.actualSeconds / 60).toFixed(1)}m | ${s.timeSharePct}% | ${tag} | ${s.advice} |`);
  }

  return lines.join("\n");
}
