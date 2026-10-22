// ============================================================
// 考前冲刺自适应密卷装配器（122批次 / 65-08 / 53-04 / ADR 0003）
// 纯函数领域层：
// 1. 结合考点盲区雷达数据（Blindspots）与用户错题画像，一键组装针对性冲刺密卷
// 2. 弱项专项定向攻坚配比：默认 50% 严重与高危盲区题 + 30% 易混淆错题 + 20% 巩固常考题
// 3. 柔性降级与容量自动平账（题源不足时顺层级优雅补齐）
// 4. 防疲劳打散与认知波浪平滑（同考点/同题族隔离，热身开局与稳固收尾）
// 5. 契约保障：严格执行 Anki reschedule-off 语义，密卷不破坏长期卡包调度
// 规则：严格无外部宿主依赖（禁 import "siyuan"），严禁类型强转。
// ============================================================

import type { Question, QuestionType, WrongItem, AttemptEvent } from "./types";
import type { BlindspotItem } from "./readinessRadar";
import type { Blueprint, BlueprintSection } from "./mock";
import { isQuestionDisputed } from "./dispute";
import { getQuestionFamilyKey } from "./siblingBury";

export type SprintQuestionTier =
  | "critical_blindspot"
  | "confusing_wrong"
  | "reinforce_common"
  | "fallback_fill";

export interface SprintQuestionMeta {
  qid: string;
  tier: SprintQuestionTier;
  reason: string;
  score: number;
  kp: string;
  difficulty?: number;
}

export interface AdaptiveSprintPaperOptions {
  /** 期望试卷总题数（默认 20，合理范围 5 - 100） */
  paperSize?: number;
  /** 试卷自定义标题 */
  title?: string;
  /** 限定出题题型（默认不限） */
  targetTypes?: QuestionType[];
  /** 高危/预警盲区题占比（默认 0.50） */
  blindspotRatio?: number;
  /** 易混淆与高频错题占比（默认 0.30） */
  wrongRatio?: number;
  /** 巩固常考基础题占比（默认 0.20） */
  reinforceRatio?: number;
  /** 同考点或同题族题目最小间距（防疲劳打散，默认 2） */
  antiFatigueSpacing?: number;
  /** 建议作答时长（分钟，缺省根据题型与题量智能估算） */
  targetDurationMinutes?: number;
  /** 及格线百分比（默认 60） */
  passLine?: number;
  /** 每题固定分值（若不传则全卷自动平账为 100 分） */
  scorePerQuestion?: number;
  /** 伪随机数发生器（用于单测确定性重现） */
  rnd?: () => number;
}

export interface AdaptiveSprintPaperComposition {
  total: number;
  criticalBlindspots: number;
  confusingWrongs: number;
  reinforceCommon: number;
  fallbackFilled: number;
  targetedKps: string[];
}

export interface AdaptiveSprintPaper {
  id: string;
  title: string;
  generatedAt: number;
  targetDurationMinutes: number;
  totalScore: number;
  passLine: number;
  questions: Question[];
  metas: SprintQuestionMeta[];
  composition: AdaptiveSprintPaperComposition;
  diagnosisSummary: string;
  prescriptions: string[];
}

/** 提取题目的根考点（一级分类），如 "刑法/盗窃罪" -> "刑法" */
function extractRootKp(kp?: string): string {
  if (!kp || !kp.trim()) return "综合与未分类";
  const trimmed = kp.trim();
  const slashIdx = trimmed.indexOf("/");
  if (slashIdx > 0) {
    return trimmed.slice(0, slashIdx).trim();
  }
  return trimmed;
}

/** 判定题目是否属于指定盲区考点（支持考点全等或子路径匹配） */
function matchesBlindspotKp(qKp: string | undefined, bKp: string): boolean {
  if (!qKp || !bKp) return false;
  const qClean = qKp.trim().toLowerCase();
  const bClean = bKp.trim().toLowerCase();
  if (qClean === bClean) return true;
  if (qClean.startsWith(bClean + "/")) return true;
  if (bClean.startsWith(qClean + "/")) return true;
  return false;
}

/**
 * 考前冲刺自适应密卷装配器核心算法
 */
