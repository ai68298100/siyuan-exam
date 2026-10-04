// ============================================================
// 考点关系契约（TODO 51-04，P3 可行性验证层）：包含/先修/相关/等价四类关系，
// 来源与人工确认状态随存。本批交付契约与校验纯函数（循环/失效节点/跨版本映射），
// 不做治理 UI——结论见 TODO 51-04 注记：契约先行，全量功能待真实数据源验证。
// 纯函数无 IO。
// ============================================================
import type { SyllabusNode } from "./syllabus";

export type RelationKind = "contains" | "prereq" | "related" | "equiv";
export type RelationSource = "manual" | "ai-proposal" | "syllabus";

/** 关系读法：{from, to, kind:"prereq"} = 「from 的先修是 to」（from 依赖 to）；contains = 「from 包含 to」 */
export interface KpRelation {
  from: string;
  to: string;
  kind: RelationKind;
  source: RelationSource;
  /** 人工确认状态：ai-proposal 来源必须经确认才可被下游功能引用（51-04 验收） */
  confirmed: boolean;
  createdAt: number;
}

export interface KpRelationsDoc {
  v: 1;
  relations: KpRelation[];
}

export const EMPTY_RELATIONS: KpRelationsDoc = { v: 1, relations: [] };
const MAX_RELATIONS = 1000;

const key = (r: Pick<KpRelation, "from" | "to" | "kind">) => `${r.from}\u0000${r.to}\u0000${r.kind}`;

/** 新增（同 from+to+kind 去重，后到覆盖来源/确认态）；上限 1000 */
export function addRelation(doc: KpRelationsDoc, rel: KpRelation): KpRelationsDoc {
  const from = rel.from.trim();
  const to = rel.to.trim();
  if (!from || !to) throw new Error("关系端点为空");
  if (from === to) throw new Error("关系两端相同（自环）");
  const clean: KpRelation = { ...rel, from, to };
  const others = doc.relations.filter((r) => key(r) !== key(clean));
  return { v: 1, relations: [...others, clean].slice(-MAX_RELATIONS) };
}

export function removeRelation(doc: KpRelationsDoc, rel: Pick<KpRelation, "from" | "to" | "kind">): KpRelationsDoc {
  return { v: 1, relations: doc.relations.filter((r) => key(r) !== key(rel)) };
}

export function setConfirmed(doc: KpRelationsDoc, rel: Pick<KpRelation, "from" | "to" | "kind">, confirmed: boolean): KpRelationsDoc {
  return {
    v: 1,
    relations: doc.relations.map((r) => (key(r) === key(rel) ? { ...r, confirmed } : r)),
  };
}

// ---------- 校验（P3 验收：小型大纲可验证循环、失效节点、跨版本映射） ----------

/** 先修循环检测：只看 confirmed 的 prereq 边（未确认提案不参与拓扑），DFS 找环并返回环上节点（最多列 10 个环） */
export function detectPrereqCycles(relations: readonly KpRelation[]): string[][] {
  const edges = new Map<string, string[]>();
  for (const r of relations) {
    if (r.kind !== "prereq" || !r.confirmed) continue;
    (edges.get(r.from) ?? edges.set(r.from, []).get(r.from)!).push(r.to);
  }
  const cycles: string[][] = [];
  const state = new Map<string, 1 | 2>(); // 1=在栈 2=完成
  const path: string[] = [];
  const dfs = (n: string) => {
    if (cycles.length >= 10 || state.get(n) === 2) return;
    if (state.get(n) === 1) {
      const i = path.indexOf(n);
      cycles.push([...path.slice(i)]);
      return;
    }
    state.set(n, 1);
    path.push(n);
    for (const next of edges.get(n) ?? []) dfs(next);
    path.pop();
    state.set(n, 2);
  };
  for (const n of edges.keys()) dfs(n);
  return cycles;
}

/** 失效节点：端点不在已知 kp 集合（题库实际存在/考纲在册）中的关系 */
export interface InvalidRelation {
  rel: KpRelation;
  missing: "from" | "to" | "both";
}

export function invalidEndpoints(relations: readonly KpRelation[], knownKps: ReadonlySet<string>): InvalidRelation[] {
  const out: InvalidRelation[] = [];
  for (const rel of relations) {
    const f = knownKps.has(rel.from);
    const t = knownKps.has(rel.to);
    if (!f || !t) out.push({ rel, missing: !f && !t ? "both" : !f ? "from" : "to" });
  }
  return out;
}

/** 跨版本大纲映射（按「父链/标题」全路径比对；51-04 验收的跨版本迁移验证面） */
export interface SyllabusVersionDiff {
  unchanged: string[]; // 同名同位置
  moved: string[]; // 标题在两版都有但路径变化
  added: string[];
  removed: string[];
}

function pathsOf(roots: readonly SyllabusNode[]): Map<string, string> {
  const map = new Map<string, string>(); // 标题 → 首个出现的全路径（重名取先）
  const walk = (nodes: readonly SyllabusNode[], prefix: string) => {
    for (const n of nodes) {
      const p = prefix ? `${prefix}/${n.title}` : n.title;
      if (!map.has(n.title)) map.set(n.title, p);
      walk(n.children, p);
    }
  };
  walk(roots, "");
  return map;
}

export function diffSyllabusVersions(oldRoots: readonly SyllabusNode[], newRoots: readonly SyllabusNode[]): SyllabusVersionDiff {
  const oldMap = pathsOf(oldRoots);
  const newMap = pathsOf(newRoots);
  const unchanged: string[] = [];
  const moved: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [title, newPath] of newMap) {
    const oldPath = oldMap.get(title);
    if (oldPath == null) added.push(newPath);
    else if (oldPath === newPath) unchanged.push(oldPath);
    else moved.push(`${oldPath} → ${newPath}`);
  }
  for (const [title, oldPath] of oldMap) {
    if (!newMap.has(title)) removed.push(oldPath);
  }
  return { unchanged, moved, added, removed };
}

// ---------- 序列化（petal 存储：kp/relations） ----------

const VALID_KINDS = new Set<RelationKind>(["contains", "prereq", "related", "equiv"]);
const VALID_SOURCES = new Set<RelationSource>(["manual", "ai-proposal", "syllabus"]);

export function serializeRelations(doc: KpRelationsDoc): KpRelationsDoc {
  return { v: 1, relations: doc.relations };
}

export function parseRelations(raw: unknown): { doc: KpRelationsDoc; versionTooNew: boolean } {
  if (!raw || typeof raw !== "object") return { doc: EMPTY_RELATIONS, versionTooNew: false };
  const v = (raw as { v?: number }).v;
  if (v == null) return { doc: EMPTY_RELATIONS, versionTooNew: false };
  if (v > 1) return { doc: EMPTY_RELATIONS, versionTooNew: true };
  const items = Array.isArray((raw as { relations?: unknown }).relations)
    ? ((raw as { relations: KpRelation[] }).relations.filter(
        (r) =>
          r &&
          typeof r.from === "string" &&
          typeof r.to === "string" &&
          VALID_KINDS.has(r.kind) &&
          VALID_SOURCES.has(r.source) &&
          typeof r.confirmed === "boolean",
      ))
    : [];
  return { doc: { v: 1, relations: items }, versionTooNew: false };
}
