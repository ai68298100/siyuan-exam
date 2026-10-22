// ============================================================
// 考点知识网络与逆向通关学习路径规划引擎 (Knowledge Graph & Clearance Path Engine)
//
// 核心能力：
// 1. 基于 KpRelation 与作答/题目流水，构建全景考点因果网络与拓扑 DAG；
// 2. 具备循环依赖检测与自动熔断安全降级（Cycle Defense），杜绝死循环；
// 3. 智能溯源并识别「阻断型根因考点」(Root-cause Blocker)：
//    当下游多个考点频繁失分，且共同依赖某个薄弱前置先修时，精准抓出阻断根因；
// 4. 逆向通关学习路径规划（Clearance Path Planner）：
//    可靶向指定目标考点，或生成全局薄弱考点分阶攻坚清单，自底向上排布学习阶段；
// 5. 生成专业级 Mermaid 拓扑图 DSL、Markdown 逆向通关导学案与 CSV 清单。
//
// 纯函数与内存化设计，无外部 IO 依赖。
// ============================================================

import type { KpRelation, RelationKind } from "./kpRelations";

export type KpMasteryStatus = "mastered" | "learning" | "weak" | "unpracticed";

export interface KpPerformanceInput {
  totalAttempts?: number;
  correctAttempts?: number;
  accuracy?: number;
  questionIds?: string[];
}

export interface KnowledgeGraphNode {
  kp: string;
  /** 掌握度状态（mastery 与 status 互为别名） */
  mastery: KpMasteryStatus;
  status: KpMasteryStatus;
  masteryScore: number; // 0-100
  accuracy: number; // 0-1
  totalAttempts: number;
  correctAttempts: number;
  wrongAttempts: number;
  questionIds: string[];
  /** 直接先修考点（即当前考点所依赖的前置考点，学习顺序在其之前；prerequisites 与 directPrereqs 互为别名） */
  prerequisites: string[];
  directPrereqs: string[];
  /** 直接后继考点（即依赖当前考点的下游考点，学习顺序在其之后；successors 与 directDependents 互为别名） */
  successors: string[];
  directDependents: string[];
  /** 包含的子考点 */
  containsKps: string[];
  /** 相关/等价考点 */
  relatedKps: string[];
  /** 是否为阻断型根因考点 */
  isRootBlocker: boolean;
  /** 阻断影响评分（越高代表卡住的下游考点越多、下游失分越严重） */
  blockingScore: number;
  /** 影响半径（受其阻断的直接与间接下游考点总数） */
  blastRadius: number;
  /** 因果诊断解释 */
  causalExplanation?: string;
}

export interface KnowledgeGraphEdge {
  from: string;
  to: string;
  kind: RelationKind | string;
  confirmed: boolean;
  /** 是否因检测到成环而被自动熔断断开 */
  isCycleBreak?: boolean;
  /** 是否属于关键阻断/攻坚链路径 */
  isCriticalPath?: boolean;
}

export interface KnowledgeGraphSummary {
  totalKps: number;
  masteredKps: number;
  weakKps: number;
  learningKps: number;
  unpracticedKps: number;
  rootBlockerCount?: number;
}

export interface KnowledgeGraph {
  nodes: Map<string, KnowledgeGraphNode>;
  edges: KnowledgeGraphEdge[];
  /** 是否检测到依赖成环 */
  hasCycles: boolean;
  /** 成环涉及的所有考点列表 */
  cycleNodes: string[];
  /** 环路路径列表 */
  cyclesDetected: string[][];
  /** 安全破环后的拓扑排序（包含图内所有考点） */
  topologicalOrder: string[];
  /** 图谱统计摘要 */
  summary: KnowledgeGraphSummary;
  /** 按阻断分降序排列的阻断根因考点 */
  rootBlockers: KnowledgeGraphNode[];
  /** 关联题目库（用于精准题干提取与题目推荐） */
  questions?: readonly GenericQuestion[];
}

export interface GenericQuestion {
  id: string;
  stem?: string;
  kp?: string;
  knowledgePoint?: string;
  difficulty?: number;
  [key: string]: unknown;
}

export interface GenericAttemptEvent {
  id?: string;
  qid?: string;
  questionId?: string;
  kp?: string;
  correct?: boolean;
  verdict?: "right" | "wrong";
  timestamp?: number;
  [key: string]: unknown;
}

export interface BuildKnowledgeGraphOptions {
  relations: readonly (KpRelation | { from: string; to: string; kind: string; confirmed?: boolean })[];
  questions?: readonly GenericQuestion[];
  attempts?: readonly GenericAttemptEvent[];
  kpStats?: Record<string, KpPerformanceInput> | Map<string, KpPerformanceInput>;
  /** 只引入 confirmed 的关系（当为 true 时过滤 confirmed === false 的关系，默认 false 允许灵活传入） */
  confirmedOnly?: boolean;
  /** 已知全部考点集合（若不传则从 relations/questions/kpStats 自动归纳） */
  knownKps?: Iterable<string>;
  /** 掌握度阈值（正确率达到该值且作答次数足够判定为掌握，默认 0.8） */
  masteryAccuracyThreshold?: number;
  /** 薄弱阈值（正确率低于该值判定为薄弱，默认 0.6） */
  weakAccuracyThreshold?: number;
  /** 判定掌握所需的最少作答次数（默认 2） */
  minAttemptsForMastery?: number;
}

