// ============================================================
// 备考完备度体检引擎与考点盲区雷达 (Readiness Health Check & Blindspot Radar)
// 1. 五维备考健康度模型：掌握度(Mastery)、覆盖率(Coverage)、新鲜度(Recency)、盲区清零度(Clearance)、刷题自律度(Stamina)
// 2. 考点盲区风险分级：高危(critical)、中危(warning)、观察(watch)、攻克(cleared)
// 3. 专属备考处方诊断与冲刺天数预测
// 4. 雷达图几何模型集成与纯文本/Markdown/CSV 等价物导出 (45-08 契约)
// 规则：严格无外部宿主依赖（严禁 import "siyuan"），纯函数领域层。
// ============================================================

import type { Question, AttemptEvent } from "./types";
import type { KpMastery } from "./report";
import {
  buildRadarChartModel,
  type RadarChartModel,
  type RadarDimension,
} from "./radar";

/** 五大备考体检维度枚举 */
export type ReadinessDimensionKey =
  | "mastery" // 知识掌握度
  | "coverage" // 题库覆盖率
  | "recency" // 记忆新鲜度
  | "blindspotClearance" // 盲区清零度
  | "stamina"; // 刷题自律度

export type DimensionHealthStatus = "healthy" | "warning" | "danger";

/** 单个维度的体检评分详情 */
export interface ReadinessDimensionScore {
  key: ReadinessDimensionKey;
  label: string;
  score: number; // 0 - 100
  weight: number; // 权重 (0 - 1)
  status: DimensionHealthStatus;
  details: string;
}

/** 考点盲区风险等级 */
export type BlindspotRiskLevel = "critical" | "warning" | "watch" | "cleared";

export const BLINDSPOT_RISK_LABELS: Record<BlindspotRiskLevel, string> = {
  critical: "高危红灯 (急需攻克)",
  warning: "中危黄灯 (存在漏洞/衰减)",
  watch: "观察蓝灯 (样本待丰富)",
  cleared: "已攻克绿灯 (掌握良好)",
};

/** 考点盲区体检条目 */
export interface BlindspotItem {
  kp: string;
  risk: BlindspotRiskLevel;
  /** 考点综合能力分 0-100 */
  score: number;
  /** 正确率 0-100 */
  accuracy: number;
  /** 覆盖率 0-100（-1 为未知） */
  coverage: number;
  /** 题库总题数 */
  totalQuestions: number;
  /** 已练独立题数 */
  practicedCount: number;
  /** 最后有效复习时间戳 */
  lastReviewedAt?: number;
  /** 诊断原因 */
  urgencyReason: string;
  /** 处方建议 */
  prescription: string;
  /** 推荐补练题数 */
  recommendedQuestions: number;
}

/** 完备度等级评定 */
export type ReadinessGrade = "S" | "A" | "B" | "C" | "D";

export interface ReadinessHealthReport {
  overallScore: number; // 0 - 100
  grade: ReadinessGrade;
  gradeTitle: string;
  dimensions: Record<ReadinessDimensionKey, ReadinessDimensionScore>;
  blindspots: BlindspotItem[];
  criticalCount: number;
  warningCount: number;
  watchCount: number;
  clearedCount: number;
  summary: string;
  prescriptions: string[];
  estimatedDaysToReady: number;
  radarModel: RadarChartModel | null;
  generatedAt: number;
}

export interface ReadinessRadarOptions {
  /** 目标考试时间（时间戳或日期字符串） */
  targetExamDate?: number | string;
  /** 当前参考时刻（毫秒，默认 Date.now()） */
  now?: number;
  /** 目标及格线，默认 60 */
  passingScore?: number;
  /** 目标优秀线，默认 85 */
  targetScore?: number;
  /** 各维度权重微调（和需为 1.0） */
  weights?: Partial<Record<ReadinessDimensionKey, number>>;
  /** 雷达图 SVG 边长（默认 320） */
  radarSize?: number;
}

const DEFAULT_WEIGHTS: Record<ReadinessDimensionKey, number> = {
  mastery: 0.25,
  coverage: 0.25,
  recency: 0.2,
  blindspotClearance: 0.15,
  stamina: 0.15,
};

const DIMENSION_LABELS: Record<ReadinessDimensionKey, string> = {
  mastery: "知识掌握度",
  coverage: "题库覆盖率",
  recency: "记忆新鲜度",
  blindspotClearance: "盲区清零度",
  stamina: "刷题自律度",
};

