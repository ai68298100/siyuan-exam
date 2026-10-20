// ============================================================
// 考点层级大纲树与掌握度多级穿透聚合引擎（51-01 / 39-07）
// 纯函数领域层：
// 1. 多级考点路径（"A/B/C"）解析与多叉层级大纲树自底向上构建
// 2. 掌握度指标跨层级向上穿透加权聚合（题数、尝试、独立题、覆盖率、掌握度）
// 3. 大纲节点快速子树检索、深度优先扁平化与条件剪枝
// 规则：严格无外部宿主依赖（禁 import "siyuan"），严禁类型强转。
// ============================================================

import type { AttemptEvent, Question } from "./types";

export interface KpTreeNode {
  /** 考点全局唯一完整路径（如 "资料分析/比重计算/现期比重"） */
  id: string;
  /** 当前层级节点显示名称（如 "现期比重"） */
  name: string;
  /** 完整路径，与 id 一致 */
  path: string;
  /** 层级深度（1-based，顶层根节点为 1） */
  level: number;
  /** 父节点完整路径（顶层节点为空） */
  parentPath?: string;
  /** 子节点列表 */
  children: KpTreeNode[];
  /** 直接标记在此考点上的题目数量（不含子考点） */
  selfQuestions: number;
  /** 穿透聚合：自身及所有子代考点题目的总数 */
  totalQuestions: number;
  /** 穿透聚合：作答总次数 */
  totalAttempts: number;
  /** 穿透聚合：答对总次数 */
  totalCorrect: number;
  /** 穿透聚合：独立已练题目数量（去重 qid） */
  uniqueQids: number;
  /** 穿透聚合：独立掌握题数（最近一次作答为正确） */
  independentCorrect: number;
  /** 穿透聚合：考点覆盖率（已练独立题 / 考点总题数，0-1；总题数为 0 时为 -1） */
  coverage: number;
  /** 穿透聚合：综合正确率（totalCorrect / totalAttempts，0-1；无作答时为 -1） */
  accuracy: number;
  /** 穿透聚合：综合掌握度得分（0-100 综合分值；无数据时为 0） */
  masteryScore: number;
  /** 样本置信度：独立已练题目 ≥3 时为 true */
  confident: boolean;
}

export interface KpTreeOptions {
  /** 最小题目数过滤（仅在需要排查冷门考点时使用） */
  minQuestions?: number;
  /** 是否对同级子节点按掌握度升序排列（薄弱优先） */
  weakFirst?: boolean;
}

interface RawKpAccumulator {
  id: string;
  name: string;
  path: string;
  level: number;
  parentPath?: string;
  selfQids: Set<string>;
  allQids: Set<string>;
  childPaths: Set<string>;
  attempts: number;
  corrects: number;
  uniqueAttemptQids: Set<string>;
  latestCorrectQids: Set<string>;
}

/** 规范化单条考点路径字符串（去除首尾空白与重复斜杠） */
export function normalizeKpPath(rawKp: string | null | undefined): string {
  if (!rawKp) return "";
  const parts = rawKp
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.join("/");
}

/**
 * 构建完整的考点层级多叉大纲树，并自底向上穿透聚合全部掌握度与练习指标。
 * 纯函数无 IO，支持万题级别快速内存聚合。
 */
