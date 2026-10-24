// ============================================================
// 题目实测难度与区分度自动校准纯函数引擎（43-08 / 45-08）
// 纯函数领域层：
// 1. 经典测验理论实测难度计算：P = 通过人次 / 有效作答人次（0-1，值越大越容易）
// 2. 实测星级映射（1-5 星）与作者预设星级难度偏差分析（difficultyBias）
// 3. 基于极端组法（Kelley 27% 规则）的实测区分度计算：D = P_High - P_Low
// 4. 试题质量与有效性评级（Ebel 标准：优良/良好/临界/低区分度/负区分度异常）
// 5. 样本置信度保护（小样本下不误判）与全库题目质量体检 CSV 导出
// 规则：严格无外部宿主依赖（禁 import "siyuan"），严禁类型强转。
// ============================================================

import type { AttemptEvent, Question } from "./types";

export type DiscriminationGrade =
  | "excellent" // D >= 0.40 优良
  | "good" // 0.30 <= D < 0.40 良好
  | "marginal" // 0.20 <= D < 0.30 临界
  | "poor" // 0 <= D < 0.20 低区分度
  | "negative"; // D < 0 负区分度异常（警报）

export const DISCRIMINATION_GRADE_LABELS: Record<DiscriminationGrade, string> = {
  excellent: "优良 (D ≥ 0.40)",
  good: "良好 (0.30 ≤ D < 0.40)",
  marginal: "临界 (0.20 ≤ D < 0.30)",
  poor: "偏低 (0 ≤ D < 0.20)",
  negative: "负区分度异常 (D < 0)",
};

export const DEFAULT_MIN_DISCRIMINATION_SAMPLE = 10;
export const DEFAULT_KELLEY_RATIO = 0.27; // 极端组法高低分组比例（经典 27%）

export interface ItemDiscriminationResult {
  qid: string;
  stemSnippet: string;
  type: Question["type"];
  /** 有效作答总次数（排除未作答 not_attempted） */
  validAttempts: number;
  /** 实测难度 P 值（0-1，通过率，值越大表示题目越容易） */
  difficultyP: number;
  /** 实测换算星级难度（1-5 星，1星最易、5星最难） */
  empiricalStars: number;
  /** 作者预设星级难度（1-5 星，若未预设则为 null） */
  authorStars: number | null;
  /** 难度预估偏差：authorStars - empiricalStars（正数表示作者预估偏难，负数表示预估偏易） */
  difficultyBias: number | null;
  /** 实测区分度 D 值（-1.0 到 1.0） */
  discriminationD: number;
  /** 区分度评价等级 */
  grade: DiscriminationGrade;
  /** 高分组统计 */
  highGroup: { count: number; correctCount: number; passRate: number };
  /** 低分组统计 */
  lowGroup: { count: number; correctCount: number; passRate: number };
  /** 样本置信度（有效作答人次达到门槛时为 true） */
  confident: boolean;
  /** 诊断与优化建议 */
  diagnosisNote: string;
}

export interface BankDiscriminationAudit {
  totalQuestions: number;
  analyzedCount: number;
  confidentCount: number;
  averageP: number;
  averageD: number;
  gradeCounts: Record<DiscriminationGrade, number>;
  /** 异常题目清单（负区分度异常题或低区分度且样本充足的题目） */
  anomalies: ItemDiscriminationResult[];
  /** 全量题目分析明细 */
  items: ItemDiscriminationResult[];
}

/** 将实测通过率 P (0-1) 换算为标准 1-5 星级难度 */
export function computeEmpiricalStars(p: number): number {
  if (p >= 0.85) return 1; // 极易（通过率 ≥85%）
  if (p >= 0.65) return 2; // 偏易（通过率 65% - 85%）
  if (p >= 0.45) return 3; // 中等（通过率 45% - 65%）
  if (p >= 0.25) return 4; // 偏难（通过率 25% - 45%）
  return 5; // 极难（通过率 <25%）
}

/** 依据 Ebel 标准评定区分度等级 */
export function evaluateDiscriminationGrade(d: number): DiscriminationGrade {
  if (d >= 0.4) return "excellent";
  if (d >= 0.3) return "good";
  if (d >= 0.2) return "marginal";
  if (d >= 0) return "poor";
  return "negative";
}

/**
 * 依据学习者作答流水计算单道题目的实测难度与区分度。
 * 纯函数无 IO。
 */