export function assembleAdaptiveSprintPaper(
  bank: readonly Question[],
  blindspots: readonly BlindspotItem[],
  wrongItems: readonly WrongItem[] = [],
  attempts: readonly AttemptEvent[] = [],
  options: AdaptiveSprintPaperOptions = {},
): AdaptiveSprintPaper {
  const rnd = options.rnd ?? Math.random;
  const now = Date.now();

  // 1. 过滤题库可用候选题目（排除废弃与未决争议题，按需过滤题型）
  const allowedTypes = options.targetTypes && options.targetTypes.length > 0
    ? new Set(options.targetTypes)
    : null;

  const validBank = bank.filter((q) => {
    if (q.status === "deprecated") return false;
    if (isQuestionDisputed(q)) return false;
    if (allowedTypes && !allowedTypes.has(q.type)) return false;
    return true;
  });

  // 若题库无可用题目，返回空密卷
  if (validBank.length === 0) {
    const paperId = `sprint-empty-${now.toString(36)}`;
    return {
      id: paperId,
      title: options.title || "考前冲刺自适应密卷（空）",
      generatedAt: now,
      targetDurationMinutes: 0,
      totalScore: 0,
      passLine: options.passLine ?? 60,
      questions: [],
      metas: [],
      composition: {
        total: 0,
        criticalBlindspots: 0,
        confusingWrongs: 0,
        reinforceCommon: 0,
        fallbackFilled: 0,
        targetedKps: [],
      },
      diagnosisSummary: "当前题库中暂无可用的有效冲刺题目（请检查题目状态或题型筛选）。",
      prescriptions: ["请先导入或启用有效题目后再装配冲刺试卷。"],
    };
  }

  // 2. 确定试卷容量（夹取在 5 到 100 题之间，且不超过题库实际可用总数）
  const requestedSize = Math.max(5, Math.min(100, Math.floor(options.paperSize ?? 20)));
  const finalSize = Math.min(requestedSize, validBank.length);

  // 3. 归一化配比权重
  const rawBInit = Math.max(0, options.blindspotRatio ?? 0.50);
  const rawWInit = Math.max(0, options.wrongRatio ?? 0.30);
  const rawRInit = Math.max(0, options.reinforceRatio ?? 0.20);
  const sumRatio = rawBInit + rawWInit + rawRInit;
  const rawB = sumRatio <= 0 ? 0.5 : rawBInit / sumRatio;
  const rawW = sumRatio <= 0 ? 0.3 : rawWInit / sumRatio;

  const quotaBlindspot = Math.round(finalSize * rawB);
  let quotaWrong = Math.round(finalSize * rawW);
  const quotaReinforce = finalSize - quotaBlindspot - quotaWrong;

  // 避免舍入造成负数
  if (quotaReinforce < 0) {
    quotaWrong = finalSize - quotaBlindspot;
  }

  // 4. 建立索引映射
  const wrongMap = new Map<string, WrongItem>();
  for (const w of wrongItems) {
    wrongMap.set(w.qid, w);
  }

  const attemptStats = new Map<string, { total: number; correct: number }>();
  for (const a of attempts) {
    const cur = attemptStats.get(a.qid) ?? { total: 0, correct: 0 };
    cur.total++;
    if (a.verdict === "correct") cur.correct++;
    attemptStats.set(a.qid, cur);
  }

  // 提取高危与预警盲区考点
  const activeBlindspots = blindspots.filter(
    (b) => b.risk === "critical" || b.risk === "warning",
  );

  const selectedQids = new Set<string>();
  const candidatesTier1: { question: Question; priority: number; reason: string }[] = [];
  const candidatesTier2: { question: Question; priority: number; reason: string }[] = [];
  const candidatesTier3: { question: Question; priority: number; reason: string }[] = [];

  // 5. 扫描所有可用题并分流至候选池
  for (const q of validBank) {
    const w = wrongMap.get(q.id);
    const stats = attemptStats.get(q.id);

    // 检查是否命中高危或中危盲区
    const hitBlindspot = activeBlindspots.find((b) => matchesBlindspotKp(q.kp, b.kp));
    if (hitBlindspot) {
      let priority = 10;
      let reason = `针对性攻坚盲区「${hitBlindspot.kp}」`;
      if (hitBlindspot.risk === "critical") {
        priority += 20;
        reason = `高危盲区「${hitBlindspot.kp}」核心突围题`;
      }
      if (w && w.status === "active") {
        priority += 15 + Math.min(10, w.wrongCount * 2);
        reason += `（且包含历史错题记录）`;
      } else if (!stats || stats.total === 0) {
        priority += 5;
        reason += `（盲区全真未见新题）`;
      }
      candidatesTier1.push({ question: q, priority, reason });
      continue;
    }

    // 检查是否为典型易混淆/高频错题（不在上述盲区内）
    if (w && w.status === "active" && w.wrongCount >= 1) {
      let priority = w.wrongCount * 5;
      let reason = `高频错题强化（累计答错 ${w.wrongCount} 次）`;
      if (w.reason === "trap") {
        priority += 10;
        reason = `易混淆陷阱题（错因标记：陷阱题）`;
      } else if (w.reason === "unknown") {
        priority += 8;
        reason = `典型知识盲点题（错因标记：知识盲区）`;
      }
      candidatesTier2.push({ question: q, priority, reason });
      continue;
    }

    // 检查是否为巩固常考题
    if (stats && stats.total > 0 && stats.correct / stats.total >= 0.6) {
      const accPct = Math.round((stats.correct / stats.total) * 100);
      candidatesTier3.push({
        question: q,
        priority: 10 + stats.total,
        reason: `熟练考点巩固题（历史正确率 ${accPct}%）`,
      });
      continue;
    }

    // 其余作为通用练习备选
    candidatesTier3.push({
      question: q,
      priority: 5,
      reason: `常考考点均衡巩固题`,
    });
  }

  // 候选池洗牌与排序（兼顾高优先级与多样性微扰动）
  const sortPool = (pool: { question: Question; priority: number; reason: string }[]) => {
    pool.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return rnd() - 0.5;
    });
  };

  sortPool(candidatesTier1);
  sortPool(candidatesTier2);
  sortPool(candidatesTier3);

  // 6. 执行配额抽取与柔性顺位降级
  const pickedList: { question: Question; tier: SprintQuestionTier; reason: string }[] = [];

  // (1) 抽取 Tier 1（盲区攻关）
  for (const item of candidatesTier1) {
    if (pickedList.length >= quotaBlindspot) break;
    if (!selectedQids.has(item.question.id)) {
      selectedQids.add(item.question.id);
      pickedList.push({
        question: item.question,
        tier: "critical_blindspot",
        reason: item.reason,
      });
    }
  }

  // 计算 Tier 1 实际抽取数，未用完配额下沉至 Tier 2
  const actualBlindspotCount = pickedList.length;
  const deficitT1 = quotaBlindspot - actualBlindspotCount;
  quotaWrong += Math.max(0, deficitT1);

  // (2) 抽取 Tier 2（易混淆错题）
  const targetPickedAfterT2 = actualBlindspotCount + quotaWrong;
  for (const item of candidatesTier2) {
    if (pickedList.length >= targetPickedAfterT2) break;
    if (!selectedQids.has(item.question.id)) {
      selectedQids.add(item.question.id);
      pickedList.push({
        question: item.question,
        tier: "confusing_wrong",
        reason: item.reason,
      });
    }
  }

  // (3) 抽取 Tier 3（巩固常考题）
  for (const item of candidatesTier3) {
    if (pickedList.length >= finalSize) break;
    if (!selectedQids.has(item.question.id)) {
      selectedQids.add(item.question.id);
      pickedList.push({
        question: item.question,
        tier: "reinforce_common",
        reason: item.reason,
      });
    }
  }

  // (4) 兜底：若前三层仍未凑满 finalSize，从全题库剩余题中补齐
  if (pickedList.length < finalSize) {
    for (const q of validBank) {
      if (pickedList.length >= finalSize) break;
      if (!selectedQids.has(q.id)) {
        selectedQids.add(q.id);
        pickedList.push({
          question: q,
          tier: "fallback_fill",
          reason: "题库均衡容量补充题",
        });
      }
    }
  }

  // 7. 防疲劳打散与认知负荷微波浪平滑（Anti-Fatigue & Pacing）
  // 目标：将 pickedList 重新洗牌与有序穿插，使相同根考点或同题族题目间隔 >= spacing
  const minSpacing = Math.max(1, options.antiFatigueSpacing ?? 2);
  const smoothedList = smoothQuestionsForPacing(pickedList, minSpacing);

  // 8. 计算分值平账与作答时长估算
  const questionCount = smoothedList.length;
  const fixedScore = options.scorePerQuestion;
  const metas: SprintQuestionMeta[] = [];
  let totalScore = 0;

  if (fixedScore && fixedScore > 0) {
    // 使用用户指定固定分值
    for (const item of smoothedList) {
      totalScore += fixedScore;
      metas.push({
        qid: item.question.id,
        tier: item.tier,
        reason: item.reason,
        score: fixedScore,
        kp: item.question.kp || "综合考点",
        difficulty: item.question.difficulty,
      });
    }
  } else {
    // 自动平账为 100 分
    const baseScore = Math.floor(100 / Math.max(1, questionCount));
    let remainder = 100 - baseScore * questionCount;

    for (const item of smoothedList) {
      const s = baseScore + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      totalScore += s;
      metas.push({
        qid: item.question.id,
        tier: item.tier,
        reason: item.reason,
        score: s,
        kp: item.question.kp || "综合考点",
        difficulty: item.question.difficulty,
      });
    }
  }

  // 估算作答时长（单选 1.2 分钟，多选/材料 2.0 分钟，其他 1.5 分钟）
  let estimatedDurationMinutes = options.targetDurationMinutes;
  if (!estimatedDurationMinutes || estimatedDurationMinutes <= 0) {
    let rawSecs = 0;
    for (const item of smoothedList) {
      const t = item.question.type;
      if (t === "single" || t === "judge") rawSecs += 70;
      else if (t === "multiple") rawSecs += 120;
      else if (t === "fill" || t === "short") rawSecs += 100;
      else rawSecs += 90;
    }
    estimatedDurationMinutes = Math.max(10, Math.ceil(rawSecs / 60));
  }

  // 9. 统计成分构成与覆盖考点
  let countCritical = 0;
  let countWrong = 0;
  let countReinforce = 0;
  let countFallback = 0;
  const targetedKpsSet = new Set<string>();

  for (const item of smoothedList) {
    if (item.tier === "critical_blindspot") countCritical++;
    else if (item.tier === "confusing_wrong") countWrong++;
    else if (item.tier === "reinforce_common") countReinforce++;
    else if (item.tier === "fallback_fill") countFallback++;

    if (item.question.kp) {
      targetedKpsSet.add(extractRootKp(item.question.kp));
    }
  }

  // 生成导读摘要与处方提示
  const targetedKps = Array.from(targetedKpsSet);
  const passLine = options.passLine ?? 60;
  const paperTitle = options.title || `考前冲刺自适应密卷 (${new Date(now).toLocaleDateString()})`;

  const diagnosisSummary = `本套冲刺密卷共装配 ${questionCount} 道精选题目，总分 ${totalScore} 分（及格线 ${passLine}%）。针对当前备考画像定向混编：重点突围高危盲区 ${countCritical} 题，强化高频错题 ${countWrong} 题，巩固常考点 ${countReinforce} 题${countFallback > 0 ? `，容量平账 ${countFallback} 题` : ""}。覆盖核心知识板块：${targetedKps.slice(0, 4).join("、") || "综合题库"}。`;

  const prescriptions: string[] = [
    `【专注攻坚】本卷包含 ${countCritical} 道深度盲区题，作答时遇生疏考点请先结合题干逻辑推导，交卷后深研解析。`,
    `【避坑防误】包含 ${countWrong} 道高频错题与易混淆题，注意审题辨析陷阱关键词。`,
    `【考场模拟】建议在 ${estimatedDurationMinutes} 分钟内闭卷沉浸作答，达成 ${passLine} 分及格目标。`,
  ];

  return {
    id: `sprint-paper-${now.toString(36)}-${Math.floor(rnd() * 1000).toString(36)}`,
    title: paperTitle,
    generatedAt: now,
    targetDurationMinutes: estimatedDurationMinutes,
    totalScore,
    passLine,
    questions: smoothedList.map((item) => item.question),
    metas,
    composition: {
      total: questionCount,
      criticalBlindspots: countCritical,
      confusingWrongs: countWrong,
      reinforceCommon: countReinforce,
      fallbackFilled: countFallback,
      targetedKps,
    },
    diagnosisSummary,
    prescriptions,
  };
}

