// ============================================================
// 考纲对照（TODO 51-01 lite + 51-03 前半）：粘贴考纲大纲 → 树解析 →
// 按考点（kp）前缀对照覆盖，零题缺口明示并可导出补题清单。
// 节点身份 lite=路径编码（改名即新身份——51-01 的稳定节点映射仍开放，如实标注）；
// 匹配口径：节点可带 `标题 => kp/前缀` 可选映射，缺省用标题本身作 kp 首段前缀。
// 纯函数无 IO；覆盖计数一次遍历。
// ============================================================

export interface SyllabusNode {
  id: string; // 路径编码（如 n2-3）：同层同序即同 id；改名不保身份（lite 边界）
  title: string;
  kpPrefix: string; // 覆盖匹配用（缺省=标题）
  children: SyllabusNode[];
}

export interface SyllabusMeta {
  publisher?: string; // 发行方（51-01）
  year?: string; // 考试年份
  source?: string; // 来源（用户粘贴/官方文本）
}

export interface SyllabusDoc {
  v: 1;
  meta: SyllabusMeta;
  roots: SyllabusNode[];
  importedAt: number;
}

export const EMPTY_SYLLABUS: SyllabusDoc = { v: 1, meta: {}, roots: [], importedAt: 0 };

const MAX_DEPTH = 6;
const MAX_NODES = 500;

/**
 * 考纲解析：支持
 * - Markdown 标题（# ~ ######，深度=级别）
 * - 列表/缩进行（每 2 空格 / 1 Tab / 全角空格一层；- • * 前缀剥除）
 * - 可选映射：`标题 => kp/前缀`（=> 或 ＝＞ 分隔）
 * 空行跳过；深度跳档回落到最近的父层栈（不丢节点）；上限 500 节点。
 */
export function parseSyllabus(text: string): SyllabusNode[] {
  const lines = text.split(/\r?\n/);
  const roots: SyllabusNode[] = [];
  const stack: { depth: number; node: SyllabusNode }[] = [];
  let count = 0;
  let counter = 0;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    if (count >= MAX_NODES) break;
    let depth = 0;
    let body = raw.replace(/\t/g, "  ");
    const h = body.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      depth = h[1].length - 1;
      body = h[2];
    } else {
      while (body.startsWith("  ") || body.startsWith("\u3000")) {
        depth++;
        body = body.replace(/^(\s{2}|\u3000)/, "");
      }
      body = body.replace(/^[-•*]\s+/, "");
    }
    body = body.trim();
    if (!body) continue;
    depth = Math.min(depth, MAX_DEPTH - 1);
    let title = body;
    let kpPrefix = "";
    const map = body.match(/^(.*?)\s*(?:=>|＝>)\s*(\S.*)$/);
    if (map) {
      title = map[1].trim();
      kpPrefix = map[2].trim();
    }
    if (!title) continue;
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].node : null;
    // 层级继承：未显式映射时，子节点前缀 = 父前缀 + "/" + 标题（与 kp 分层口径一致）
    const node: SyllabusNode = {
      id: `n${counter++}`,
      title,
      kpPrefix: kpPrefix || (parent ? `${parent.kpPrefix}/${title}` : title),
      children: [],
    };
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push({ depth, node });
    count++;
  }
  return roots;
}

/** 覆盖对照：kpStats = kp → { total, learned, noSource }（调用方从题目+流水一次归好；
 *  learned=该题存在无受助（help 为空）的答对记录——练一题≠掌握节点，此处只报覆盖不报能力；
 *  noSource=缺出处字段的题数（51-03 来源完整度）。
 *  分层归属唯一：子节点先按自己的前缀认领 kp，父节点只计未被子孙认领的剩余（防父子重复计数）。 */
export interface SyllabusCoverage {
  node: SyllabusNode;
  total: number;
  learned: number;
  noSource: number;
  children: SyllabusCoverage[];
  /** 本节点及子孙已认领的 kp（父层扣除用） */
  claimed: string[];
}

