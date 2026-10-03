// ============================================================
// 下一行动（docs/21 U15 最小切片）：复盘后用户确认的持久化行动项
// 语义：actionId 持久、同 kind+qid 去重（重复点击/AI 重复建议不重建）、
//       状态机 open→done|cancelled 可回看；完成依据先记"用户确认"，
//       复测/产物级证据链接后续版本接入（见 TODO 44-05/82-04）。
// 纯函数层，持久化由 ExamApp 注入 StorageAdapter。
// ============================================================
import { newEventId } from "./ids";

export type ActionKind = "redo" | "note" | "probe" | "custom";
export type ActionStatus = "open" | "done" | "cancelled";

export interface ActionItem {
  id: string; // a-…（actionId，U15 持久标识）
  kind: ActionKind;
  qid?: string; // 关联题（custom 可空）
  sessionId?: string; // 触发来源会话/复盘
  detail: string; // 用户可见描述（如"重练：资料分析/增长率"）
  status: ActionStatus;
  createdAt: number;
  doneAt?: number;
  doneEvidence?: string; // 完成依据（当前为 user-confirmed；后续接复测 attempt/笔记块 id）
}

export const MAX_ACTIONS = 200; // FIFO 上限（含历史）

/** 同 kind+qid 只保留一条 open（去重键） */
export function dedupeKey(kind: ActionKind, qid?: string): string {
  return `${kind}:${qid ?? "-"}`;
}

/** 批量加入：已存在同键 open 行动的草稿被跳过；返回新增与跳过数（不修改原数组） */
export function appendActions(
  list: readonly ActionItem[],
  drafts: { kind: ActionKind; qid?: string; sessionId?: string; detail: string }[],
  now: number = Date.now(),
): { list: ActionItem[]; added: number; skipped: number } {
  const openKeys = new Set(list.filter((a) => a.status === "open").map((a) => dedupeKey(a.kind, a.qid)));
  const out = [...list];
  let added = 0,
    skipped = 0;
  for (const d of drafts) {
    const key = dedupeKey(d.kind, d.qid);
    if (openKeys.has(key)) {
      skipped++;
      continue;
    }
    openKeys.add(key);
    out.push({
      id: `a-${newEventId().slice(2)}`,
      kind: d.kind,
      qid: d.qid,
      sessionId: d.sessionId,
      detail: d.detail,
      status: "open",
      createdAt: now,
    });
    added++;
  }
  // FIFO：最老的已完结项先出清，open 永不清
  while (out.length > MAX_ACTIONS) {
    const idx = out.findIndex((a) => a.status !== "open");
    if (idx < 0) break;
    out.splice(idx, 1);
  }
  return { list: out, added, skipped };
}

export function openActions(list: readonly ActionItem[]): ActionItem[] {
  return list.filter((a) => a.status === "open").sort((a, b) => b.createdAt - a.createdAt);
}

/** 完成（用户确认为最小证据）；幂等：非 open 状态原样返回 */
export function completeAction(
  list: readonly ActionItem[],
  id: string,
  evidence: string,
  now: number = Date.now(),
): ActionItem[] {
  return list.map((a) =>
    a.id === id && a.status === "open" ? { ...a, status: "done" as const, doneAt: now, doneEvidence: evidence } : a,
  );
}

/** 取消/暂缓（保留记录可回看，U15）；幂等同上 */
export function cancelAction(list: readonly ActionItem[], id: string, now: number = Date.now()): ActionItem[] {
  return list.map((a) =>
    a.id === id && a.status === "open" ? { ...a, status: "cancelled" as const, doneAt: now } : a,
  );
}