export function calculateItemDiscrimination(
  question: Question,
  questionEvents: readonly AttemptEvent[],
  allEvents: readonly AttemptEvent[] = [],
  options: {
    minSample?: number;
    kelleyRatio?: number;
  } = {},
): ItemDiscriminationResult {
  const minSample = options.minSample ?? DEFAULT_MIN_DISCRIMINATION_SAMPLE;
  const kelleyRatio = options.kelleyRatio ?? DEFAULT_KELLEY_RATIO;

  // 1. 过滤本题的有效作答
  const validQEvents = questionEvents.filter(
    (e) => e.qid === question.id && (e.verdict === "correct" || e.verdict === "wrong"),
  );
  const validAttempts = validQEvents.length;

  const stemSnippet = String(question?.stem ?? "").trim().split("\n")[0].slice(0, 40) || "未命名题干";
  const authorStars = typeof question.difficulty === "number" && question.difficulty >= 1 && question.difficulty <= 5
    ? Math.round(question.difficulty)
    : null;

  // 若无有效作答，给出空结果
  if (validAttempts === 0) {
    return {
      qid: question.id,
      stemSnippet,
      type: question.type,
      validAttempts: 0,
      difficultyP: -1,
      empiricalStars: 3,
      authorStars,
      difficultyBias: null,
      discriminationD: 0,
      grade: "poor",
      highGroup: { count: 0, correctCount: 0, passRate: 0 },
      lowGroup: { count: 0, correctCount: 0, passRate: 0 },
      confident: false,
      diagnosisNote: "暂无有效作答记录，无法评估难度与区分度。",
    };
  }

  // 2. 计算实测难度 P 值与星级
  const correctAttempts = validQEvents.filter((e) => e.verdict === "correct").length;
  const difficultyP = Math.round((correctAttempts / validAttempts) * 1000) / 1000;
  const empiricalStars = computeEmpiricalStars(difficultyP);
  const difficultyBias = authorStars !== null ? authorStars - empiricalStars : null;

  // 3. 构建学习者能力上下文标尺（以会话中除本题之外的题目表现衡量，避免自我抬升/循环偏倚）
  const sessionStats = new Map<string, { total: number; correct: number }>();
  for (const e of allEvents) {
    if (e.qid !== question.id && e.sessionId && (e.verdict === "correct" || e.verdict === "wrong")) {
      const s = sessionStats.get(e.sessionId) ?? { total: 0, correct: 0 };
      s.total++;
      if (e.verdict === "correct") s.correct++;
      sessionStats.set(e.sessionId, s);
    }
  }

  // 为本题的每次作答赋予当时所属会话的作答能力评分（若无其他题，以全局平均基线衡量）
  interface ScoredAttempt {
    event: AttemptEvent;
    abilityRank: number;
  }

  const scoredAttempts: ScoredAttempt[] = validQEvents.map((e, idx) => {
    const sStat = e.sessionId ? sessionStats.get(e.sessionId) : null;
    const ability = sStat && sStat.total > 0 ? sStat.correct / sStat.total : (e.verdict === "correct" ? 0.6 : 0.4);
    // 综合能力评分 + 细微序号扰动以保持确定性排序
    return {
      event: e,
      abilityRank: ability * 1000 + idx,
    };
  });

  // 按能力高低降序排列
  scoredAttempts.sort((a, b) => b.abilityRank - a.abilityRank);

  // 4. 依据极端组法（Kelley 27%）切分高分组与低分组
  const groupSize = Math.max(1, Math.floor(validAttempts * kelleyRatio));
  const highAttempts = scoredAttempts.slice(0, groupSize);
  const lowAttempts = scoredAttempts.slice(-groupSize);

  const highCorrect = highAttempts.filter((a) => a.event.verdict === "correct").length;
  const lowCorrect = lowAttempts.filter((a) => a.event.verdict === "correct").length;

  const highPassRate = Math.round((highCorrect / highAttempts.length) * 1000) / 1000;
  const lowPassRate = Math.round((lowCorrect / lowAttempts.length) * 1000) / 1000;

  const rawD = highPassRate - lowPassRate;
  const discriminationD = Math.max(-1, Math.min(1, Math.round(rawD * 1000) / 1000));
  const grade = evaluateDiscriminationGrade(discriminationD);
  const confident = validAttempts >= minSample;

  // 5. 诊断建议生成
  let diagnosisNote: string;
  if (!confident) {
    diagnosisNote = `样本较少（已练 ${validAttempts} 次 / 门槛 ${minSample} 次），当前区分度指标仅供参考。`;
  } else if (grade === "negative") {
    diagnosisNote = "⚠️ 负区分度严重异常！高分组考生答对率反而低于低分组，提示题干表述可能存在重大歧义、误导陷阱或标准答案错误。";
  } else if (grade === "poor") {
    diagnosisNote = "区分度偏低（D < 0.20）。题目可能过于简单、过于生僻或选项缺乏有效干扰性，建议优化干扰选项。";
  } else if (grade === "marginal") {
    diagnosisNote = "区分度处于临界水平（0.20 ≤ D < 0.30），题目尚可使用，建议审查题目选项设置。";
  } else {
    diagnosisNote = `试题区分能力优异（D = ${discriminationD}），能够准确甄别学习者真实掌握水平。`;
  }

  if (difficultyBias !== null && Math.abs(difficultyBias) >= 2) {
    diagnosisNote += ` 此外，作者设定（${authorStars}星）与实测难度（${empiricalStars}星）偏差较大（偏差 ${difficultyBias > 0 ? "+" : ""}${difficultyBias}），建议校准。`;
  }

  return {
    qid: question.id,
    stemSnippet,
    type: question.type,
    validAttempts,
    difficultyP,
    empiricalStars,
    authorStars,
    difficultyBias,
    discriminationD,
    grade,
    highGroup: {
      count: highAttempts.length,
      correctCount: highCorrect,
      passRate: highPassRate,
    },
    lowGroup: {
      count: lowAttempts.length,
      correctCount: lowCorrect,
      passRate: lowPassRate,
    },
    confident,
    diagnosisNote,
  };
}

