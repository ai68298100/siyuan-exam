// ============================================================
// 题族同源识别与练习防泄露暂缓引擎（65-03 / 52-07）
// 纯函数领域层：
// 1. 多维同源识别：题族关联、正反向卡、衍生变式与共用材料题组
// 2. 会话内兄弟题打散（disperseSiblings，保证最小题距，避免提示泄露）
// 3. 练习防泄露暂缓（burySiblings，Anki 经典防泄露策略，将后置兄弟题推迟）
// 4. CBT 材料题组优先保护（一读多题紧凑连续，变式题打散）
// 5. 契约保障：暂缓不删除题目、不修改底层 FSRS 卡包调度，模考绝不受影响
// 规则：严格无外部宿主依赖（禁 import "siyuan"），严禁类型强转。
// ============================================================

import type { Question } from "./types";

export type SiblingRelationKind = "family" | "material_group" | "explicit";

export interface SiblingRelation {
  isSibling: boolean;
  kind?: SiblingRelationKind;
  key?: string;
  reason: string;
}

export interface SiblingBuryOptions {
  /** 是否启用防泄露暂缓（默认 true） */
  enabled?: boolean;
  /** 是否保护材料题组连续性（默认 true：同一材料组题紧凑作答，不打散不暂缓） */
  preserveMaterialGroups?: boolean;
  /** 兄弟题打散时的最小间隔题数（默认 3） */
  minSpacing?: number;
  /** 模式标识：若为模考 "mock"，自动触发安全豁免，原样返回 */
  mode?: string;
}

export interface BuriedQuestionItem {
  question: Question;
  siblingOf: string;
  relationKind: SiblingRelationKind;
  reason: string;
}

export interface SiblingBuryResult {
  /** 本次练习可安全出列作答的题目队列 */
  active: Question[];
  /** 因防答案泄露而暂缓至下次会话的兄弟题目 */
  buried: BuriedQuestionItem[];
  /** 策略执行结果回执说明 */
  receipt: string;
}

/** 提取题目所归属的题族根标识（若无显式题族关联则返回 null） */
export function getQuestionFamilyKey(q: Question): string | null {
  if (q.family?.parentId && q.family.parentId.trim()) {
    return q.family.parentId.trim();
  }
  return null;
}

/** 判定两道题目是否属于同源兄弟题 */
export function areQuestionsSiblings(
  a: Question,
  b: Question,
  options: { preserveMaterialGroups?: boolean } = {},
): SiblingRelation {
  if (a.id === b.id) {
    return { isSibling: false, reason: "同一道题目本身不构成兄弟关系" };
  }

  // 1. 材料组同源判定
  if (a.group && b.group && a.group.trim() && a.group === b.group) {
    const isProtected = options.preserveMaterialGroups !== false;
    return {
      isSibling: true,
      kind: "material_group",
      key: `group:${a.group}`,
      reason: isProtected
        ? `两题同属材料题组 [${a.group}]（属于阅读理解连续作答组）`
        : `两题同属材料题组 [${a.group}]`,
    };
  }

  // 2. 题族（变式、近远迁移、正反向卡）同源判定
  const famA = getQuestionFamilyKey(a);
  const famB = getQuestionFamilyKey(b);

  if (famA && famB && famA === famB) {
    return {
      isSibling: true,
      kind: "family",
      key: `family:${famA}`,
      reason: `两题同属题族 [${famA}]（属于变式/衍生兄弟题）`,
    };
  }

  if (famA && famA === b.id) {
    return {
      isSibling: true,
      kind: "family",
      key: `family:${famA}`,
      reason: `题目 [${a.id}] 是题目 [${b.id}] 的衍生变式兄弟题`,
    };
  }

  if (famB && famB === a.id) {
    return {
      isSibling: true,
      kind: "family",
      key: `family:${famB}`,
      reason: `题目 [${b.id}] 是题目 [${a.id}] 的衍生变式兄弟题`,
    };
  }

  return { isSibling: false, reason: "无同源关联" };
}

