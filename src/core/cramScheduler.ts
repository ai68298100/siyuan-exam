// ============================================================
// 考前急救冲刺与动态间隔压缩引擎（53-04 / 39-02 / ADR 0003）
// 纯函数领域层：
// 1. 考前紧急度分级（自适应识别距考天数并切换冲刺模式）
// 2. 动态间隔压缩（将常规长期 FSRS 间隔按临考天数非线性压缩，提高考前暴露频次）
// 3. 多维加权急救候选提取（顽固错题、高危错因、遗忘风险与弱项考点）
// 4. 防过载与防爆量容量配额计算（结合单题耗时科学夹取）
// 5. 契约保障：严格执行 Anki reschedule-off 语义，cram 永不写回长周期卡包调度
// 规则：严格无外部宿主依赖（禁 import "siyuan"），严禁类型强转。
// ============================================================

import type { Question, QuestionType, WrongItem, AttemptEvent } from "./types";
import { queueSemantics, type QueueSemantics } from "./queueIdentity";
import { isStubbornWrong } from "./stubborn";
import { isQuestionDisputed } from "./dispute";

export type UrgencyLevel = "none" | "relaxed" | "sprint" | "emergency";

export interface ExamUrgency {
  level: UrgencyLevel;
  daysLeft: number;
  label: string;
  description: string;
  compressionFactor: number;
}

export interface CramFilterOptions {
  /** 允许纳入的题型（空 = 不限） */
  types?: QuestionType[];
  /** 考点前缀过滤（如 "资料分析"） */
  kpPrefix?: string;
  /** 最小错题次数门槛（默认 1） */
  minWrongCount?: number;
  /** 抽取题目数量上限（默认 30） */
  limit?: number;
  /** 是否包含未练过的全新题目补足（默认 true） */
  includeUnattempted?: boolean;
}

export interface ScoredCramCandidate {
  question: Question;
  score: number;
  reasons: string[];
  isStubborn: boolean;
  wrongCount: number;
}

export interface CramBudget {
  targetMinutes: number;
  avgSecondsPerQuestion: number;
  recommendedCount: number;
  minFloor: number;
  maxCap: number;
  rationale: string;
}

export interface CramSessionSpec {
  mode: "cram";
  queue: "cram";
  urgency: ExamUrgency;
  questions: Question[];
  budget: CramBudget;
  semantics: QueueSemantics;
  receipt: string;
}

const DEFAULT_WRONG_REASON_WEIGHTS: Record<string, number> = {
  unknown: 2.0, // 知识盲区，权重最高
  trap: 1.6, // 题目陷阱，次之
  careless: 1.2, // 粗心失误
};

/** 解析目标考试日期距当前的自然天数（不足 1 天向下取整） */
export function calculateDaysLeft(examDateInput: string | number, nowMs: number = Date.now()): number {
  if (!examDateInput) return -1;
  let targetMs: number;
  if (typeof examDateInput === "number") {
    targetMs = examDateInput;
  } else {
    const trimmed = examDateInput.trim();
    if (!trimmed) return -1;
    // 兼容 YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      targetMs = new Date(`${trimmed}T23:59:59`).getTime();
    } else {
      targetMs = new Date(trimmed).getTime();
    }
  }
  if (!Number.isFinite(targetMs)) return -1;

  const diffMs = targetMs - nowMs;
  return Math.floor(diffMs / 86_400_000);
}

/** 计算考前动态压缩因子：临考天数越少，长周期复习间隔压缩越剧烈 */
export function computeCompressionFactor(daysLeft: number): number {
  if (daysLeft < 0) return 1.0;
  if (daysLeft === 0) return 0.1; // 当天考试，极度压缩
  if (daysLeft <= 3) return 0.15; // 3 天内极速抢分
  if (daysLeft <= 7) return 0.35; // 1 周内急救冲刺
  if (daysLeft <= 14) return 0.65; // 2 周内阶段冲刺
  return 1.0; // 常规长线复习不压缩
}