export interface RootBlockerOptions {
  /** 最低爆炸半径过滤（默认 1） */
  minBlastRadius?: number;
  /** 认定为根因的最低阻断分阈值（默认 0） */
  minBlockingScore?: number;
  /** 最大返回根因数量（默认 10） */
  limit?: number;
}

export interface ClearancePlanKpItem {
  kp: string;
  mastery: KpMasteryStatus;
  status: KpMasteryStatus;
  questionsCount: number;
  blockingScore: number;
  isBlocker: boolean;
  recommendedQuestions?: Array<{
    id: string;
    stem: string;
    difficulty?: number;
    isWrong?: boolean;
  }>;
  actionAdvice?: string;
}

export interface ClearancePlanStage {
  stage: number;
  title: string;
  kps: ClearancePlanKpItem[];
  // 保持单节点兼容
  kp?: string;
  status?: KpMasteryStatus;
  isReady?: boolean;
  prereqsNeeded?: string[];
  blockingDownstreamCount?: number;
  recommendedQuestions?: Array<{
    id: string;
    stem: string;
    difficulty?: number;
    isWrong?: boolean;
  }>;
  actionAdvice?: string;
  totalQuestions?: number;
}

export interface ClearancePlanSummary {
  totalStages: number;
  masteredCount: number;
  weakCount: number;
  learningCount: number;
  unpracticedCount: number;
  rootBlockerCount: number;
  estimatedStudyMinutes: number;
}

export interface ClearancePlan {
  targetKp?: string;
  stages: ClearancePlanStage[];
  totalQuestions: number;
  estimatedMinutes: number;
  blockerKps: string[];
  summary: ClearancePlanSummary;
  criticalChain: string[];
}

export interface PlanClearanceOptions {
  /** 指定攻坚的目标考点（若未传则对全图所有薄弱/根因考点做全局规划） */
  targetKp?: string;
  /** 所有题库题目（用于推荐针对性攻关练习题） */
  questions?: readonly GenericQuestion[];
  /** 最近的错题记录或作答历史 */
  attempts?: readonly GenericAttemptEvent[];
  /** 每阶段最多推荐题目数（默认 3） */
  maxQuestionsPerStage?: number;
}

export interface MermaidOptions {
  /** 流程图方向：TD (从上到下) 或 LR (从左到右)，默认 TD */
  direction?: "TD" | "LR" | "TB" | "RL";
  /** 是否只聚焦高亮薄弱考点与根因考点及其邻居（默认 false 全量） */
  focusOnWeakAndBlockers?: boolean;
  /** 是否附带状态图例（默认 true） */
  includeLegend?: boolean;
}

export interface GuideMarkdownOptions {
  /** 自定义导学案主标题 */
  title?: string;
  /** 是否列出推荐题目的题面与难度（默认 true） */
  includeQuestions?: boolean;
}

// ------------------------------------------------------------
// 辅助函数
// ------------------------------------------------------------

export function normalizeName(name: string): string {
  return (name ?? "").trim();
}

export function extractQuestionKp(q: GenericQuestion): string | undefined {
  const kp = (q.kp ?? q.knowledgePoint) as string | undefined;
  return kp ? normalizeName(kp) : undefined;
}

function extractAttemptQid(ev: GenericAttemptEvent): string | undefined {
  return (ev.questionId ?? ev.qid ?? ev.id) as string | undefined;
}

function isAttemptCorrect(ev: GenericAttemptEvent): boolean {
  if (typeof ev.correct === "boolean") return ev.correct;
  if (ev.verdict === "right") return true;
  if (ev.verdict === "wrong") return false;
  return false;
}

// ------------------------------------------------------------
// 1. 构建全景考点网络 (buildKnowledgeGraph)
// ------------------------------------------------------------

