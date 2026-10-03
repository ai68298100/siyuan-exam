// ============================================================
// 题库包 diff（v1.0 分享链）：按 exam-id 对比本地题库与导入题库（ADR/TODO 7.0）
// 纯函数；冲突=同一 exam-id 在两侧都有且 hash 不同 → 冲突保留用户版本
// ============================================================

export interface PkgEntry {
  id: string; // exam-id
  hash: string;
  type: string;
  stem: string; // 预览用（首行）
  kp?: string;
}

export interface PkgDiff {
  added: PkgEntry[]; // 仅导入侧
  updated: PkgEntry[]; // 两侧都有但 hash 不同（冲突：保留用户版本，导入版可选覆盖）
  removed: PkgEntry[]; // 仅本地侧（导入包未包含——提示但不自动删）
  unchanged: number;
}

export function diffBank(local: PkgEntry[], incoming: PkgEntry[]): PkgDiff {
  const localById = new Map(local.map((e) => [e.id, e]));
  const incomingById = new Map(incoming.map((e) => [e.id, e]));
  const added: PkgEntry[] = [];
  const updated: PkgEntry[] = [];
  const removed: PkgEntry[] = [];
  let unchanged = 0;
  for (const [id, inc] of incomingById) {
    const loc = localById.get(id);
    if (!loc) added.push(inc);
    else if (loc.hash !== inc.hash) updated.push(inc);
    else unchanged++;
  }
  for (const loc of local) if (!incomingById.has(loc.id)) removed.push(loc);
  return { added, updated, removed, unchanged };
}