/**
 * 认知波浪与防疲劳打散算法：
 * 1. 尝试错开相邻相同根考点（Root KP）以及同一题族（Family Key）
 * 2. 平滑难度：若存在巩固题，优先取 1 道作为开局第一题以建立答题信心
 */
function smoothQuestionsForPacing<T extends { question: Question; tier: SprintQuestionTier; reason: string }>(
  items: T[],
  spacing: number,
): T[] {
  if (items.length <= 2) return [...items];

  const pool = [...items];
  const result: T[] = [];

  // 1. 首题选择：优先选一道常考巩固题（reinforce_common）或难度较低的题作为开局
  let firstIdx = pool.findIndex(
    (item) => item.tier === "reinforce_common" && (!item.question.difficulty || item.question.difficulty <= 3),
  );
  if (firstIdx < 0) {
    firstIdx = pool.findIndex((item) => item.tier === "reinforce_common");
  }
  if (firstIdx >= 0) {
    result.push(pool.splice(firstIdx, 1)[0]);
  } else {
    result.push(pool.shift()!);
  }

  // 2. 依次选择与前序 `spacing` 道题冲突最小的最佳候选
  while (pool.length > 0) {
    const recent = result.slice(-spacing);
    const recentKps = new Set(recent.map((r) => extractRootKp(r.question.kp)));
    const recentFamilies = new Set(
      recent.map((r) => getQuestionFamilyKey(r.question)).filter((k): k is string => Boolean(k)),
    );

    // 评分指标：
    // - 根考点重复：惩罚 50 分
    // - 题族重复：惩罚 100 分
    // - 题型/层级交错加分：与上一题不同 tier + 5 分
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i];
      let score = 0;

      const cKp = extractRootKp(candidate.question.kp);
      if (recentKps.has(cKp)) score -= 50;

      const cFam = getQuestionFamilyKey(candidate.question);
      if (cFam && recentFamilies.has(cFam)) score -= 100;

      const lastPicked = result[result.length - 1];
      if (lastPicked && lastPicked.tier !== candidate.tier) {
        score += 10;
      }

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    result.push(pool.splice(bestIdx, 1)[0]);
  }

  return result;
}