export interface KpStat {
  total: number;
  learned: number;
  noSource: number;
}

export function coverageTree(
  roots: SyllabusNode[],
  kpStats: Record<string, KpStat>,
): SyllabusCoverage[] {
  const build = (nodes: SyllabusNode[]): SyllabusCoverage[] =>
    nodes.map((node) => {
      const matched = Object.keys(kpStats).filter(
        (k) => k === node.kpPrefix || k.startsWith(node.kpPrefix + "/"),
      );
      const children = build(node.children);
      const claimedByChildren = new Set(children.flatMap((c) => c.claimed));
      const claimed = matched.filter((k) => !claimedByChildren.has(k));
      const total = claimed.reduce((s, k) => s + (kpStats[k]?.total ?? 0), 0);
      const learned = claimed.reduce((s, k) => s + (kpStats[k]?.learned ?? 0), 0);
      const noSource = claimed.reduce((s, k) => s + (kpStats[k]?.noSource ?? 0), 0);
      return { node, total, learned, noSource, children, claimed };
    });
  return build(roots);
}

/** 树内节点题数合计（含子孙）——父节点展示用 */
export function subtreeCount(c: SyllabusCoverage): number {
  return c.total + c.children.reduce((sum, child) => sum + subtreeCount(child), 0);
}

/** 树内节点已独立掌握合计（含子孙） */
export function subtreeLearned(c: SyllabusCoverage): number {
  return c.learned + c.children.reduce((sum, child) => sum + subtreeLearned(child), 0);
}

/** 树内节点缺来源题数合计（含子孙） */
export function subtreeNoSource(c: SyllabusCoverage): number {
  return c.noSource + c.children.reduce((sum, child) => sum + subtreeNoSource(child), 0);
}

/** 缺口清单（零题节点 + 有题零独立掌握节点）→ CSV 行（BOM 由调用方拼）；末列=来源完整度（缺来源题数） */
export function gapsToCsv(roots: SyllabusNode[], kpStats: Record<string, KpStat>): string {
  const cov = coverageTree(roots, kpStats);
  const rows: string[][] = [["大纲节点", "kp 前缀", "题目数", "已独立掌握", "缺来源"]];
  const walk = (list: SyllabusCoverage[], path: string) => {
    for (const c of list) {
      const total = subtreeCount(c);
      if (total === 0 || subtreeLearned(c) === 0) {
        rows.push([
          `${path}${c.node.title}`,
          c.node.kpPrefix,
          String(total),
          String(subtreeLearned(c)),
          String(subtreeNoSource(c)),
        ]);
      }
      walk(c.children, `${path}${c.node.title} / `);
    }
  };
  walk(cov, "");
  return rows.map((r) => r.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(",")).join("\n");
}

// ---------- 序列化（petal 存储：syllabus/tree） ----------

export function serializeSyllabus(doc: SyllabusDoc): SyllabusDoc {
  return { v: 1, meta: doc.meta, roots: doc.roots, importedAt: doc.importedAt };
}

export function parseSyllabusDoc(raw: unknown): { doc: SyllabusDoc; versionTooNew: boolean } {
  if (!raw || typeof raw !== "object") return { doc: EMPTY_SYLLABUS, versionTooNew: false };
  const v = (raw as { v?: number }).v;
  if (v == null) return { doc: EMPTY_SYLLABUS, versionTooNew: false };
  if (v > 1) return { doc: EMPTY_SYLLABUS, versionTooNew: true };
  const o = raw as { meta?: unknown; roots?: unknown; importedAt?: unknown };
  const roots = Array.isArray(o.roots)
    ? (o.roots as SyllabusNode[]).filter((n) => n && typeof n.id === "string" && typeof n.title === "string" && Array.isArray(n.children))
    : [];
  const meta = (o.meta && typeof o.meta === "object" ? o.meta : {}) as SyllabusMeta;
  return {
    doc: { v: 1, meta, roots, importedAt: typeof o.importedAt === "number" ? o.importedAt : 0 },
    versionTooNew: false,
  };
}
