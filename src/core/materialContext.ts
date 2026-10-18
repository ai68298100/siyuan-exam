// ============================================================
// 43-03 材料组上下文模式与兄弟题导航（Material Group Context & Sibling Navigation）
// 1) 材料固定为只读上下文，切题、重载、抽题均不丢材料；材料内容绝不误当题干或答案。
// 2) 聚合共用题干母块与所有子题，计算兄弟题状态（已答对/已答错/当前/未答/未排入卷）。
// 3) 提供会话卷面一键跳转能力与已见/未见标记。
// ============================================================

import type { Question } from "./types";

export interface SiblingItem {
  qid: string;
  subIndex: number; // 1-based 组内子题序号
  stemSnippet: string;
  isCurrent: boolean;
  inSession: boolean;
  sessionCursor?: number; // 在当前会话卷面中的下标（若已在卷内）
  answered?: boolean;
  verdict?: "correct" | "wrong" | "not_attempted";
}

export interface MaterialGroupContext {
  group: string;
  materialStem: string;
  materialQid?: string;
  hasMaterial: boolean;
  totalSubs: number;
  currentSubIndex: number; // 1-based，若当前题为母块或未找到则为 0
  siblings: SiblingItem[];
}

/** 43-03 纯函数：构建当前题目的材料组上下文与兄弟题导航快照 */
export function buildMaterialGroupContext(params: {
  currentQ: Question | null | undefined;
  bankQuestions: readonly Question[];
  sessionQids?: readonly string[];
  sessionAnswered?: readonly { qid: string; pos: number; verdict: "correct" | "wrong" | "not_attempted" }[];
  currentSessionCursor?: number;
}): MaterialGroupContext | null {
  const current = params.currentQ;
  if (!current?.group) return null;

  const group = current.group;
  const sameGroup = params.bankQuestions.filter((q) => q.group === group);
  if (!sameGroup.length) return null;

  // 1. 查找材料母块
  const materialQ = sameGroup.find((q) => q.type === "material");
  const materialStem = materialQ?.stem ?? "";
  const materialQid = materialQ?.id;

  // 2. 查找子题列表（排除材料母块，按题库自然出现顺序或 ID 排序）
  const subQuestions = sameGroup.filter((q) => q.type !== "material");
  const totalSubs = subQuestions.length;

  // 3. 计算已答状态映射 (qid -> verdict)
  const answeredMap = new Map<string, "correct" | "wrong" | "not_attempted">();
  for (const a of params.sessionAnswered ?? []) {
    answeredMap.set(a.qid, a.verdict);
  }

  // 4. 会话卷面映射 (qid -> 第一个未答位置或卷面最新位置)
  const sessionPositions = new Map<string, number>();
  if (params.sessionQids) {
    params.sessionQids.forEach((qid, idx) => {
      if (!sessionPositions.has(qid)) {
        sessionPositions.set(qid, idx);
      }
    });
  }

  let currentSubIndex = 0;
  const siblings: SiblingItem[] = subQuestions.map((q, idx) => {
    const subIndex = idx + 1;
    const isCurrent = q.id === current.id;
    if (isCurrent) currentSubIndex = subIndex;

    const inSession = params.sessionQids ? params.sessionQids.includes(q.id) : true;
    const sessionCursor = sessionPositions.get(q.id);
    const verdict = answeredMap.get(q.id);
    const answered = verdict !== undefined;

    return {
      qid: q.id,
      subIndex,
      stemSnippet: q.stem.replace(/[#*`\s]/g, " ").trim().slice(0, 30),
      isCurrent,
      inSession,
      sessionCursor,
      answered,
      verdict,
    };
  });

  return {
    group,
    materialStem,
    materialQid,
    hasMaterial: materialStem.trim().length > 0,
    totalSubs,
    currentSubIndex,
    siblings,
  };
}

/** 格式化题组位置说明：如 "材料题组 (小题 2/4)" */
export function formatMaterialGroupHeader(ctx: MaterialGroupContext): string {
  if (ctx.totalSubs <= 1) return "共用材料题";
  if (ctx.currentSubIndex > 0) {
    return `材料题组（第 ${ctx.currentSubIndex}/${ctx.totalSubs} 题）`;
  }
  return `材料题组（共 ${ctx.totalSubs} 题）`;
}