/**
 * 将自适应密卷无缝转为系统合规模考蓝图（Blueprint）
 */
export function convertSprintPaperToBlueprint(paper: AdaptiveSprintPaper): Blueprint {
  // 按题型将试卷拆解为对应的段落（Sections）
  const typeMap = new Map<QuestionType, { count: number; totalScore: number }>();

  for (let i = 0; i < paper.questions.length; i++) {
    const q = paper.questions[i];
    const m = paper.metas[i];
    const t = q.type;
    const cur = typeMap.get(t) ?? { count: 0, totalScore: 0 };
    cur.count++;
    cur.totalScore += m?.score ?? 1;
    typeMap.set(t, cur);
  }

  const typeNameMap: Record<QuestionType, string> = {
    single: "单选题",
    multiple: "多选题",
    judge: "判断题",
    fill: "填空题",
    short: "简答题",
    material: "材料题",
  };

  const sections: BlueprintSection[] = [];

  for (const [t, data] of typeMap.entries()) {
    const scoreEach = data.count > 0 ? Number((data.totalScore / data.count).toFixed(2)) : 1;
    sections.push({
      name: `考前攻坚 - ${typeNameMap[t] || t}`,
      count: data.count,
      scoreEach,
      source: "mixed",
      types: [t],
    });
  }

  // 若无题目，生成默认占位段
  if (sections.length === 0) {
    sections.push({
      name: "考前冲刺题目",
      count: 0,
      scoreEach: 1,
      source: "mixed",
      types: ["single"],
    });
  }

  return {
    id: paper.id,
    name: paper.title,
    durationS: paper.targetDurationMinutes * 60,
    passLine: paper.passLine,
    shuffleOptions: false,
    sectionTimed: false,
    sections,
  };
}