export function buildKpTree(
  questions: readonly Question[],
  events: readonly AttemptEvent[] = [],
  options: KpTreeOptions = {},
): KpTreeNode[] {
  // 1. 建立题目所属考点全路径映射与有效题库集合
  const qidToKp = new Map<string, string>();
  for (const q of questions) {
    const cleanKp = normalizeKpPath(q.kp);
    if (cleanKp) {
      qidToKp.set(q.id, cleanKp);
    }
  }

  // 2. 收集所有出现的考点全路径以及它们的所有前缀祖先路径
  const nodeMap = new Map<string, RawKpAccumulator>();

  const getOrCreateAcc = (fullPath: string): RawKpAccumulator => {
    let acc = nodeMap.get(fullPath);
    if (!acc) {
      const parts = fullPath.split("/");
      const level = parts.length;
      const name = parts[parts.length - 1];
      const parentPath = level > 1 ? parts.slice(0, -1).join("/") : undefined;
      acc = {
        id: fullPath,
        name,
        path: fullPath,
        level,
        parentPath,
        selfQids: new Set<string>(),
        allQids: new Set<string>(),
        childPaths: new Set<string>(),
        attempts: 0,
        corrects: 0,
        uniqueAttemptQids: new Set<string>(),
        latestCorrectQids: new Set<string>(),
      };
      nodeMap.set(fullPath, acc);

      // 若有父节点，递归注册并挂载子路径关系
      if (parentPath) {
        const parentAcc = getOrCreateAcc(parentPath);
        parentAcc.childPaths.add(fullPath);
      }
    }
    return acc;
  };

  // 遍历题目，注册考点及祖先路径
  for (const q of questions) {
    const cleanKp = qidToKp.get(q.id);
    if (!cleanKp) continue;

    // 注册当前考点
    const leafAcc = getOrCreateAcc(cleanKp);
    leafAcc.selfQids.add(q.id);

    // 沿路径向上将本题 qid 累加到所有祖先的 allQids
    const parts = cleanKp.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const subPath = parts.slice(0, i).join("/");
      const subAcc = getOrCreateAcc(subPath);
      subAcc.allQids.add(q.id);
    }
  }

  // 3. 统计每道题目的最终练习状态与作答事件（按时间升序）
  const validEvents = events
    .filter((e) => e.verdict !== "not_attempted" && e.kind !== "card")
    .slice()
    .sort((a, b) => a.ts - b.ts);

  const lastVerdictByQid = new Map<string, "correct" | "wrong">();
  const attemptsByQid = new Map<string, { attempts: number; corrects: number }>();

  for (const e of validEvents) {
    if (e.verdict === "correct" || e.verdict === "wrong") {
      lastVerdictByQid.set(e.qid, e.verdict);
      const curr = attemptsByQid.get(e.qid) ?? { attempts: 0, corrects: 0 };
      curr.attempts++;
      if (e.verdict === "correct") curr.corrects++;
      attemptsByQid.set(e.qid, curr);
    }
  }

  // 4. 将每题的练习事实赋给其所在考点及其所有祖先
  for (const [qid, stat] of attemptsByQid) {
    const cleanKp = qidToKp.get(qid);
    if (!cleanKp) continue;

    const isMastered = lastVerdictByQid.get(qid) === "correct";
    const parts = cleanKp.split("/");

    for (let i = 1; i <= parts.length; i++) {
      const subPath = parts.slice(0, i).join("/");
      const subAcc = nodeMap.get(subPath);
      if (subAcc) {
        subAcc.attempts += stat.attempts;
        subAcc.corrects += stat.corrects;
        subAcc.uniqueAttemptQids.add(qid);
        if (isMastered) {
          subAcc.latestCorrectQids.add(qid);
        }
      }
    }
  }

  // 5. 递归组装成树形结构并计算各级复合掌握度
  const convertToTreeNode = (path: string): KpTreeNode => {
    const acc = nodeMap.get(path)!;
    const children: KpTreeNode[] = [];

    for (const childPath of acc.childPaths) {
      children.push(convertToTreeNode(childPath));
    }

    if (options.weakFirst) {
      children.sort((a, b) => a.masteryScore - b.masteryScore);
    } else {
      children.sort((a, b) => b.totalQuestions - a.totalQuestions);
    }

    const totalQuestions = acc.allQids.size;
    const totalAttempts = acc.attempts;
    const totalCorrect = acc.corrects;
    const uniqueQids = acc.uniqueAttemptQids.size;
    const independentCorrect = acc.latestCorrectQids.size;

    const coverage = totalQuestions > 0 ? Math.round((uniqueQids / totalQuestions) * 1000) / 1000 : -1;
    const accuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 1000) / 1000 : -1;

    // 综合掌握度计算模型（满分 100 分）：
    // 若总题数为 0 或未作答过，得分为 0；
    // 否则以 60% 独立掌握率 (independentCorrect / totalQuestions) + 40% 历史正确率 (accuracy) 综合衡量
    let masteryScore = 0;
    if (totalQuestions > 0 && uniqueQids > 0) {
      const recallRatio = independentCorrect / totalQuestions;
      const accRatio = accuracy > 0 ? accuracy : 0;
      const rawScore = (recallRatio * 0.6 + accRatio * 0.4) * 100;
      masteryScore = Math.max(0, Math.min(100, Math.round(rawScore * 10) / 10));
    }

    const confident = uniqueQids >= 3;

    const node: KpTreeNode = {
      id: acc.id,
      name: acc.name,
      path: acc.path,
      level: acc.level,
      children,
      selfQuestions: acc.selfQids.size,
      totalQuestions,
      totalAttempts,
      totalCorrect,
      uniqueQids,
      independentCorrect,
      coverage,
      accuracy,
      masteryScore,
      confident,
    };

    if (acc.parentPath) {
      node.parentPath = acc.parentPath;
    }

    return node;
  };

  // 6. 提取顶层根节点
  const rootNodes: KpTreeNode[] = [];
  for (const [path, acc] of nodeMap) {
    if (acc.level === 1) {
      const treeNode = convertToTreeNode(path);
      if (options.minQuestions && treeNode.totalQuestions < options.minQuestions) {
        continue;
      }
      rootNodes.push(treeNode);
    }
  }

  // 顶层节点排序
  if (options.weakFirst) {
    rootNodes.sort((a, b) => a.masteryScore - b.masteryScore);
  } else {
    rootNodes.sort((a, b) => b.totalQuestions - a.totalQuestions);
  }

  return rootNodes;
}