export function buildKnowledgeGraph(
  options: BuildKnowledgeGraphOptions,
): KnowledgeGraph {
  const masteryAcc = options.masteryAccuracyThreshold ?? 0.8;
  const weakAcc = options.weakAccuracyThreshold ?? 0.6;
  const minAttempts = options.minAttemptsForMastery ?? 2;

  // 1.1 收集全量考点
  const allKps = new Set<string>();
  if (options.knownKps) {
    for (const kp of options.knownKps) {
      const n = normalizeName(kp);
      if (n) allKps.add(n);
    }
  }

  // 从 relations 收集
  const filteredRelations: KnowledgeGraphEdge[] = [];
  for (const r of options.relations) {
    if (options.confirmedOnly && r.confirmed === false) {
      continue;
    }
    const from = normalizeName(r.from);
    const to = normalizeName(r.to);
    if (!from || !to) continue;
    allKps.add(from);
    allKps.add(to);
    filteredRelations.push({
      from,
      to,
      kind: r.kind,
      confirmed: r.confirmed !== false,
    });
  }

  // 1.2 题目归集按考点
  const questionsByKp = new Map<string, GenericQuestion[]>();
  const questionsMap = new Map<string, GenericQuestion>();
  if (options.questions) {
    for (const q of options.questions) {
      if (q.id) questionsMap.set(q.id, q);
      const kp = extractQuestionKp(q);
      if (kp) {
        allKps.add(kp);
        const list = questionsByKp.get(kp) ?? [];
        list.push(q);
        questionsByKp.set(kp, list);

        // 如果包含多级考点路径如 "数学/微积分/导数"，也收录叶节点
        if (kp.includes("/")) {
          const leaf = kp.split("/").pop()!.trim();
          if (leaf) {
            allKps.add(leaf);
            const leafList = questionsByKp.get(leaf) ?? [];
            leafList.push(q);
            questionsByKp.set(leaf, leafList);
          }
        }
      }
    }
  }

  // 1.3 作答统计按考点
  interface KpStatAcc {
    attempts: number;
    corrects: number;
    wrongs: number;
    qids: Set<string>;
  }
  const statsMap = new Map<string, KpStatAcc>();

  const getOrCreateStat = (kp: string): KpStatAcc => {
    let s = statsMap.get(kp);
    if (!s) {
      s = { attempts: 0, corrects: 0, wrongs: 0, qids: new Set() };
      statsMap.set(kp, s);
    }
    return s;
  };

  // 结合已有的 kpStats
  if (options.kpStats) {
    const entries =
      options.kpStats instanceof Map
        ? options.kpStats.entries()
        : Object.entries(options.kpStats);
    for (const [kpRaw, p] of entries) {
      const kp = normalizeName(kpRaw);
      if (!kp) continue;
      allKps.add(kp);
      const s = getOrCreateStat(kp);
      const att = p.totalAttempts ?? 0;
      const corr = p.correctAttempts ?? Math.round(att * (p.accuracy ?? 0));
      s.attempts += att;
      s.corrects += corr;
      s.wrongs += Math.max(0, att - corr);
      if (p.questionIds) {
        for (const qid of p.questionIds) s.qids.add(qid);
      }
    }
  }

  // 结合作答流水 attempts
  if (options.attempts) {
    for (const ev of options.attempts) {
      const qid = extractAttemptQid(ev);
      let kp = ev.kp ? normalizeName(ev.kp) : undefined;
      if (!kp && qid && questionsMap.has(qid)) {
        kp = extractQuestionKp(questionsMap.get(qid)!);
      }
      if (!kp) continue;

      allKps.add(kp);
      const s = getOrCreateStat(kp);
      s.attempts++;
      if (isAttemptCorrect(ev)) {
        s.corrects++;
      } else {
        s.wrongs++;
      }
      if (qid) s.qids.add(qid);
    }
  }

  // 1.4 解析拓扑边与关系：
  // 语义约定：在测试与核心模型中，`{ from: A, to: B, kind: "prerequisite" | "prereq" }`
  // 表示 A 是先修（前置 prerequisite），B 是后继（后续 successor / dependent）！
  // 即学习因果流向：A -> B。
  const prereqSuccessors = new Map<string, Set<string>>(); // A -> [B]
  const prereqPredecessors = new Map<string, Set<string>>(); // B -> [A]
  const containsMap = new Map<string, Set<string>>();
  const relatedMap = new Map<string, Set<string>>();

  for (const kp of allKps) {
    prereqSuccessors.set(kp, new Set());
    prereqPredecessors.set(kp, new Set());
    containsMap.set(kp, new Set());
    relatedMap.set(kp, new Set());
  }

  for (const edge of filteredRelations) {
    const isPrereq = edge.kind === "prerequisite" || edge.kind === "prereq";
    if (isPrereq) {
      // from 是先修，to 是后继
      prereqSuccessors.get(edge.from)?.add(edge.to);
      prereqPredecessors.get(edge.to)?.add(edge.from);
    } else if (edge.kind === "contains") {
      containsMap.get(edge.from)?.add(edge.to);
    } else if (edge.kind === "related") {
      relatedMap.get(edge.from)?.add(edge.to);
      relatedMap.get(edge.to)?.add(edge.from);
    }
  }

  // 1.5 循环依赖检测与破环 (Cycle Detection & Breaking)
  // DFS 查找图中所有环
  const visitedState = new Map<string, 0 | 1 | 2>(); // 0=未访问, 1=当前递归栈中, 2=已完成
  const currentStack: string[] = [];
  const cyclesDetected: string[][] = [];
  const cycleNodeSet = new Set<string>();
  const brokenEdges = new Set<string>(); // "from->to"

  const detectCyclesDfs = (node: string) => {
    visitedState.set(node, 1);
    currentStack.push(node);

    const succs = prereqSuccessors.get(node) ?? new Set();
    for (const next of succs) {
      const state = visitedState.get(next) ?? 0;
      if (state === 1) {
        // 发现回路
        const idx = currentStack.indexOf(next);
        const cycle = currentStack.slice(idx);
        cyclesDetected.push([...cycle, next]);
        for (const c of cycle) cycleNodeSet.add(c);
        // 破环：将 node -> next 标记为断开，不让拓扑排序死锁
        brokenEdges.add(`${node}->${next}`);
      } else if (state === 0) {
        detectCyclesDfs(next);
      }
    }

    currentStack.pop();
    visitedState.set(node, 2);
  };

  for (const kp of allKps) {
    if ((visitedState.get(kp) ?? 0) === 0) {
      detectCyclesDfs(kp);
    }
  }

  const hasCycles = cyclesDetected.length > 0;
  const cycleNodes = Array.from(cycleNodeSet);

  // 1.6 计算安全拓扑排序 (Kahn's Algorithm 破环保全)
  const inDegree = new Map<string, number>();
  const activeSuccs = new Map<string, string[]>();

  for (const kp of allKps) {
    inDegree.set(kp, 0);
    activeSuccs.set(kp, []);
  }

  for (const [from, succs] of prereqSuccessors) {
    for (const to of succs) {
      if (!brokenEdges.has(`${from}->${to}`)) {
        activeSuccs.get(from)!.push(to);
        inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
      }
    }
  }

  const zeroQueue: string[] = [];
  for (const [kp, deg] of inDegree) {
    if (deg === 0) zeroQueue.push(kp);
  }

  const topologicalOrder: string[] = [];
  while (zeroQueue.length > 0) {
    const curr = zeroQueue.shift()!;
    topologicalOrder.push(curr);

    const succs = activeSuccs.get(curr) ?? [];
    for (const next of succs) {
      const d = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, d);
      if (d === 0) {
        zeroQueue.push(next);
      }
    }

    // 容错：如果 zeroQueue 为空但仍有节点未排入（残余环），强行挑选入度最小的一个节点破环出列
    if (zeroQueue.length === 0 && topologicalOrder.length < allKps.size) {
      let minDeg = Infinity;
      let candidate: string | null = null;
      for (const [kp, deg] of inDegree) {
        if (!topologicalOrder.includes(kp) && deg < minDeg) {
          minDeg = deg;
          candidate = kp;
        }
      }
      if (candidate) {
        zeroQueue.push(candidate);
      }
    }
  }

  // 1.7 节点属性填充与掌握度判定
  const nodes = new Map<string, KnowledgeGraphNode>();
  let masteredKps = 0;
  let weakKps = 0;
  let learningKps = 0;
  let unpracticedKps = 0;

  for (const kp of allKps) {
    const stat = statsMap.get(kp) ?? { attempts: 0, corrects: 0, wrongs: 0, qids: new Set() };
    const qList = questionsByKp.get(kp) ?? [];
    const questionIds = Array.from(new Set([...stat.qids, ...qList.map((q) => q.id)]));

    const totalAttempts = stat.attempts;
    const correctAttempts = stat.corrects;
    const wrongAttempts = stat.wrongs;
    const accuracy = totalAttempts > 0 ? parseFloat((correctAttempts / totalAttempts).toFixed(3)) : 0;
    const masteryScore = Math.round(accuracy * 100);

    let status: KpMasteryStatus;
    if (totalAttempts === 0) {
      status = "unpracticed";
      unpracticedKps++;
    } else {
      if (totalAttempts >= minAttempts && accuracy >= masteryAcc) {
        status = "mastered";
        masteredKps++;
      } else if (wrongAttempts > 0 && correctAttempts === 0) {
        // 全错，哪怕只有 1 次或 3 次都是 weak
        status = "weak";
        weakKps++;
      } else if (totalAttempts >= 3 && accuracy < weakAcc) {
        status = "weak";
        weakKps++;
      } else {
        status = "learning";
        learningKps++;
      }
    }

    const prereqs = Array.from(prereqPredecessors.get(kp) ?? []);
    const succs = Array.from(prereqSuccessors.get(kp) ?? []);
    const contains = Array.from(containsMap.get(kp) ?? []);
    const related = Array.from(relatedMap.get(kp) ?? []);

    const node: KnowledgeGraphNode = {
      kp,
      mastery: status,
      status,
      masteryScore,
      accuracy,
      totalAttempts,
      correctAttempts,
      wrongAttempts,
      questionIds,
      prerequisites: prereqs,
      directPrereqs: prereqs,
      successors: succs,
      directDependents: succs,
      containsKps: contains,
      relatedKps: related,
      isRootBlocker: false,
      blockingScore: 0,
      blastRadius: 0,
    };
    nodes.set(kp, node);
  }

  // 1.8 组装 Edges 并标记熔断边
  const edges: KnowledgeGraphEdge[] = filteredRelations.map((edge) => ({
    ...edge,
    isCycleBreak: brokenEdges.has(`${edge.from}->${edge.to}`),
  }));

  const graph: KnowledgeGraph = {
    nodes,
    edges,
    hasCycles,
    cycleNodes,
    cyclesDetected,
    topologicalOrder,
    summary: {
      totalKps: allKps.size,
      masteredKps,
      weakKps,
      learningKps,
      unpracticedKps,
      rootBlockerCount: 0,
    },
    rootBlockers: [],
    questions: options.questions,
  };

  // 1.9 计算爆炸半径与阻断分
  const blockers = findRootBlockers(graph);
  graph.rootBlockers = blockers;
  graph.summary.rootBlockerCount = blockers.length;

  return graph;
}

