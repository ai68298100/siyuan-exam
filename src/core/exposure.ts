// ============================================================
// 暴露记录（TODO 63-02 lite）：
// 记录作答前的暴露节点——讲解/提示/苏格拉底/揭示（既有 114-01 契约）+
// 先回忆揭示、材料展开、解析已见、AI 追问（本批新增节点）。
// 验收口径：只保留布尔事实（节点名），不记录未授权的全文内容；
// 取消/关闭不伪造已看（节点只在真实交互时添加，事件只在提交时落）。
// 同题多暴露用集合保全（替代单值覆盖丢失历史）；help 字段向后兼容派生。
// ============================================================

/** 暴露节点（布尔事实）：explain/socratic/hint/reveal 为既有受助契约；其余为本批新增 */
export type ExposureNode =
  | "explain"
  | "socratic"
  | "hint"
  | "reveal"
  | "analysis"
  | "followup"
  | "material";

/** 向后兼容的 help 字段派生：取最具揭示性的受助节点（explain > socratic > hint > reveal）；
 *  无受助节点 → undefined（独立作答判定不变）。 */
export function helpFromExposure(nodes: Iterable<string>): "explain" | "socratic" | "hint" | "reveal" | undefined {
  const set = new Set(nodes);
  if (set.has("explain")) return "explain";
  if (set.has("socratic")) return "socratic";
  if (set.has("hint")) return "hint";
  if (set.has("reveal")) return "reveal";
  return undefined;
}

/** 每节点全库聚合（报告用）：node 名 → 出现过的作答次数（去重按事件，非按题） */
export function exposureNodeCounts(events: readonly { exposure?: string[] }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of events) {
    if (!e.exposure) continue;
    for (const node of e.exposure) counts[node] = (counts[node] ?? 0) + 1;
  }
  return counts;
}

// ============================================================
// 65-06 lite：跨模式曝光索引——「最近看过什么」可查、可用
// ============================================================

import type { AttemptEvent } from "./types";

export interface SeenEntry {
  /** 最近一次见到的时刻 */
  lastTs: number;
  /** 见于哪些模式（practice/mock/recite…——65-06「可声明模式例外」的查询面） */
  kinds: Set<string>;
  /** 经历过的暴露节点（布尔事实） */
  nodes: Set<string>;
  /** 窗口内见到的次数 */
  count: number;
}

/** 时间窗内曝光索引：qid → SeenEntry。「作答本身」也是一次曝光（跨模式共享）。 */
export function seenIndex(
  events: readonly AttemptEvent[],
  windowMs: number,
  now: number,
): Map<string, SeenEntry> {
  const cutoff = windowMs > 0 ? now - windowMs : 0;
  const index = new Map<string, SeenEntry>();
  for (const e of events) {
    if (e.verdict === "not_attempted") continue;
    if (e.ts < cutoff) continue;
    const cur = index.get(e.qid) ?? { lastTs: 0, kinds: new Set<string>(), nodes: new Set<string>(), count: 0 };
    cur.lastTs = Math.max(cur.lastTs, e.ts);
    cur.kinds.add(e.kind);
    for (const n of e.exposure ?? []) cur.nodes.add(n);
    cur.count++;
    index.set(e.qid, cur);
  }
  return index;
}

/** 快速刷题去重：时间窗内已见过的 qid 集合（practice/mock 跨模式共享）。 */
export function recentlySeen(events: readonly AttemptEvent[], windowMs: number, now: number): Set<string> {
  return new Set(seenIndex(events, windowMs, now).keys());
}

/** 65-06 查询面（lite）：近期曝光条目倒序（最近优先），供报告面板逐题展示。
 *  kinds/nodes 为布尔事实集合；不包含任何题目内容。 */
export function recentExposureList(
  events: readonly AttemptEvent[],
  windowMs: number,
  now: number,
  limit = 30,
): { qid: string; lastTs: number; kinds: string[]; nodes: string[]; count: number }[] {
  return [...seenIndex(events, windowMs, now).entries()]
    .map(([qid, v]) => ({ qid, lastTs: v.lastTs, kinds: [...v.kinds], nodes: [...v.nodes], count: v.count }))
    .sort((a, b) => b.lastTs - a.lastTs)
    .slice(0, limit);
}
