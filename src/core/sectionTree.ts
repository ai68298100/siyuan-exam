// ============================================================
// 章节树（TODO 2.2）：notebook → 文档 → 标题层级（纯函数）
// 数据源 client.docTree；题目块 hpath 天然携带标题祖先路径，
// 因此"按章节过滤题目"= hpath 前缀匹配，无需额外关联表。
// 边界：不解析标题正文层级之外的块结构；层级跳档（h1→h3）按子级挂载不丢节点。
// ============================================================

export interface DocNode {
  id: string;
  title: string;
  hpath: string;
  children: HeadingNode[];
}

export interface HeadingNode {
  id: string;
  text: string;
  hpath: string;
  level: number;
  children: HeadingNode[];
}

export interface DocRow {
  id: string;
  title: string;
  hpath: string;
}

export interface HeadingRow {
  id: string;
  text: string;
  hpath: string;
  level: number;
}

/** 标题按 level 嵌套：栈式挂载，跳档（h1 后直接 h3）视为上一层的子级 */
export function nestHeadings(headings: HeadingRow[]): HeadingNode[] {
  const roots: HeadingNode[] = [];
  const stack: HeadingNode[] = [];
  for (const h of headings) {
    const node: HeadingNode = { ...h, children: [] };
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

/** 文档 → 章节树；headings 按 hpath 前缀归属到所在文档（根文档 hpath="/" 天然匹配全部） */
export function buildSectionTree(docs: DocRow[], headings: HeadingRow[]): DocNode[] {
  const sorted = [...headings].sort((a, b) => (a.hpath < b.hpath ? -1 : a.hpath > b.hpath ? 1 : a.level - b.level));
  return docs.map((d) => ({ ...d, children: nestHeadings(sorted.filter((h) => h.hpath.startsWith(d.hpath))) }));
}

/** 章节过滤谓词：文档节点按 rootId 精确匹配；标题节点按 hpath 前缀匹配（题目块 hpath 携带标题祖先） */
export type SectionRef = { kind: "doc"; id: string; hpath: string } | { kind: "heading"; id: string; hpath: string };

export function questionInSection(q: { rootId?: string; hpath?: string }, s: SectionRef): boolean {
  if (s.kind === "doc") return q.rootId === s.id;
  const hp = q.hpath ?? "";
  return !!hp && hp.startsWith(s.hpath);
}