/** 为题目生成综合兄弟特征分类键（用于快速分组归集） */
export function getSiblingClusterKey(
  q: Question,
  options: { preserveMaterialGroups?: boolean } = {},
): string | null {
  // 材料组
  if (q.group && q.group.trim()) {
    if (options.preserveMaterialGroups !== false) {
      // 开启材料保护时，材料组单独隔离，不参与常规兄弟题打散
      return `mat_protected:${q.group.trim()}`;
    }
    return `group:${q.group.trim()}`;
  }

  // 题族
  const fam = getQuestionFamilyKey(q);
  if (fam) {
    return `family:${fam}`;
  }

  // 无题族，作为孤立题
  return null;
}

/**
 * 练习防泄露暂缓（65-03 核心纯函数）。
 * 将同一练习队列中后置的兄弟题暂缓出列（Bury），推迟到后续会话或次日作答；
 * 严格保留最先出现的一题，避免因前一题选项/解析曝光而提示后一题答案。
 */
export function burySiblingsForPractice(
  questions: readonly Question[],
  options: SiblingBuryOptions = {},
): SiblingBuryResult {
  // 1. 安全豁免：若关闭暂缓开关或处于模考模式，绝对不篡改既定队列（65-03 验收标准）
  if (options.enabled === false || options.mode === "mock") {
    return {
      active: [...questions],
      buried: [],
      receipt: options.mode === "mock"
        ? "模考全真试卷触发安全豁免，保持试卷既定结构与题目顺序不变。"
        : "同源兄弟题防泄露暂缓策略已关闭，保留全量题目。",
    };
  }

  const preserveMat = options.preserveMaterialGroups !== false;

  // 预扫描：收集整批题目中声明的所有题族根 parentId
  const knownFamilyParents = new Set<string>();
  for (const q of questions) {
    const parentId = getQuestionFamilyKey(q);
    if (parentId) knownFamilyParents.add(parentId);
  }

  const resolveCluster = (q: Question): string | null => {
    // 材料组
    if (q.group && q.group.trim()) {
      if (preserveMat) {
        return `mat_protected:${q.group.trim()}`;
      }
      return `group:${q.group.trim()}`;
    }
    // 若自身是变式题，取 parentId
    const fam = getQuestionFamilyKey(q);
    if (fam) return `family:${fam}`;

    // 若自身是其他题的父题
    if (knownFamilyParents.has(q.id)) {
      return `family:${q.id}`;
    }

    return null;
  };

  const active: Question[] = [];
  const buried: BuriedQuestionItem[] = [];
  const seenClusters = new Map<string, string>(); // clusterKey -> firstQid

  for (const q of questions) {
    const cluster = resolveCluster(q);

    // 独立题或受保护的材料题组，直接放行
    if (!cluster || cluster.startsWith("mat_protected:")) {
      active.push(q);
      continue;
    }

    const firstQid = seenClusters.get(cluster);
    if (!firstQid) {
      // 该题族首道题，放入 active
      seenClusters.set(cluster, q.id);
      active.push(q);
    } else {
      // 属于后续兄弟题，执行防泄露暂缓
      const relationKind: SiblingRelationKind = cluster.startsWith("group:") ? "material_group" : "family";
      const reason = relationKind === "family"
        ? `同源题族变式暂缓：前置兄弟题 [${firstQid}] 已在本次队列中，暂缓后置变式以防答案提示`
        : `同源材料兄弟题暂缓：前置题 [${firstQid}] 已在本次队列中`;

      buried.push({
        question: q,
        siblingOf: firstQid,
        relationKind,
        reason,
      });
    }
  }

  const receipt = buried.length > 0
    ? `防答案泄露策略生效：出列 ${active.length} 题，暂缓 ${buried.length} 道同源兄弟题至下次练习（不改动长期复习排期）。`
    : `队列检查完毕：当前共 ${active.length} 题，未检测到需暂缓的同源兄弟题。`;

  return { active, buried, receipt };
}

