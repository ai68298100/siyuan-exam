// ============================================================
// 题目修订时间线（TODO 43-01 lite，编辑入口的配套）：
// 每次 updateQuestionContent 成功后落一条修订快照（答案/考点/规格变更标记），
// 浏览详情可查看时间线并回滚到旧版答案（恢复走编辑链路 → spec 重推断同口径；
// 恢复不改历史作答）。每题上限 MAX_REVISIONS 条（FIFO），存储键 "revisions"。
// 边界：插件自记快照不等于思源块历史（宿主历史保留策略不受控）；
// 恢复答案不恢复解析/题干（lite 只覆盖判分面）。
// ============================================================

export interface QuestionRevision {
  ts: number;
  /** 该次修订后的答案（即当时生效值） */
  answer: string;
  kp?: string;
  /** 本次修订是否改变了判分规格（54 第三刀联动） */
  specChanged?: boolean;
}

export const MAX_REVISIONS = 10;
export const REVISIONS_KEY = "revisions";

export type RevisionStore = Record<string, QuestionRevision[]>;

/** 追加一条修订：FIFO 截断；与上一条完全相同（答案/考点均未变）则不重复记录 */
export function appendRevision(
  store: RevisionStore,
  qid: string,
  entry: QuestionRevision,
): RevisionStore {
  const list = store[qid] ? [...store[qid]] : [];
  const last = list[list.length - 1];
  if (last && last.answer === entry.answer && (last.kp ?? "") === (entry.kp ?? "")) return store;
  list.push(entry);
  while (list.length > MAX_REVISIONS) list.shift();
  return { ...store, [qid]: list };
}

/** 规格是否发生变化（键序无关的等价比较；双向缺失视为未变） */
export function specChanged(prev: unknown, next: unknown): boolean {
  const a = stableKey(prev);
  const b = stableKey(next);
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  return a !== b;
}

/** 规格对象 → 稳定键（键排序后序列化；非对象原样） */
function stableKey(v: unknown): string | null {
  if (v == null || typeof v !== "object") return v == null ? null : JSON.stringify(v);
  return JSON.stringify(v, Object.keys(v as Record<string, unknown>).sort());
}