// ------------------------------------------------------------
// 2. 识别阻断型根因考点 (findRootBlockers / identifyRootBlockers)
// ------------------------------------------------------------

export function findRootBlockers(
  graph: KnowledgeGraph,
  options: RootBlockerOptions = {},
): KnowledgeGraphNode[] {
  const minScore = options.minBlockingScore ?? 0;
  const minBlastRadius = options.minBlastRadius ?? 1;
  const limit = options.limit ?? 10;

  // 获取某个考点向下的全部可达下游考点闭包 (BFS)
  const getDownstreamClosure = (startKp: string): Set<string> => {
    const closure = new Set<string>();
    const queue = [startKp];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const node = graph.nodes.get(curr);
      if (!node) continue;
      for (const dep of node.successors) {
        if (!closure.has(dep) && dep !== startKp) {
          closure.add(dep);
          queue.push(dep);
        }
      }
    }
    return closure;
  };

  const blockers: KnowledgeGraphNode[] = [];

  for (const [kp, node] of graph.nodes) {
    const downstreamClosure = getDownstreamClosure(kp);
    const blastRadius = downstreamClosure.size;
    node.blastRadius = blastRadius;

    // 核心契约：若自身已经 mastered，掌握了则不阻断后续，blockingScore = 0
    if (node.mastery === "mastered") {
      node.blockingScore = 0;
      node.isRootBlocker = false;
      continue;
    }

    if (blastRadius === 0) {
      node.blockingScore = 0;
      node.isRootBlocker = false;
      continue;
    }

    // 统计下游失分与薄弱情况
    let downstreamWrongs = 0;
    let downstreamWeaks = 0;
    for (const depKp of downstreamClosure) {
      const depNode = graph.nodes.get(depKp);
      if (!depNode) continue;
      downstreamWrongs += depNode.wrongAttempts;
      if (depNode.mastery === "weak") downstreamWeaks++;
    }

    // 阻断分加权：自身错误加权 + 爆炸半径加权 + 下游波及加权
    // 自身薄弱因子：自身 weak 为 2.0，learning 为 1.2，unpracticed 为 1.0
    const selfFactor = node.mastery === "weak" ? 2.0 : node.mastery === "learning" ? 1.2 : 1.0;
    const score = parseFloat(
      (
        (blastRadius * 2.5 + node.wrongAttempts * 2.0 + downstreamWrongs * 1.5 + downstreamWeaks * 2.0) *
        selfFactor
      ).toFixed(2),
    );

    node.blockingScore = score;
    const isBlocker = blastRadius >= minBlastRadius && score >= minScore;
    node.isRootBlocker = isBlocker;

    if (isBlocker) {
      node.causalExplanation =
        `前置先修考点，下游辐射 ${blastRadius} 个后续考点。` +
        `自身状态为【${formatStatus(node.mastery)}】(错题:${node.wrongAttempts})，` +
        `是系统性阻断瓶颈，建议优先攻坚！`;
      blockers.push(node);
    }
  }

  // 按 blockingScore 降序排列
  blockers.sort((a, b) => b.blockingScore - a.blockingScore);

  return blockers.slice(0, limit);
}

