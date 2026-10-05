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