/** 评估考前紧急度自适应状态 */
export function computeExamUrgency(examDateInput: string | number | undefined | null, nowMs: number = Date.now()): ExamUrgency {
  if (!examDateInput) {
    return {
      level: "none",
      daysLeft: -1,
      label: "未设考期",
      description: "当前未设置目标考试日期，按长线常规节奏复习。",
      compressionFactor: 1.0,
    };
  }

  const daysLeft = calculateDaysLeft(examDateInput, nowMs);
  if (daysLeft < 0) {
    return {
      level: "none",
      daysLeft,
      label: "考期已过",
      description: "考试日期已过，请前往设置更新下一轮备考日期。",
      compressionFactor: 1.0,
    };
  }

  const compressionFactor = computeCompressionFactor(daysLeft);

  if (daysLeft <= 7) {
    return {
      level: "emergency",
      daysLeft,
      label: `距考 ${daysLeft} 天 · 临考急救`,
      description: `距考试仅剩 ${daysLeft} 天！已激活考前急救冲刺，聚焦顽固错题与高频盲区。`,
      compressionFactor,
    };
  }

  if (daysLeft <= 14) {
    return {
      level: "sprint",
      daysLeft,
      label: `距考 ${daysLeft} 天 · 冲刺巩固`,
      description: `进入考前两周冲刺期，复习间隔适当收紧，重点攻坚未掌握题。`,
      compressionFactor,
    };
  }

  return {
    level: "relaxed",
    daysLeft,
    label: `距考 ${daysLeft} 天 · 常规备考`,
    description: `距离考试尚有 ${daysLeft} 天，节奏稳健，保持日常刷题与周期复习。`,
    compressionFactor: 1.0,
  };
}

/**
 * 考前动态压缩后的虚拟到期时刻计算。
 * 核心契约：仅在考前冲刺候选提取排序中作为虚拟权重，绝对不写回内核长周期调度表！
 */
export function compressIntervalDays(regularIntervalDays: number, daysLeft: number): number {
  if (daysLeft <= 0) return 1;
  const factor = computeCompressionFactor(daysLeft);
  const compressed = regularIntervalDays * factor;
  // 无论原间隔多长，考前单次冲刺间隔不得超过距考天数的一半（最少 1 天）
  const maxAllowable = Math.max(1, Math.floor(daysLeft * 0.5));
  return Math.max(1, Math.min(maxAllowable, Math.round(compressed)));
}

/**
 * 考前急救候选加权排序与提取。
 * 综合评估：顽固错题程度、错因严重度、考点弱项以及未练覆盖。
 */
export function extractCramCandidates(options: {
  allQuestions: readonly Question[];
  wrongItems: readonly WrongItem[];
  wrongReasons?: ReadonlyMap<string, string>;
  archivedQids?: ReadonlySet<string>;
  filter?: CramFilterOptions;
  daysLeft?: number;
}): ScoredCramCandidate[] {
  const { allQuestions, wrongItems, wrongReasons, archivedQids, filter, daysLeft = 7 } = options;
  const minWrongCount = filter?.minWrongCount ?? 1;
  const limit = filter?.limit ?? 30;
  const allowedTypes = filter?.types && filter.types.length ? new Set(filter.types) : null;
  const kpPrefix = filter?.kpPrefix?.trim();

  // 1. 建立错题快照索引
  const wrongMap = new Map<string, WrongItem>();
  for (const w of wrongItems) {
    wrongMap.set(w.qid, w);
  }

  const scoredList: ScoredCramCandidate[] = [];

  for (const q of allQuestions) {
    // 排除安全守卫：已封存归档题、争议题不纳入急救冲刺
    if (archivedQids?.has(q.id)) continue;
    if (isQuestionDisputed(q)) continue;

    // 题型与考点过滤
    if (allowedTypes && !allowedTypes.has(q.type)) continue;
    if (kpPrefix && !q.kp?.startsWith(kpPrefix)) continue;

    const wrong = wrongMap.get(q.id);
    const count = wrong?.wrongCount ?? 0;

    // 如果未答过且不允许未答题加入，则跳过
    if (count < minWrongCount && (!filter?.includeUnattempted || count > 0)) {
      continue;
    }

    let score = 0;
    const reasons: string[] = [];

    if (count > 0) {
      // 错次基础分
      score += count * 10;
      reasons.push(`累计答错 ${count} 次`);

      // 顽固题重度加权（连续正确为 0 且错 ≥3 次）
      const stubborn = wrong ? isStubbornWrong(wrong) : false;
      if (stubborn) {
        score += 35;
        reasons.push("🔥 顽固攻坚题");
      }

      // 错因系数加权
      const reasonKey = wrongReasons?.get(q.id) ?? wrong?.reason;
      if (reasonKey && DEFAULT_WRONG_REASON_WEIGHTS[reasonKey]) {
        const factor = DEFAULT_WRONG_REASON_WEIGHTS[reasonKey];
        score = Math.round(score * factor);
        const reasonName = reasonKey === "unknown" ? "盲区" : reasonKey === "trap" ? "陷阱" : "粗心";
        reasons.push(`错因[${reasonName}]加权×${factor}`);
      }

      // 临考动态压缩加权：距考越近，高频错题紧迫度进一步放大
      if (daysLeft <= 7) {
        score += 15;
      }

      scoredList.push({
        question: q,
        score,
        reasons,
        isStubborn: stubborn,
        wrongCount: count,
      });
    } else if (filter?.includeUnattempted) {
      // 从未练过的题目给予基础考前摸排分
      score = 5;
      reasons.push("考前全新题盲测");
      scoredList.push({
        question: q,
        score,
        reasons,
        isStubborn: false,
        wrongCount: 0,
      });
    }
  }

  // 按急救综合得分降序排列
  scoredList.sort((a, b) => b.score - a.score);

  return scoredList.slice(0, limit);
}

