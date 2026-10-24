// ============================================================
// 靶向弱项自适应攻坚专题组卷引擎（65-08 / 51-01 / 65-03）
// 纯函数领域层：
// 1. 基于考点层级树自动甄别低掌握度薄弱考点（masteryScore < 60）
// 2. 靶向分层混合组卷：40%高频错题 + 40%题族变式迁移题 + 20%未见盲测题
// 3. 联动兄弟题防泄露打散机制（disperseSiblings），防止题面相互提示
// 4. 安全排除守卫：自动排除争议题与已归档封存题
// 规则：严格无外部宿主依赖（禁 import "siyuan"），严禁类型强转。
// ============================================================

import type { Question, WrongItem } from "./types";
import { flattenKpTree, type KpTreeNode } from "./kpTree";
import { disperseSiblings } from "./siblingBury";
import { isQuestionDisputed } from "./dispute";
import { newSessionId } from "./ids";

export interface WeakKpInfo {
  path: string;
  name: string;
  level: number;
  totalQuestions: number;
  uniqueQids: number;
  accuracy: number;
  masteryScore: number;
  confident: boolean;
}

export interface AdaptiveTargetOptions {
  /** 掌握度门槛（低于此分数认定为薄弱，默认 60） */
  maxMasteryScore?: number;
  /** 选取的最大薄弱考点数（默认 3 个） */
  topKpsCount?: number;
  /** 攻坚专题总题量（默认 15 题，夹取在 5-30 题） */
  sessionSize?: number;
  /** 变式兄弟题打散最小间隔（默认 2） */
  minSpacing?: number;
}

export interface AdaptiveTargetSession {
  sessionId: string;
  title: string;
  targetKps: WeakKpInfo[];
  questions: Question[];
  composition: {
    wrongs: number;
    variants: number;
    unattempted: number;
  };
  receipt: string;
}

/** 从考点层级树中筛选出最薄弱的叶子或细分考点 */
export function findWeakKnowledgePoints(
  roots: readonly KpTreeNode[],
  options: { maxMasteryScore?: number; topCount?: number } = {},
): WeakKpInfo[] {
  const maxScore = options.maxMasteryScore ?? 60;
  const topCount = options.topCount ?? 3;

  // 展开全树，优先考虑具有题目的叶子考点或细分节点
  const allNodes = flattenKpTree(roots ?? []);
  const candidates: WeakKpInfo[] = [];

  for (const n of allNodes) {
    if (n.totalQuestions === 0) continue;
    // 掌握度低于门槛（有作答且低于 maxScore，或完全未练但属于在册考点）
    if (n.masteryScore < maxScore || (n.uniqueQids === 0 && n.totalQuestions > 0)) {
      candidates.push({
        path: n.path,
        name: n.name,
        level: n.level,
        totalQuestions: n.totalQuestions,
        uniqueQids: n.uniqueQids,
        accuracy: n.accuracy,
        masteryScore: n.masteryScore,
        confident: n.confident,
      });
    }
  }

  // 排序准则：
  // 1. 已练过且得分最低的（最迫切攻坚）
  // 2. 完全未练过的（盲区突破）
  // 3. 层级更深（更具体细分考点，level 更大）的优先
  // 4. 包含题目数量更多的节点优先
  candidates.sort((a, b) => {
    if (a.uniqueQids > 0 && b.uniqueQids === 0) return -1;
    if (a.uniqueQids === 0 && b.uniqueQids > 0) return 1;
    if (a.masteryScore !== b.masteryScore) return a.masteryScore - b.masteryScore;
    if (b.level !== a.level) return b.level - a.level;
    return b.totalQuestions - a.totalQuestions;
  });

  return candidates.slice(0, topCount);
}

/**
 * 组装靶向弱项自适应攻坚专题（65-08 核心纯函数）。
 * 针对选定的薄弱考点，智能混合错题、题族变式与未见新题，并打散防泄露。
 */