/**
 * 导出可打印或纯文本自测的冲刺密卷 Markdown 文档（遵循 45-08 纯文本等价物规范）
 */
export function exportSprintPaperMarkdown(
  paper: AdaptiveSprintPaper,
  options: { showAnswers?: boolean } = {},
): string {
  const showAnswers = options.showAnswers ?? false;
  const lines: string[] = [];

  lines.push(`# 📝 ${paper.title}`);
  lines.push(`> 装配时间：${new Date(paper.generatedAt).toLocaleString()} | 建议时长：**${paper.targetDurationMinutes} 分钟** | 总分：**${paper.totalScore} 分**（及格线：**${paper.passLine}%**）\n`);

  lines.push(`## 🎯 密卷装配导读与备考提示`);
  lines.push(`${paper.diagnosisSummary}\n`);

  lines.push(`### 📋 行动处方`);
  for (const p of paper.prescriptions) {
    lines.push(`- ${p}`);
  }
  lines.push("");

  lines.push(`## 🧩 试卷构成分布`);
  lines.push(`- 🔴 严重与高危盲区攻关：**${paper.composition.criticalBlindspots}** 题`);
  lines.push(`- 🟡 易混淆与高频错题强化：**${paper.composition.confusingWrongs}** 题`);
  lines.push(`- 🟢 常考与熟练考点巩固：**${paper.composition.reinforceCommon}** 题`);
  if (paper.composition.fallbackFilled > 0) {
    lines.push(`- ⚪ 题库容量均衡平账补充：**${paper.composition.fallbackFilled}** 题`);
  }
  lines.push(`- 🏷️ 覆盖考点维度：${paper.composition.targetedKps.join("、") || "综合"}\n`);

  lines.push(`---`);
  lines.push(`## ✍️ 密卷试题正文\n`);

  const kindNames: Record<string, string> = {
    single: "单选题",
    multiple: "多选题",
    judge: "判断题",
    fill: "填空题",
    short: "简答题",
    material: "材料题",
  };

  for (let i = 0; i < paper.questions.length; i++) {
    const q = paper.questions[i];
    const m = paper.metas[i];
    const seq = i + 1;
    const kind = kindNames[q.type] || q.type;

    lines.push(`### 第 ${seq} 题 [${kind}]（${m?.score ?? 1}分）`);
    lines.push(`> 考点：\`${q.kp || "未分类"}\` | 出题策略：*${m?.reason || "常规抽选"}*\n`);
    lines.push(`${q.stem.trim()}\n`);

    if (q.options && q.options.length > 0) {
      const letters = ["A", "B", "C", "D", "E", "F", "G"];
      for (let j = 0; j < q.options.length; j++) {
        lines.push(`- **${letters[j] ?? String(j + 1)}**. ${q.options[j]}`);
      }
      lines.push("");
    }

    if (showAnswers) {
      lines.push(`> **【参考答案】**：\`${q.answer}\``);
      if (q.analysis) {
        lines.push(`> **【解析】**：${q.analysis.trim()}`);
      }
      lines.push("");
    }
  }

  if (!showAnswers) {
    lines.push(`---\n`);
    lines.push(`## 🔑 参考答案与解析速查表\n`);
    lines.push(`| 题号 | 题型 | 考点 | 分值 | 答案 | 攻坚背景 |`);
    lines.push(`| :---: | :---: | :--- | :---: | :---: | :--- |`);

    for (let i = 0; i < paper.questions.length; i++) {
      const q = paper.questions[i];
      const m = paper.metas[i];
      const seq = i + 1;
      const kind = kindNames[q.type] || q.type;
      const ansClean = (q.answer || "").replace(/\|/g, "\\|");
      const kpClean = (q.kp || "未分类").replace(/\|/g, "/");
      const reasonClean = (m?.reason || "").replace(/\|/g, "/");

      lines.push(`| ${seq} | ${kind} | ${kpClean} | ${m?.score ?? 1} | \`${ansClean}\` | ${reasonClean} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * 导出密卷试题索引与诊断清单 CSV
 */
export function exportSprintPaperCsv(paper: AdaptiveSprintPaper): string {
  const headers = [
    "题号",
    "题目ID",
    "题型",
    "分值",
    "考点",
    "分层策略",
    "出题理由",
    "参考答案",
  ];
  const rows: string[] = [headers.join(",")];

  const escapeCsv = (val: string | number | undefined | null) => {
    if (val === undefined || val === null) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  for (let i = 0; i < paper.questions.length; i++) {
    const q = paper.questions[i];
    const m = paper.metas[i];
    const row = [
      escapeCsv(i + 1),
      escapeCsv(q.id),
      escapeCsv(q.type),
      escapeCsv(m?.score ?? 1),
      escapeCsv(q.kp || ""),
      escapeCsv(m?.tier || ""),
      escapeCsv(m?.reason || ""),
      escapeCsv(q.answer),
    ];
    rows.push(row.join(","));
  }

  return rows.join("\r\n");
}