/** 深度优先查找指定考点路径对应的子树节点 */
export function findKpSubtree(roots: readonly KpTreeNode[], targetPath: string): KpTreeNode | null {
  const clean = normalizeKpPath(targetPath);
  if (!clean) return null;

  for (const root of roots) {
    if (root.path === clean) return root;
    if (clean.startsWith(root.path + "/")) {
      const found = findKpSubtree(root.children, clean);
      if (found) return found;
    }
  }
  return null;
}

/** 将考点层级树按前序深度优先遍历展开为扁平一维数组，便于在表格或选择器中渲染 */
export function flattenKpTree(
  roots: readonly KpTreeNode[],
  options: {
    maxDepth?: number;
    includeLeafOnly?: boolean;
  } = {},
): KpTreeNode[] {
  const list: KpTreeNode[] = [];

  const traverse = (node: KpTreeNode) => {
    if (options.maxDepth && node.level > options.maxDepth) {
      return;
    }

    const isLeaf = node.children.length === 0;
    if (!options.includeLeafOnly || isLeaf) {
      list.push(node);
    }

    for (const child of node.children) {
      traverse(child);
    }
  };

  for (const root of roots) {
    traverse(root);
  }

  return list;
}

/** 依照自定义谓词函数对考点树进行条件剪枝 */
export function pruneKpTree(
  roots: readonly KpTreeNode[],
  predicate: (node: KpTreeNode) => boolean,
): KpTreeNode[] {
  const out: KpTreeNode[] = [];

  for (const root of roots) {
    const keepSelf = predicate(root);
    const prunedChildren = pruneKpTree(root.children, predicate);

    // 如果自身满足条件或者其子孙中有满足条件的，则保留该节点
    if (keepSelf || prunedChildren.length > 0) {
      out.push({
        ...root,
        children: prunedChildren,
      });
    }
  }

  return out;
}