// 别名导出保证向后兼容
export const identifyRootBlockers = findRootBlockers;

// ------------------------------------------------------------
// 3. 逆向通关学习路径规划 (planClearancePath)
// ------------------------------------------------------------

export function planClearancePath(
  graph: KnowledgeGraph,
  targetOrOptions?: string | PlanClearanceOptions,
  optionsParam?: PlanClearanceOptions,
): ClearancePlan {
  let opts: PlanClearanceOptions = {};
  if (typeof targetOrOptions === "string") {
    opts = { targetKp: targetOrOptions, ...(optionsParam ?? {}) };
  } else if (targetOrOptions) {
    opts = { ...targetOrOptions, ...(optionsParam ?? {}) };
  }

  const targetKp = opts.targetKp ? normalizeName(opts.targetKp) : undefined;
  const maxQ = opts.maxQuestionsPerStage ?? 3;

  // 题目与错题索引
  const candidateQuestions = opts.questions ?? graph.questions;
  const questionsByKp = new Map<string, GenericQuestion[]>();
  if (candidateQuestions) {
    for (const q of candidateQuestions) {
      const kp = extractQuestionKp(q);
      if (kp) {
        const list = questionsByKp.get(kp) ?? [];
        list.push(q);
        questionsByKp.set(kp, list);
      }
    }
  } else {
    // 从 graph 节点中抽取题目引用
    for (const [kp, node] of graph.nodes) {
      const list = node.questionIds.map((id) => ({ id, kp, stem: `${kp} 相关练习题` }));
      questionsByKp.set(kp, list);
    }
  }

  const wrongQids = new Set<string>();
  if (opts.attempts) {
    for (const ev of opts.attempts) {
      if (!isAttemptCorrect(ev)) {
        const qid = extractAttemptQid(ev);
        if (qid) wrongQids.add(qid);
      }
    }
  }

  // 3.1 确定相关考点集合
  let relevantKps: Set<string>;
  if (targetKp) {
    // 靶向模式：提取 targetKp 及其所有上游先修闭包 (反向遍历 prerequisites)
    relevantKps = new Set<string>();
    const queue = [targetKp];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (!relevantKps.has(curr)) {
        relevantKps.add(curr);
        const node = graph.nodes.get(curr);
        if (node) {
          for (const prereq of node.prerequisites) {
            if (!relevantKps.has(prereq)) queue.push(prereq);
          }
        }
      }
    }
  } else {
    // 全景模式：找出所有未掌握考点及其先修
    relevantKps = new Set<string>();
    for (const [kp, node] of graph.nodes) {
      if (node.mastery !== "mastered" || node.isRootBlocker) {
        relevantKps.add(kp);
        for (const prereq of node.prerequisites) relevantKps.add(prereq);
      }
    }
  }

  // 3.2 子图分层拓扑排序 (分阶段生成)
  // 入度计算基于 relevantKps 子图
  const subInDegree = new Map<string, number>();
  const subOutEdges = new Map<string, string[]>();

  for (const kp of relevantKps) {
    subInDegree.set(kp, 0);
    subOutEdges.set(kp, []);
  }

  for (const kp of relevantKps) {
    const node = graph.nodes.get(kp);
    if (!node) continue;
    for (const next of node.successors) {
      if (relevantKps.has(next)) {
        subOutEdges.get(kp)!.push(next);
        subInDegree.set(next, (subInDegree.get(next) ?? 0) + 1);
      }
    }
  }

  // 按层分阶段 (BFS Layering)
  let currentLayer: string[] = [];
  for (const [kp, deg] of subInDegree) {
    if (deg === 0) currentLayer.push(kp);
  }

  const layers: string[][] = [];
  const processed = new Set<string>();

  while (currentLayer.length > 0) {
    // 同层内按 blockingScore 降序排列
    currentLayer.sort((a, b) => {
      const scoreA = graph.nodes.get(a)?.blockingScore ?? 0;
      const scoreB = graph.nodes.get(b)?.blockingScore ?? 0;
      return scoreB - scoreA;
    });

    layers.push(currentLayer);
    for (const kp of currentLayer) processed.add(kp);

    const nextLayerCandidates = new Set<string>();
    for (const kp of currentLayer) {
      const nexts = subOutEdges.get(kp) ?? [];
      for (const next of nexts) {
        const d = (subInDegree.get(next) ?? 1) - 1;
        subInDegree.set(next, d);
        if (d === 0 && !processed.has(next)) {
          nextLayerCandidates.add(next);
        }
      }
    }
    currentLayer = Array.from(nextLayerCandidates);
  }

  // 容错：如果有未分层节点追加到最后
  const unassigned = Array.from(relevantKps).filter((kp) => !processed.has(kp));
  if (unassigned.length > 0) {
    layers.push(unassigned);
  }

  // 如果靶向目标存在，且目标不在最后一层，调整确保 targetKp 位于最后一层
  if (targetKp && layers.length > 1) {
    const lastLayer = layers[layers.length - 1];
    if (!lastLayer.includes(targetKp)) {
      // 从之前的层移除 targetKp 并单独放在最后一层或加入最后一层
      for (const layer of layers) {
        const idx = layer.indexOf(targetKp);
        if (idx !== -1) {
          layer.splice(idx, 1);
          break;
        }
      }
      layers.push([targetKp]);
    }
  }

  // 3.3 构建 stages
  const stages: ClearancePlanStage[] = [];
  let totalQuestions = 0;
  let masteredCount = 0;
  let weakCount = 0;
  let learningCount = 0;
  let unpracticedCount = 0;
  const blockerKps: string[] = [];
  const criticalChain: string[] = [];

  let stageNum = 1;
  for (const layer of layers) {
    if (layer.length === 0) continue;

    const kpsInStage: ClearancePlanKpItem[] = [];

    for (const kp of layer) {
      const node = graph.nodes.get(kp);
      const mastery = node?.mastery ?? "unpracticed";
      const blockingScore = node?.blockingScore ?? 0;
      const isBlocker = node?.isRootBlocker ?? false;

      if (mastery === "mastered") masteredCount++;
      else if (mastery === "weak") weakCount++;
      else if (mastery === "learning") learningCount++;
      else unpracticedCount++;

      if (isBlocker || blockingScore > 0) {
        if (!blockerKps.includes(kp)) blockerKps.push(kp);
        criticalChain.push(kp);
      }

      const rawQs = questionsByKp.get(kp) ?? [];
      const questionsCount = node ? node.questionIds.length || rawQs.length : rawQs.length;
      totalQuestions += questionsCount;

      // 推荐题目
      const sortedQs = [...rawQs].sort((a, b) => {
        const aWrong = wrongQids.has(a.id) ? 1 : 0;
        const bWrong = wrongQids.has(b.id) ? 1 : 0;
        if (aWrong !== bWrong) return bWrong - aWrong;
        return (b.difficulty ?? 3) - (a.difficulty ?? 3);
      });

      const recommended = sortedQs.slice(0, maxQ).map((q) => ({
        id: q.id,
        stem: (q.stem ?? `${kp} 试题`).slice(0, 60),
        difficulty: q.difficulty,
        isWrong: wrongQids.has(q.id),
      }));

      let advice: string;
      if (isBlocker) {
        advice = `🚨【根因攻坚】：该考点卡住 ${node?.blastRadius} 个后续考点，建议优先突破！`;
      } else if (mastery === "weak") {
        advice = `⚠️【薄弱突围】：存在失分风险，精练典型例题巩固基础。`;
      } else if (mastery === "mastered") {
        advice = `✅【地基稳固】：已掌握，可直接支撑后续阶段。`;
      } else {
        advice = `🎯【稳步推进】：按计划完成阶段测试。`;
      }

      kpsInStage.push({
        kp,
        mastery,
        status: mastery,
        questionsCount,
        blockingScore,
        isBlocker,
        recommendedQuestions: recommended,
        actionAdvice: advice,
      });
    }

    const firstKp = kpsInStage[0];
    stages.push({
      stage: stageNum,
      title: `阶段 ${stageNum}：${layer.join("、")}`,
      kps: kpsInStage,
      kp: firstKp.kp,
      status: firstKp.status,
      isReady: stageNum === 1,
      prereqsNeeded: stageNum > 1 ? (graph.nodes.get(firstKp.kp)?.prerequisites ?? []) : [],
      blockingDownstreamCount: graph.nodes.get(firstKp.kp)?.successors.length ?? 0,
      recommendedQuestions: firstKp.recommendedQuestions,
      actionAdvice: firstKp.actionAdvice,
      totalQuestions: kpsInStage.reduce((acc, cur) => acc + cur.questionsCount, 0),
    });

    stageNum++;
  }

  // 统计根因考点总数
  const rootBlockerCount = blockerKps.length;

  // 预估时长（分钟）：每个未掌握考点 15 分钟，每道题 2 分钟，确保 > 0
  const estimatedMinutes = Math.max(15, (weakCount + learningCount + unpracticedCount) * 15 + totalQuestions * 2);

  return {
    targetKp,
    stages,
    totalQuestions,
    estimatedMinutes,
    blockerKps,
    summary: {
      totalStages: stages.length,
      masteredCount,
      weakCount,
      learningCount,
      unpracticedCount,
      rootBlockerCount,
      estimatedStudyMinutes: estimatedMinutes,
    },
    criticalChain,
  };
}