/** 考前防爆量与时间容量配额计算 */
export function calculateCramBudget(options: {
  targetMinutes?: number;
  avgSecondsPerQuestion?: number;
  candidateCount: number;
  urgencyLevel: UrgencyLevel;
  minFloor?: number;
  maxCap?: number;
}): CramBudget {
  const targetMinutes = Math.max(5, options.targetMinutes ?? 20);
  const avgSeconds = Math.max(10, options.avgSecondsPerQuestion ?? 45);
  const minFloor = options.minFloor ?? 5;
  const maxCap = options.maxCap ?? 50;

  // 根据可用分钟数预估可完成题数
  const rawCount = Math.floor((targetMinutes * 60) / avgSeconds);

  // 结合临考紧急度适当调整安全上限
  let effectiveCap = maxCap;
  if (options.urgencyLevel === "emergency") {
    effectiveCap = Math.min(maxCap, 40); // 临考前夕不宜安排过量题目，避免心态疲惫
  }

  // 严格夹取在 [minFloor, effectiveCap]
  const boundedCount = Math.max(minFloor, Math.min(effectiveCap, rawCount));
  const finalRecommended = Math.min(options.candidateCount, boundedCount);

  let rationale = `按预估单题 ${avgSeconds} 秒与目标 ${targetMinutes} 分钟测算`;
  if (options.urgencyLevel === "emergency") {
    rationale += `；考前急救模式启用防疲劳安全上限（最高 ${effectiveCap} 题）。`;
  } else {
    rationale += `；合理夹取在 ${minFloor}–${effectiveCap} 题之间。`;
  }

  return {
    targetMinutes,
    avgSecondsPerQuestion: avgSeconds,
    recommendedCount: Math.max(1, finalRecommended || minFloor),
    minFloor,
    maxCap: effectiveCap,
    rationale,
  };
}

/** 生成符合 ADR 0003 与 39-02 规范的完整考前急救冲刺规格 */
export function createCramSessionSpec(options: {
  examDate?: string | number;
  candidates: ScoredCramCandidate[];
  budget: CramBudget;
  nowMs?: number;
}): CramSessionSpec {
  const urgency = computeExamUrgency(options.examDate, options.nowMs);
  const semantics = queueSemantics("cram");
  const questions = options.candidates.map((c) => c.question);

  const receipt = `考前冲刺复习已生成（${urgency.label}）。共精选 ${questions.length} 题集中急救，严格执行 Anki reschedule-off 契约，作答流水保留，不影响内核卡包长期复习排期。`;

  return {
    mode: "cram",
    queue: "cram",
    urgency,
    questions,
    budget: options.budget,
    semantics,
    receipt,
  };
}

/**
 * 为指定错题/种子题提取考法变式题队列（同题族兄弟题优先，其次同精确考点，再次同根考点）
 */
export function extractVariantQuestions(
  allQuestions: readonly Question[],
  seed: Question,
  n = 5,
  rnd: () => number = Math.random,
): { questions: Question[]; count: number; reason: string } {
  const pool = allQuestions.filter((q) => q.id !== seed.id && q.status !== "deprecated");
  // 1. 同族变式题
  const familyKey = seed.family?.parentId || (seed.group ? `grp:${seed.group}` : "");
  const familyVariants = familyKey
    ? pool.filter((q) => (q.family?.parentId && q.family.parentId === familyKey) || (q.group && `grp:${q.group}` === familyKey))
    : [];

  // 2. 同精确考点题
  const exactKpVariants = seed.kp
    ? pool.filter((q) => q.kp === seed.kp && !familyVariants.includes(q))
    : [];

  // 3. 同大纲根考点题
  const rootKp = seed.kp ? seed.kp.split("/")[0] : "";
  const rootKpVariants = rootKp
    ? pool.filter((q) => q.kp && q.kp.split("/")[0] === rootKp && !familyVariants.includes(q) && !exactKpVariants.includes(q))
    : [];

  const out: Question[] = [];
  const drain = (arr: Question[]) => {
    const copy = [...arr];
    while (copy.length && out.length < n) {
      const idx = Math.floor(rnd() * copy.length);
      out.push(copy.splice(idx, 1)[0]);
    }
  };

  drain(familyVariants);
  drain(exactKpVariants);
  drain(rootKpVariants);

  const reason = familyVariants.length
    ? `已推荐 ${familyVariants.length} 道同族变式题${out.length > familyVariants.length ? `及 ${out.length - familyVariants.length} 道同考点巩固题` : ""}`
    : `已围绕考点【${seed.kp || "相关章节"}】推荐 ${out.length} 道典型变形题`;

  return { questions: out, count: out.length, reason };
}

