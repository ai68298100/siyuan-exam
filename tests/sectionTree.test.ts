import { describe, it, expect } from "vitest";
import { nestHeadings, buildSectionTree, questionInSection } from "../src/core/sectionTree";

describe("章节树（TODO 2.2：notebook→doc→heading 纯函数层）", () => {
  it("nestHeadings：同级平铺、下级挂载、升序回栈", () => {
    const rows = [
      { id: "h1", text: "第一章", hpath: "/d/第一章", level: 1 },
      { id: "h2", text: "第一节", hpath: "/d/第一章/第一节", level: 2 },
      { id: "h3", text: "第二节", hpath: "/d/第一章/第二节", level: 2 },
    ];
    const tree = nestHeadings(rows);
    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((c) => c.id)).toEqual(["h2", "h3"]);
  });

  it("nestHeadings：层级跳档（h1→h3→h2）不丢节点，h2 回栈为 h1 的子级", () => {
    const tree = nestHeadings([
      { id: "a", text: "A", hpath: "/d/A", level: 1 },
      { id: "b", text: "B", hpath: "/d/A/B", level: 3 },
      { id: "c", text: "C", hpath: "/d/A/C", level: 2 },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((c) => c.id)).toEqual(["b", "c"]); // B、C 均挂 A 下（C.level < B.level → 出 B 栈）
    expect(tree[0].children[0].children).toHaveLength(0);
  });

  it("buildSectionTree：标题按 hpath 前缀归属所在文档；跨文档互不混入", () => {
    const docs = [
      { id: "d1", title: "行测", hpath: "/行测" },
      { id: "d2", title: "申论", hpath: "/申论" },
    ];
    const headings = [
      { id: "h1", text: "言语", hpath: "/行测/言语", level: 1 },
      { id: "h2", text: "归纳", hpath: "/申论/归纳", level: 1 },
    ];
    const tree = buildSectionTree(docs, headings);
    expect(tree).toHaveLength(2);
    expect(tree[0].children.map((h) => h.id)).toEqual(["h1"]);
    expect(tree[1].children.map((h) => h.id)).toEqual(["h2"]);
  });

  it("questionInSection：文档按 rootId 精确匹配；标题按 hpath 前缀匹配", () => {
    const q = { rootId: "d1", hpath: "/行测/言语/主旨题" };
    expect(questionInSection(q, { kind: "doc", id: "d1", hpath: "/行测" })).toBe(true);
    expect(questionInSection(q, { kind: "doc", id: "d2", hpath: "/申论" })).toBe(false);
    expect(questionInSection(q, { kind: "heading", id: "h1", hpath: "/行测/言语" })).toBe(true);
    expect(questionInSection(q, { kind: "heading", id: "h2", hpath: "/行测/数量" })).toBe(false);
    // 无 hpath 的旧数据（升级前索引）：标题过滤不误选
    expect(questionInSection({ rootId: "d1" }, { kind: "heading", id: "h1", hpath: "/行测/言语" })).toBe(false);
  });
});