/**
 * 会话内兄弟题打散（disperseSiblings）。
 * 在不移除任何题目的前提下重排队列，尽量使同一题族的兄弟题目间隔至少 minSpacing 道题；
 * 遇到材料组题目时保持材料组内题目紧密连续。
 */
export function disperseSiblings(
  questions: readonly Question[],
  options: SiblingBuryOptions = {},
): Question[] {
  if (questions.length <= 2) return [...questions];
  if (options.mode === "mock") return [...questions]; // 模考豁免

  const minSpacing = Math.max(1, options.minSpacing ?? 3);
  const preserveMat = options.preserveMaterialGroups !== false;

  // 预扫描：收集整批题目中声明的所有题族根 parentId
  const knownFamilyParents = new Set<string>();
  for (const q of questions) {
    const parentId = getQuestionFamilyKey(q);
    if (parentId) knownFamilyParents.add(parentId);
  }

  const resolveCluster = (q: Question): string | null => {
    const fam = getQuestionFamilyKey(q);
    if (fam) return `family:${fam}`;
    if (knownFamilyParents.has(q.id)) return `family:${q.id}`;
    return null;
  };

  // 1. 按材料组切分为块（同一材料组视为不可分割的整体块，独立题自成一块）
  type Chunk = { key: string | null; questions: Question[] };
  const chunks: Chunk[] = [];
  const matGroupMap = new Map<string, Chunk>();

  for (const q of questions) {
    if (preserveMat && q.group && q.group.trim()) {
      const gKey = q.group.trim();
      let chunk = matGroupMap.get(gKey);
      if (!chunk) {
        chunk = { key: `group:${gKey}`, questions: [] };
        matGroupMap.set(gKey, chunk);
        chunks.push(chunk);
      }
      chunk.questions.push(q);
    } else {
      const famKey = resolveCluster(q);
      chunks.push({
        key: famKey,
        questions: [q],
      });
    }
  }

  // 2. 贪心重排各块，使得相同 key 的块尽可能相隔 minSpacing 距离
  const remaining = [...chunks];
  const reordered: Chunk[] = [];
  const recentKeys: Array<string | null> = [];

  while (remaining.length > 0) {
    // 寻找一个与近期已出块 key 不冲突的候选块
    let bestIdx = -1;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      if (!cand.key) {
        // 独立无冲突块，优先或安全可用
        bestIdx = i;
        break;
      }
      // 检查 cand.key 是否在最近 minSpacing 个块中出现
      if (!recentKeys.includes(cand.key)) {
        bestIdx = i;
        break;
      }
    }

    // 若全都处于冷却期（冲突不可避免），取第一个
    if (bestIdx === -1) {
      bestIdx = 0;
    }

    const picked = remaining.splice(bestIdx, 1)[0];
    reordered.push(picked);

    if (picked.key) {
      recentKeys.push(picked.key);
      if (recentKeys.length > minSpacing) {
        recentKeys.shift();
      }
    } else {
      recentKeys.push(null);
      if (recentKeys.length > minSpacing) {
        recentKeys.shift();
      }
    }
  }

  // 3. 展开块中的题目还原为平面数组
  const flattened: Question[] = [];
  for (const c of reordered) {
    flattened.push(...c.questions);
  }

  return flattened;
}

/** 校验 Bury 契约完整性：确保不丢失任何题目，不静默丢弃 */
export function verifyBuryContract(
  original: readonly Question[],
  result: SiblingBuryResult,
): boolean {
  if (original.length !== result.active.length + result.buried.length) {
    return false;
  }
  const inputIds = new Set(original.map((q) => q.id));
  for (const a of result.active) {
    if (!inputIds.has(a.id)) return false;
  }
  for (const b of result.buried) {
    if (!inputIds.has(b.question.id)) return false;
  }
  return true;
}