/** 全库题目难度与区分度全面体检 */
export function auditBankDiscrimination(
  questions: readonly Question[],
  allEvents: readonly AttemptEvent[],
  options: { minSample?: number; kelleyRatio?: number } = {},
): BankDiscriminationAudit {
  const minSample = options.minSample ?? DEFAULT_MIN_DISCRIMINATION_SAMPLE;
  const qEventsMap = new Map<string, AttemptEvent[]>();

  for (const e of allEvents) {
    const list = qEventsMap.get(e.qid) ?? [];
    list.push(e);
    qEventsMap.set(e.qid, list);
  }

  const items: ItemDiscriminationResult[] = [];
  const anomalies: ItemDiscriminationResult[] = [];
  const gradeCounts: Record<DiscriminationGrade, number> = {
    excellent: 0,
    good: 0,
    marginal: 0,
    poor: 0,
    negative: 0,
  };

  let sumP = 0;
  let sumD = 0;
  let validItemsCount = 0;
  let confidentCount = 0;

  for (const q of questions) {
    const qEvents = qEventsMap.get(q.id) ?? [];
    const res = calculateItemDiscrimination(q, qEvents, allEvents, options);
    items.push(res);

    if (res.validAttempts > 0) {
      validItemsCount++;
      sumP += res.difficultyP;
      sumD += res.discriminationD;
      gradeCounts[res.grade]++;

      if (res.confident) {
        confidentCount++;
        // 置信且表现异常的题目归入异常清单
        if (res.grade === "negative" || res.grade === "poor") {
          anomalies.push(res);
        }
      } else if (res.grade === "negative" && res.validAttempts >= Math.max(3, Math.floor(minSample * 0.5))) {
        // 中等样本下出现明显的负区分度，也及时预警
        anomalies.push(res);
      }
    }
  }

  const averageP = validItemsCount > 0 ? Math.round((sumP / validItemsCount) * 1000) / 1000 : 0;
  const averageD = validItemsCount > 0 ? Math.round((sumD / validItemsCount) * 1000) / 1000 : 0;

  return {
    totalQuestions: questions.length,
    analyzedCount: validItemsCount,
    confidentCount,
    averageP,
    averageD,
    gradeCounts,
    anomalies,
    items,
  };
}

/** 导出全库试题难度与区分度分析报告 CSV（带 UTF-8 BOM 文本等价物） */
export function exportDiscriminationCsv(audit: BankDiscriminationAudit): string {
  const headers = [
    "题目ID",
    "题干摘要",
    "题型",
    "有效作答次数",
    "实测通过率P",
    "实测星级",
    "作者预设星级",
    "难度偏差",
    "区分度D",
    "区分度评级",
    "高分组通过率",
    "低分组通过率",
    "样本充分",
    "诊断建议",
  ];

  const rows = audit.items.map((it) => [
    it.qid,
    `"${(it.stemSnippet ?? "").replace(/"/g, '""')}"`,
    it.type,
    it.validAttempts,
    it.difficultyP >= 0 ? it.difficultyP : "",
    it.empiricalStars,
    it.authorStars ?? "",
    it.difficultyBias !== null ? it.difficultyBias : "",
    it.discriminationD,
    it.grade,
    it.highGroup.passRate,
    it.lowGroup.passRate,
    it.confident ? "是" : "否",
    `"${(it.diagnosisNote ?? "").replace(/"/g, '""')}"`,
  ]);

  return "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}