export function assembleAdaptiveTargetSession(options: {
  allQuestions: readonly Question[];
  kpRoots: readonly KpTreeNode[];
  wrongItems: readonly WrongItem[];
  archivedQids?: ReadonlySet<string>;
  options?: AdaptiveTargetOptions;
  rnd?: () => number;
}): AdaptiveTargetSession {
  const { allQuestions, kpRoots, wrongItems, archivedQids } = options;
  const rnd = options.rnd ?? Math.random;
  const opts = options.options ?? {};
  const sessionSize = Math.max(5, Math.min(30, opts.sessionSize ?? 15));
  const minSpacing = opts.minSpacing ?? 2;

  // 1. 甄别薄弱考点
  const targetKps = findWeakKnowledgePoints(kpRoots, {
    maxMasteryScore: opts.maxMasteryScore,
    topCount: opts.topKpsCount ?? 3,
  });

  const sessionId = newSessionId();

  // 若无薄弱考点，或无题目，返回空或保底
  if (!targetKps.length || !allQuestions.length) {
    return {
      sessionId,
      title: "自适应攻坚专题（全考点掌握良好）",
      targetKps: [],
      questions: [],
      composition: { wrongs: 0, variants: 0, unattempted: 0 },
      receipt: "当前题库各考点掌握度良好，暂未发现低于警戒线的薄弱知识点。",
    };
  }

  const targetPrefixes = targetKps.map((k) => k.path);

  // 2. 收集属于目标薄弱考点的合格题目（安全排除争议题与封存归档题）
  const eligiblePool = allQuestions.filter((q) => {
    if (archivedQids?.has(q.id)) return false;
    if (isQuestionDisputed(q)) return false;
    if (!q.kp) return false;
    return targetPrefixes.some((p) => q.kp === p || q.kp?.startsWith(p + "/"));
  });

  if (!eligiblePool.length) {
    return {
      sessionId,
      title: "自适应攻坚专题（题库不足）",
      targetKps,
      questions: [],
      composition: { wrongs: 0, variants: 0, unattempted: 0 },
      receipt: "薄弱考点题目已在日常练习中封存或存在争议，暂无可用练习题目。",
    };
  }

  // 3. 构建题目分类池：错题、变式题、未练题
  const wrongQids = new Set(wrongItems.map((w) => w.qid));
  const poolWrong: Question[] = [];
  const poolVariant: Question[] = [];
  const poolUnattempted: Question[] = [];

  for (const q of eligiblePool) {
    if (wrongQids.has(q.id)) {
      poolWrong.push(q);
    } else if (q.family?.parentId) {
      // 拥有变式关系的题目
      poolVariant.push(q);
    } else {
      poolUnattempted.push(q);
    }
  }

  // 随机洗牌各池
  const shuffle = (arr: Question[]) => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  };

  const sWrongs = shuffle(poolWrong);
  const sVariants = shuffle(poolVariant);
  const sUnattempted = shuffle(poolUnattempted);

  // 4. 按 40% 错题 + 40% 变式题 + 20% 未见题配额抽取
  const targetWrongCount = Math.max(1, Math.round(sessionSize * 0.4));
  const targetVariantCount = Math.max(1, Math.round(sessionSize * 0.4));
  const targetUnattemptedCount = Math.max(1, sessionSize - targetWrongCount - targetVariantCount);

  const pickedMap = new Map<string, Question>();
  let actualWrongs = 0;
  let actualVariants = 0;
  let actualUnattempted = 0;

  // 依次从各池抽取
  const drainPool = (source: Question[], maxCount: number, counter: "w" | "v" | "u") => {
    while (source.length > 0 && pickedMap.size < sessionSize && maxCount > 0) {
      const q = source.shift()!;
      if (!pickedMap.has(q.id)) {
        pickedMap.set(q.id, q);
        maxCount--;
        if (counter === "w") actualWrongs++;
        else if (counter === "v") actualVariants++;
        else actualUnattempted++;
      }
    }
  };

  drainPool(sWrongs, targetWrongCount, "w");
  drainPool(sVariants, targetVariantCount, "v");
  drainPool(sUnattempted, targetUnattemptedCount, "u");

  // 若总数未达到 sessionSize，用剩余所有可用池补齐
  const leftover = [...sWrongs, ...sVariants, ...sUnattempted];
  while (leftover.length > 0 && pickedMap.size < sessionSize) {
    const q = leftover.shift()!;
    if (!pickedMap.has(q.id)) {
      pickedMap.set(q.id, q);
      if (wrongQids.has(q.id)) actualWrongs++;
      else if (q.family?.parentId) actualVariants++;
      else actualUnattempted++;
    }
  }

  const rawPicked = [...pickedMap.values()];

  // 5. 联动兄弟题防泄露打散（同一变式题族相隔至少 minSpacing 题）
  const finalizedQuestions = disperseSiblings(rawPicked, {
    minSpacing,
    preserveMaterialGroups: true,
  });

  const kpLabels = targetKps.map((k) => k.path).join("、");
  const title = `靶向弱项攻坚：${kpLabels}`;
  const receipt = `自适应攻坚专题已生成：聚焦薄弱考点 [${kpLabels}]，共 ${finalizedQuestions.length} 题（错题 ${actualWrongs} / 变式 ${actualVariants} / 探索 ${actualUnattempted}），已自动打散变式兄弟题。`;

  return {
    sessionId,
    title,
    targetKps,
    questions: finalizedQuestions,
    composition: {
      wrongs: actualWrongs,
      variants: actualVariants,
      unattempted: actualUnattempted,
    },
    receipt,
  };
}