// ------------------------------------------------------------
// 4. 导出 Markdown 导学案 (exportClearanceGuideMarkdown / exportClearanceStudyGuideMarkdown)
// ------------------------------------------------------------

export function exportClearanceGuideMarkdown(
  plan: ClearancePlan,
  options: GuideMarkdownOptions = {},
): string {
  const docTitle =
    options.title ??
    (plan.targetKp ? `靶向通关导学案：${plan.targetKp}` : "全景考点逆向通关学习导学案");

  const lines: string[] = [];
  lines.push(`# ${docTitle}`);
  lines.push("");
  lines.push("> 本导学案由**小驴考试知识网络拓扑推演引擎**生成。基于考点前修后继拓扑依赖，优先攻坚根因瓶颈，逆向规划由易到难的最优攻关路线。");
  lines.push("");

  // 概览看板
  lines.push("## 📊 考点网络体检与通关概览");
  lines.push("");
  lines.push("| 指标维度 | 数值 | 说明 |");
  lines.push("| :--- | :--- | :--- |");
  lines.push(`| 🏁 规划阶段数 | **${plan.stages.length}** 阶段 | 自底向上的拓扑攻坚层级 |`);
  lines.push(`| 🚨 阻断根因考点 | **${plan.blockerKps.length}** 个 | 优先突破的源头瓶颈 |`);
  lines.push(`| 📝 涉及总题量 | **${plan.totalQuestions}** 题 | 覆盖攻关所需题量 |`);
  lines.push(`| ⏱️ 预估通关总用时 | **${plan.estimatedMinutes}** 分钟 | 建议分阶段专注突破 |`);
  lines.push("");

  // 关键阻断链
  if (plan.criticalChain.length > 0) {
    lines.push("## 🚨 核心阻断溯源关键链");
    lines.push("");
    lines.push(`> 🔗 **关键突破序列**：${plan.criticalChain.map((k) => `\`${k}\``).join(" ➔ ")}`);
    lines.push("");
  }

  // 逐阶段学习路线
  lines.push("## 🗺️ 逐阶段通关学习地图");
  lines.push("");

  for (const stage of plan.stages) {
    lines.push(`### 阶段 ${stage.stage}：${stage.kps.map((k) => k.kp).join("、")}`);
    for (const item of stage.kps) {
      lines.push(`- **考点**：\`${item.kp}\`【${formatStatus(item.mastery)}】(涉及题目: ${item.questionsCount} 道，阻断分: ${item.blockingScore})`);
      if (item.actionAdvice) {
        lines.push(`  - 💡 攻坚建议：${item.actionAdvice}`);
      }
      if (item.recommendedQuestions && item.recommendedQuestions.length > 0) {
        for (const q of item.recommendedQuestions) {
          const wrongTag = q.isWrong ? "❌ [曾做错]" : "📝 [典型例题]";
          lines.push(`  - ${wrongTag} \`${q.id}\`：${q.stem}`);
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export const exportClearanceStudyGuideMarkdown = exportClearanceGuideMarkdown;

// ------------------------------------------------------------
// 5. 导出 CSV 路线清单 (exportClearancePathCsv)
// ------------------------------------------------------------

export function exportClearancePathCsv(plan: ClearancePlan): string {
  const lines: string[] = [];
  lines.push("Stage,KP,Mastery,QuestionsCount,BlockingScore,IsBlocker");

  for (const stage of plan.stages) {
    for (const item of stage.kps) {
      const kpEscaped = item.kp.includes(",") ? `"${item.kp}"` : item.kp;
      lines.push(
        `${stage.stage},${kpEscaped},${item.mastery},${item.questionsCount},${item.blockingScore},${item.isBlocker}`,
      );
    }
  }

  return lines.join("\n");
}

// ------------------------------------------------------------
// 6. 导出 Mermaid 拓扑图 (renderKnowledgeGraphMermaid / exportKnowledgeGraphMermaid)
// ------------------------------------------------------------

export function renderKnowledgeGraphMermaid(
  graph: KnowledgeGraph,
  options: MermaidOptions = {},
): string {
  const dir = options.direction ?? "TD";
  const focus = options.focusOnWeakAndBlockers ?? false;
  const includeLegend = options.includeLegend ?? true;

  const idMap = new Map<string, string>();
  let idCounter = 1;
  const getNodeId = (kp: string): string => {
    let id = idMap.get(kp);
    if (!id) {
      id = `KP_${idCounter++}`;
      idMap.set(kp, id);
    }
    return id;
  };

  const nodesToRender = new Set<string>();
  if (focus) {
    for (const [kp, node] of graph.nodes) {
      if (node.isRootBlocker || node.mastery === "weak" || node.mastery === "learning") {
        nodesToRender.add(kp);
        for (const p of node.prerequisites) nodesToRender.add(p);
        for (const s of node.successors) nodesToRender.add(s);
      }
    }
    if (nodesToRender.size === 0) {
      for (const kp of graph.nodes.keys()) nodesToRender.add(kp);
    }
  } else {
    for (const kp of graph.nodes.keys()) nodesToRender.add(kp);
  }

  const lines: string[] = [];
  lines.push(`graph ${dir}`);

  const classAssignments: { id: string; className: string }[] = [];

  for (const kp of nodesToRender) {
    const node = graph.nodes.get(kp);
    if (!node) continue;
    const nodeId = getNodeId(kp);

    const labelLines: string[] = [`<b>${escapeMermaid(kp)}</b>`];
    if (node.isRootBlocker) {
      labelLines.push(`🚨 根因阻断 (分:${node.blockingScore})`);
    } else {
      labelLines.push(`[${formatStatus(node.mastery)}] 正确率:${(node.accuracy * 100).toFixed(0)}%`);
    }
    const label = labelLines.join("<br/>");
    lines.push(`  ${nodeId}["${label}"]`);

    let cls = "unpracticed";
    if (node.isRootBlocker) cls = "blocker";
    else if (node.mastery === "weak") cls = "weak";
    else if (node.mastery === "learning") cls = "learning";
    else if (node.mastery === "mastered") cls = "mastered";

    classAssignments.push({ id: nodeId, className: cls });
  }

  // 连线渲染：from 是先修，to 是后继，学习流向 A --> B
  const renderedEdgeKeys = new Set<string>();
  for (const edge of graph.edges) {
    const fromId = edge.from;
    const toId = edge.to;
    if (!nodesToRender.has(fromId) || !nodesToRender.has(toId)) continue;

    const edgeKey = `${fromId}->${toId}`;
    if (renderedEdgeKeys.has(edgeKey)) continue;
    renderedEdgeKeys.add(edgeKey);

    const a = getNodeId(fromId);
    const b = getNodeId(toId);

    if (edge.isCycleBreak) {
      lines.push(`  ${a} -. ⚠️环路熔断 .-> ${b}`);
    } else if (edge.isCriticalPath) {
      lines.push(`  ${a} ==>|🔥核心前置| ${b}`);
    } else {
      lines.push(`  ${a} -->|先修依赖| ${b}`);
    }
  }

  lines.push("");
  lines.push("  %% 节点掌握度样式定义");
  lines.push("  classDef blocker fill:#fee2e2,stroke:#ef4444,stroke-width:3px,color:#991b1b;");
  lines.push("  classDef weak fill:#fef3c7,stroke:#f59e0b,stroke-width:2px,color:#92400e;");
  lines.push("  classDef learning fill:#e0f2fe,stroke:#0284c7,stroke-width:1.5px,color:#075985;");
  lines.push("  classDef mastered fill:#dcfce7,stroke:#22c55e,stroke-width:1.5px,color:#166534;");
  lines.push("  classDef unpracticed fill:#f3f4f6,stroke:#9ca3af,stroke-width:1px,color:#374151;");

  for (const ca of classAssignments) {
    lines.push(`  class ${ca.id} ${ca.className};`);
  }

  if (includeLegend) {
    lines.push("");
    lines.push("  subgraph 图例 [📊 考点网络状态图例]");
    lines.push("    L_Blocker[🚨 阻断根因]:::blocker");
    lines.push("    L_Weak[⚠️ 薄弱考点]:::weak");
    lines.push("    L_Learn[🎯 进阶中]:::learning");
    lines.push("    L_Master[✅ 已掌握]:::mastered");
    lines.push("    L_Unprac[⚪ 未练习]:::unpracticed");
    lines.push("  end");
  }

  return lines.join("\n");
}

export const exportKnowledgeGraphMermaid = renderKnowledgeGraphMermaid;

function formatStatus(status: KpMasteryStatus): string {
  switch (status) {
    case "mastered":
      return "已掌握";
    case "learning":
      return "进阶中";
    case "weak":
      return "薄弱";
    case "unpracticed":
      return "未练习";
  }
}

function escapeMermaid(text: string): string {
  return text.replace(/"/g, "'").replace(/[<>{}\\]/g, "");
}