/**
 * 生成考前 7 天急救小抄与核心考点速记手账 Markdown（45-08 纯文本等价物规范）
 */
export function generateCramCheatSheetMarkdown(
  questions: readonly Question[],
  wrongItems: readonly WrongItem[],
  options: { title?: string; maxItems?: number } = {},
): string {
  const title = options.title || "考前高频错题与核心考点速记小抄（急救手账）";
  const max = options.maxItems ?? 30;
  const candidates = extractCramCandidates({
    allQuestions: questions,
    wrongItems,
    filter: { limit: max, minWrongCount: 1 },
  });

  const lines: string[] = [];
  lines.push(`# 📌 ${title}`);
  lines.push(`> 导出口径：精选自 ${questions.length} 道题库题中的 **${candidates.length} 道高频错题与核心高危考点** · 建议打印双栏随身诵读复盘\n`);

  candidates.forEach((c, i) => {
    const q = c.question;
    const no = i + 1;
    lines.push(`### ${no}. 【${q.kp || "核心题"}】${q.stem.trim()}`);
    lines.push(`- **✔ 核心结论/答案**：**${q.answer.trim()}**`);
    if (q.options.length) {
      lines.push(`- 选项备忘：${q.options.map((opt, oi) => `${String.fromCharCode(65 + oi)}.${opt}`).join("  ")}`);
    }
    if (q.analysis) {
      lines.push(`- 💡 **破题手记**：${q.analysis.trim()}`);
    }
    lines.push(`- ⚡ 考前警示：累计答错 ${c.wrongCount} 次 · 紧急度评分 ${c.score} 分\n`);
  });

  return lines.join("\n");
}

/**
 * 错题考点基石母题溯源：
 * 针对学生做错的高难题或多次做错题，从题库中寻找最适合夯实基础概念的“基石母题（Foundation Question）”
 * 查找策略：
 * 1. 显式父题族母题（family.parentId 对应的题目）；
 * 2. 同精确考点（kp）中：难度星级最低、历史正确率最高、非争议的基础概念题；
 * 3. 同大纲章节（根考点）中难度最低的典型基础题。
 */
export function findFoundationMotherQuestion(
  allQuestions: readonly Question[],
  target: Question,
  attempts: readonly AttemptEvent[] = [],
): { motherQuestion: Question | null; reason: string } {
  const pool = allQuestions.filter((q) => q.id !== target.id && q.status !== "deprecated");

  // 1. 题族母题直寻
  if (target.family?.parentId) {
    const parentQ = pool.find((q) => q.id === target.family!.parentId);
    if (parentQ) {
      return {
        motherQuestion: parentQ,
        reason: `找到题族母题【${parentQ.id}】，本题为其派生变式题，建议优先掌握母题原型。`,
      };
    }
  }

  // 2. 同考点基础基石题
  const sameKpPool = target.kp ? pool.filter((q) => q.kp === target.kp && q.type !== "material") : [];
  if (sameKpPool.length > 0) {
    // 统计正确率
    const stats = new Map<string, { correct: number; total: number }>();
    for (const e of attempts) {
      if (e.verdict === "not_attempted") continue;
      const c = stats.get(e.qid) ?? { correct: 0, total: 0 };
      c.total++;
      if (e.verdict === "correct") c.correct++;
      stats.set(e.qid, c);
    }

    // 排序：难度星级升序优先（越简单越基础），其次正确率降序
    const scored = sameKpPool.map((q) => {
      const diff = q.difficulty ?? 3;
      const st = stats.get(q.id);
      const acc = st && st.total > 0 ? st.correct / st.total : 0.6;
      return { q, score: diff * 2 - acc };
    });

    scored.sort((a, b) => a.score - b.score);
    const foundation = scored[0]?.q;

    if (foundation) {
      return {
        motherQuestion: foundation,
        reason: `找到考点【${target.kp}】的基础基石概念题（难度 ★${foundation.difficulty || 1}），建议先打牢基石原理。`,
      };
    }
  }

  // 3. 根考点兜底
  const rootKp = target.kp ? target.kp.split("/")[0] : "";
  if (rootKp) {
    const rootPool = pool.filter((q) => q.kp && q.kp.split("/")[0] === rootKp && q.type !== "material");
    const foundation = rootPool.find((q) => (q.difficulty ?? 3) <= 2) || rootPool[0];
    if (foundation) {
      return {
        motherQuestion: foundation,
        reason: `找到章节【${rootKp}】的基础原理题，可用于搭桥筑基。`,
      };
    }
  }

  return {
    motherQuestion: null,
    reason: "未在当前题库中找到更基础的母题或同考点基石题。",
  };
}