/** 解析时间戳 */
function parseTimestamp(val?: number | string, fallback: number = Date.now()): number {
  if (typeof val === "number" && !Number.isNaN(val)) return val;
  if (typeof val === "string") {
    const parsed = Date.parse(val);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

/**
 * 核心诊断：从 KpMastery 与题库计算考点盲区清单
 */
export function identifyBlindspots(
  questions: readonly Question[],
  masteryList: readonly KpMastery[],
  now: number = Date.now(),
): BlindspotItem[] {
  // 1. 统计各考点在题库中的总题数
  const totalPerKp = new Map<string, number>();
  for (const q of questions) {
    const root = (q.kp ?? "").split("/")[0]?.trim() || "未归类考点";
    totalPerKp.set(root, (totalPerKp.get(root) ?? 0) + 1);
  }

  // 2. 建立已分析的 mastery map
  const masteryMap = new Map<string, KpMastery>();
  for (const m of masteryList) {
    if (m.root) {
      masteryMap.set(m.root, m);
    }
  }

  // 合并题库中的所有考点和 masteryList 考点
  const allKps = new Set<string>([...totalPerKp.keys(), ...masteryMap.keys()]);
  const blindspots: BlindspotItem[] = [];

  for (const kp of allKps) {
    const totalQ = totalPerKp.get(kp) ?? 0;
    const m = masteryMap.get(kp);
    const practicedCount = m ? m.uniqueQids : 0;
    const accuracy = m ? Math.round(m.accuracy * 100) : 0;
    const coverage = totalQ > 0 ? Math.round((practicedCount / totalQ) * 100) : m?.coverage && m.coverage >= 0 ? Math.round(m.coverage * 100) : 0;
    const score = m && m.mastery >= 0 ? Math.round(m.mastery * 100) : 0;
    const lastReviewedAt = m?.evidenceAt;

    // 计算距离上次复习过去的天数
    const daysSinceReview = lastReviewedAt ? Math.max(0, (now - lastReviewedAt) / (24 * 3600 * 1000)) : 999;

    let risk: BlindspotRiskLevel;
    let urgencyReason: string;
    let prescription: string;
    let recommendedQuestions: number;

    if (practicedCount === 0) {
      // 从未练习过
      risk = "critical";
      urgencyReason = `该考点包含 ${totalQ} 道题，但尚未练习任何独立题目，属于完全盲区。`;
      recommendedQuestions = Math.min(totalQ, Math.max(3, Math.ceil(totalQ * 0.5)));
      prescription = `立即开展破冰专项刷题，优先攻克 ${recommendedQuestions} 道基础题。`;
    } else if (score < 40 || (accuracy < 45 && practicedCount >= 2)) {
      // 正确率或掌握度过低
      risk = "critical";
      urgencyReason = `已练 ${practicedCount}/${totalQ} 题，但掌握度仅 ${score}%（正确率 ${accuracy}%），处于高危错题重灾区。`;
      recommendedQuestions = Math.min(Math.max(1, totalQ - practicedCount), 5);
      prescription = `复盘错因自诊断并重新学习核心定义，重点重做错题与补刷 ${recommendedQuestions} 道同类题。`;
    } else if (daysSinceReview > 21 && score < 75) {
      // 遗忘衰减严重
      risk = "warning";
      urgencyReason = `已逾 ${Math.round(daysSinceReview)} 天未复习，艾宾浩斯留存衰减显著，综合掌握度回落至 ${score}%。`;
      recommendedQuestions = Math.min(practicedCount, 3);
      prescription = `启动艾宾浩斯唤醒复习，快速抽测 ${recommendedQuestions} 道核心代表题激活记忆。`;
    } else if (coverage < 50 && totalQ >= 4) {
      // 题目覆盖不足
      risk = "warning";
      urgencyReason = `考点题量较多（${totalQ}题），但当前仅覆盖 ${coverage}%，仍有较多考法未接触。`;
      recommendedQuestions = Math.min(totalQ - practicedCount, 4);
      prescription = `拓展题型视野，补练 ${recommendedQuestions} 道未练题目以提升考点完整度。`;
    } else if (score >= 75 && accuracy >= 75 && (practicedCount >= 3 || (totalQ > 0 && practicedCount >= totalQ))) {
      // 已攻克（练满 3 题，或该考点所有题目均已练完且掌握度高）
      risk = "cleared";
      urgencyReason = `已练 ${practicedCount} 题，掌握度达 ${score}%，且保持较高正确率，状态稳固。`;
      recommendedQuestions = 0;
      prescription = `保持常态考前抽测即可，无需过度占用冲刺时间。`;
    } else if (practicedCount < 3 && totalQ > practicedCount) {
      // 样本量偏低
      risk = "watch";
      urgencyReason = `目前仅练习 ${practicedCount} 道题，虽暂未暴露大面积失分，但样本置信度偏低。`;
      recommendedQuestions = Math.min(totalQ - practicedCount, 2);
      prescription = `持续增补练习 2 道相关习题，积累充分掌握度证据。`;
    } else {
      // 其余情况为观察
      risk = "watch";
      urgencyReason = `已练 ${practicedCount}/${totalQ} 题，掌握度 ${score}%，处于基本掌握阶段。`;
      recommendedQuestions = 2;
      prescription = `考前冲刺阶段安排 1 次小测进行状态确认。`;
    }

    blindspots.push({
      kp,
      risk,
      score,
      accuracy,
      coverage,
      totalQuestions: totalQ,
      practicedCount,
      lastReviewedAt,
      urgencyReason,
      prescription,
      recommendedQuestions,
    });
  }

  // 排序：高危优先 -> 中危 -> 观察 -> 已攻克，同等级按得分升序
  const riskWeight: Record<BlindspotRiskLevel, number> = {
    critical: 4,
    warning: 3,
    watch: 2,
    cleared: 1,
  };

  blindspots.sort((a, b) => {
    const diff = riskWeight[b.risk] - riskWeight[a.risk];
    if (diff !== 0) return diff;
    return a.score - b.score;
  });

  return blindspots;
}

/**
 * 计算五维备考健康度
 */
export function calculateReadinessDimensions(
  questions: readonly Question[],
  masteryList: readonly KpMastery[],
  blindspots: readonly BlindspotItem[],
  attemptEvents: readonly AttemptEvent[] = [],
  now: number = Date.now(),
  weightsInput?: Partial<Record<ReadinessDimensionKey, number>>,
): Record<ReadinessDimensionKey, ReadinessDimensionScore> {
  const weights: Record<ReadinessDimensionKey, number> = {
    ...DEFAULT_WEIGHTS,
    ...(weightsInput ?? {}),
  };

  // 题库为空时特殊规整
  if (questions.length === 0 && masteryList.length === 0) {
    return {
      mastery: {
        key: "mastery",
        label: DIMENSION_LABELS.mastery,
        score: 0,
        weight: weights.mastery,
        status: "danger",
        details: "尚未导入或录入题库题目。",
      },
      coverage: {
        key: "coverage",
        label: DIMENSION_LABELS.coverage,
        score: 0,
        weight: weights.coverage,
        status: "danger",
        details: "尚未开始做题，覆盖率为 0%。",
      },
      recency: {
        key: "recency",
        label: DIMENSION_LABELS.recency,
        score: 0,
        weight: weights.recency,
        status: "danger",
        details: "暂无有效作答记忆证据。",
      },
      blindspotClearance: {
        key: "blindspotClearance",
        label: DIMENSION_LABELS.blindspotClearance,
        score: 0,
        weight: weights.blindspotClearance,
        status: "danger",
        details: "尚未开展考点盲区体检。",
      },
      stamina: {
        key: "stamina",
        label: DIMENSION_LABELS.stamina,
        score: 0,
        weight: weights.stamina,
        status: "danger",
        details: "暂无作答连续性记录。",
      },
    };
  }

  // 1. 知识掌握度 (Mastery)
  let masteryScore = 0;
  if (masteryList.length > 0) {
    let weightedSum = 0;
    let weightCount = 0;
    for (const m of masteryList) {
      const qWeight = Math.max(1, m.uniqueQids);
      const s = m.mastery >= 0 ? m.mastery * 100 : Math.max(0, m.accuracy * 80);
      weightedSum += s * qWeight;
      weightCount += qWeight;
    }
    masteryScore = weightCount > 0 ? Math.round(weightedSum / weightCount) : 0;
  }
  masteryScore = Math.max(0, Math.min(100, masteryScore));

  // 2. 题库覆盖率 (Coverage)
  let coverageScore = 0;
  const totalQuestionsCount = questions.length;
  if (totalQuestionsCount > 0) {
    const practicedQids = new Set<string>();
    for (const ev of attemptEvents) {
      if (ev.qid) practicedQids.add(ev.qid);
    }
    // 若没有 attemptEvents，则根据 blindspots 中的 practicedCount
    if (attemptEvents.length === 0) {
      let sumPracticed = 0;
      for (const b of blindspots) {
        sumPracticed += b.practicedCount;
      }
      coverageScore = Math.round((Math.min(totalQuestionsCount, sumPracticed) / totalQuestionsCount) * 100);
    } else {
      coverageScore = Math.round((practicedQids.size / totalQuestionsCount) * 100);
    }
  }
  coverageScore = Math.max(0, Math.min(100, coverageScore));

  // 3. 记忆新鲜度 (Recency)
  let recencyScore: number;
  if (masteryList.length > 0) {
    const retentions = masteryList.map((m) => {
      if (m.evidenceAt) {
        const days = Math.max(0, (now - m.evidenceAt) / (24 * 3600 * 1000));
        // 艾宾浩斯平滑衰减估算：14 天内保留 85% 以上，30 天保留 50%
        return Math.max(0.1, Math.min(1.0, Math.pow(0.5, days / 25)));
      }
      return m.retention > 0 ? m.retention : 0.2;
    });
    const avgRetention = retentions.reduce((a, b) => a + b, 0) / retentions.length;
    recencyScore = Math.round(avgRetention * 100);
  } else {
    recencyScore = 10;
  }
  recencyScore = Math.max(0, Math.min(100, recencyScore));

  // 4. 盲区清零度 (Blindspot Clearance)
  let clearanceScore: number;
  if (blindspots.length > 0) {
    let penalty = 0;
    for (const b of blindspots) {
      if (b.risk === "critical") penalty += 25;
      else if (b.risk === "warning") penalty += 12;
      else if (b.risk === "watch") penalty += 4;
    }
    // 基础 100 分，扣除加权惩罚，最低 0 分
    clearanceScore = Math.max(0, Math.round(100 - (penalty / blindspots.length) * 2.5));
  } else {
    clearanceScore = 100;
  }
  clearanceScore = Math.max(0, Math.min(100, clearanceScore));

  // 5. 刷题自律度 (Stamina / Consistency)
  let staminaScore: number;
  if (attemptEvents.length > 0) {
    // 统计过去 14 天活跃作答天数
    const activeDays = new Set<string>();
    const fourteenDaysAgo = now - 14 * 24 * 3600 * 1000;
    let recentAttempts = 0;
    for (const ev of attemptEvents) {
      const eventTs = ev.ts || (ev as { at?: number }).at || 0;
      if (eventTs >= fourteenDaysAgo) {
        recentAttempts++;
        const d = new Date(eventTs);
        activeDays.add(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
      }
    }
    // 满分基准：14 天内有至少 7 天活跃且作答 ≥ 30 次
    const dayRatio = Math.min(1.0, activeDays.size / 7);
    const volumeRatio = Math.min(1.0, recentAttempts / 30);
    staminaScore = Math.round((dayRatio * 0.6 + volumeRatio * 0.4) * 100);
  } else {
    // 回退到基于 masteryList 的总作答量
    const totalAttempts = masteryList.reduce((acc, cur) => acc + cur.total, 0);
    staminaScore = Math.max(15, Math.min(85, Math.round((totalAttempts / 50) * 80)));
  }
  staminaScore = Math.max(0, Math.min(100, staminaScore));

  function getStatus(score: number): DimensionHealthStatus {
    if (score >= 75) return "healthy";
    if (score >= 50) return "warning";
    return "danger";
  }

  return {
    mastery: {
      key: "mastery",
      label: DIMENSION_LABELS.mastery,
      score: masteryScore,
      weight: weights.mastery,
      status: getStatus(masteryScore),
      details: `考点综合掌握度 ${masteryScore} 分（及格线 60 分）。`,
    },
    coverage: {
      key: "coverage",
      label: DIMENSION_LABELS.coverage,
      score: coverageScore,
      weight: weights.coverage,
      status: getStatus(coverageScore),
      details: `题库题型覆盖率 ${coverageScore}%。`,
    },
    recency: {
      key: "recency",
      label: DIMENSION_LABELS.recency,
      score: recencyScore,
      weight: weights.recency,
      status: getStatus(recencyScore),
      details: `临考记忆抗遗忘新鲜度 ${recencyScore} 分。`,
    },
    blindspotClearance: {
      key: "blindspotClearance",
      label: DIMENSION_LABELS.blindspotClearance,
      score: clearanceScore,
      weight: weights.blindspotClearance,
      status: getStatus(clearanceScore),
      details: `考点盲区清零度 ${clearanceScore} 分。`,
    },
    stamina: {
      key: "stamina",
      label: DIMENSION_LABELS.stamina,
      score: staminaScore,
      weight: weights.stamina,
      status: getStatus(staminaScore),
      details: `近期备考活跃自律度 ${staminaScore} 分。`,
    },
  };
}

/**
 * 生成综合备考完备度体检报告
 */
export function generateReadinessReport(
  questions: readonly Question[],
  masteryList: readonly KpMastery[],
  attemptEvents: readonly AttemptEvent[] = [],
  options?: ReadinessRadarOptions,
): ReadinessHealthReport {
  const now = parseTimestamp(options?.now, Date.now());
  const blindspots = identifyBlindspots(questions, masteryList, now);
  const dimensions = calculateReadinessDimensions(
    questions,
    masteryList,
    blindspots,
    attemptEvents,
    now,
    options?.weights,
  );

  // 计算加权总分
  let weightedTotal = 0;
  let totalWeight = 0;
  for (const d of Object.values(dimensions)) {
    weightedTotal += d.score * d.weight;
    totalWeight += d.weight;
  }
  const overallScore = totalWeight > 0 ? Math.round(weightedTotal / totalWeight) : 0;

  // 判定等级
  let grade: ReadinessGrade = "D";
  let gradeTitle = "备考高危（大面积漏洞尚未消除）";
  if (overallScore >= 90) {
    grade = "S";
    gradeTitle = "整装待发（知识结构与状态极佳）";
  } else if (overallScore >= 80) {
    grade = "A";
    gradeTitle = "稳步胜任（具备充分应考能力）";
  } else if (overallScore >= 65) {
    grade = "B";
    gradeTitle = "基本达标（存在明显盲区需突击）";
  } else if (overallScore >= 50) {
    grade = "C";
    gradeTitle = "备考预警（核心维度短板显著）";
  }

  // 统计各风险数量
  let criticalCount = 0;
  let warningCount = 0;
  let watchCount = 0;
  let clearedCount = 0;

  for (const b of blindspots) {
    if (b.risk === "critical") criticalCount++;
    else if (b.risk === "warning") warningCount++;
    else if (b.risk === "watch") watchCount++;
    else if (b.risk === "cleared") clearedCount++;
  }

  // 生成全局行动处方 (Top Prescriptions)
  const prescriptions: string[] = [];
  const topCriticals = blindspots.filter((b) => b.risk === "critical");
  const topWarnings = blindspots.filter((b) => b.risk === "warning");

  if (topCriticals.length > 0) {
    const kps = topCriticals.slice(0, 3).map((b) => `「${b.kp}」`).join("、");
    prescriptions.push(`【紧急补漏】重点攻关高危考点 ${kps}，优先补齐至少 ${topCriticals.reduce((a, b) => a + b.recommendedQuestions, 0)} 道核心题。`);
  }

  if (dimensions.recency.status !== "healthy") {
    prescriptions.push(`【记忆唤醒】临考遗忘率较高，建议每日安排 15 分钟基于 FSRS 的高衰减知识点闪卡复习。`);
  }

  if (dimensions.coverage.score < 60) {
    prescriptions.push(`【拓展视野】当前题库覆盖率偏低（仅 ${dimensions.coverage.score}%），建议开启未练题过滤模式扩充题型库。`);
  }

  if (topWarnings.length > 0 && prescriptions.length < 4) {
    const kps = topWarnings.slice(0, 2).map((b) => `「${b.kp}」`).join("、");
    prescriptions.push(`【巩固防线】针对处于遗忘或轻微失分的次级考点 ${kps} 安排 1 轮针对性强化抽测。`);
  }

  if (prescriptions.length === 0) {
    prescriptions.push(`【保持节奏】当前各维度状态均衡健康，保持日常考前模拟与错题复盘即可！`);
  }

  // 估算达到 85 分所需的冲刺天数
  // 假设每天高质攻破 1 个关键盲区考点或 15 道题
  const gapScore = Math.max(0, 85 - overallScore);
  const totalRecommendedQ = blindspots.reduce((acc, cur) => acc + cur.recommendedQuestions, 0);
  const estimatedDaysToReady = Math.max(1, Math.ceil(Math.max(gapScore / 4, totalRecommendedQ / 15)));

  // 构建五维雷达图模型
  const radarDimensions: RadarDimension[] = Object.values(dimensions).map((dim) => ({
    label: dim.label,
    score: dim.score,
    accuracy: dim.score,
    coverage: dim.score,
    totalAttempts: 1,
  }));

  const radarModel = buildRadarChartModel(radarDimensions, {
    size: options?.radarSize ?? 320,
    radius: 110,
  });

  const summary = `备考健康体检总分 ${overallScore}/100（等级 ${grade} · ${gradeTitle}）。共扫描 ${blindspots.length} 个知识模块，检出 ${criticalCount} 个高危盲区，${warningCount} 个预警考点。预计需要冲刺 ${estimatedDaysToReady} 天可达标准优秀状态。`;

  return {
    overallScore,
    grade,
    gradeTitle,
    dimensions,
    blindspots,
    criticalCount,
    warningCount,
    watchCount,
    clearedCount,
    summary,
    prescriptions,
    estimatedDaysToReady,
    radarModel,
    generatedAt: now,
  };
}

/**
 * 导出备考体检 Markdown 诊断报告 (45-08 纯文本等价物规范)
 */
export function exportReadinessReportMarkdown(report: ReadinessHealthReport): string {
  const dateStr = new Date(report.generatedAt).toLocaleString();
  const lines: string[] = [];

  lines.push(`# 🎯 备考完备度体检与考点盲区诊断报告`);
  lines.push(`> 体检时间：${dateStr} | 综合评分：**${report.overallScore} / 100**（等级 **${report.grade}** · ${report.gradeTitle}）\n`);

  lines.push(`## 📊 五维体检雷达指标`);
  lines.push(`| 维度 | 得分 | 权重 | 状态 | 详细诊断 |`);
  lines.push(`| :--- | :---: | :---: | :---: | :--- |`);

  const statusIcons: Record<DimensionHealthStatus, string> = {
    healthy: "🟢 优良",
    warning: "🟡 预警",
    danger: "🔴 告急",
  };

  for (const d of Object.values(report.dimensions)) {
    lines.push(`| ${d.label} | ${d.score} | ${Math.round(d.weight * 100)}% | ${statusIcons[d.status]} | ${d.details} |`);
  }
  lines.push("");

  lines.push(`## 💊 备考冲刺行动处方 (预计还需 ${report.estimatedDaysToReady} 天冲刺)`);
  for (let i = 0; i < report.prescriptions.length; i++) {
    lines.push(`${i + 1}. ${report.prescriptions[i]}`);
  }
  lines.push("");

  lines.push(`## 🔍 考点盲区扫描清单 (共 ${report.blindspots.length} 个考点)`);
  lines.push(`| 风险等级 | 考点名称 | 掌握度 | 正确率 | 题库覆盖 | 建议补练 | 处方行动 |`);
  lines.push(`| :---: | :--- | :---: | :---: | :---: | :---: | :--- |`);

  for (const b of report.blindspots) {
    const riskTag =
      b.risk === "critical"
        ? "🔴 高危"
        : b.risk === "warning"
        ? "🟡 中危"
        : b.risk === "watch"
        ? "🔵 观察"
        : "🟢 攻克";
    lines.push(
      `| ${riskTag} | **${b.kp}** | ${b.score}% | ${b.accuracy}% | ${b.coverage}% (${b.practicedCount}/${b.totalQuestions}) | ${b.recommendedQuestions} 题 | ${b.prescription} |`,
    );
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * 导出考点盲区 CSV 数据 (45-08 契约)
 */
export function exportReadinessReportCsv(report: ReadinessHealthReport): string {
  const rows: string[] = [];
  rows.push(["考点名称", "风险等级", "掌握度得分", "正确率(%)", "覆盖率(%)", "已练题数", "总题数", "建议补练题数", "诊断原因", "复习处方"].map(escapeCsv).join(","));

  for (const b of report.blindspots) {
    rows.push([
      b.kp,
      b.risk,
      b.score.toString(),
      b.accuracy.toString(),
      b.coverage.toString(),
      b.practicedCount.toString(),
      b.totalQuestions.toString(),
      b.recommendedQuestions.toString(),
      b.urgencyReason,
      b.prescription,
    ].map(escapeCsv).join(","));
  }

  return "\uFEFF" + rows.join("\n");
}

function escapeCsv(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}
