import { describe, it, expect } from "vitest";
import { applyView, upsertView, viewBankMismatch, type SmartView } from "../src/core/smartViews";

const view = (over: Partial<SmartView> = {}): SmartView => ({
  name: "测试视图",
  v: 1,
  bankId: "b1",
  search: "",
  favOnly: false,
  section: null,
  createdAt: 1,
  ...over,
});

const qs = [
  { id: "q1", rootId: "d1", hpath: "/行测/言语/主旨", stem: "主旨题甲", options: ["选项一", "选项二"], analysis: "", fav: true },
  { id: "q2", rootId: "d1", hpath: "/行测/数量/行程", stem: "行程题乙", options: ["A"], analysis: "解析乙", fav: false },
  { id: "q3", rootId: "d2", hpath: "/申论/归纳", stem: "归纳题丙", options: [], analysis: "", fav: false },
];

describe("命名智能视图（43-05 lite，廿六批）", () => {
  it("三过滤叠加：章节（doc/heading）+ 收藏 + 搜索词，与浏览框同规则", () => {
    expect(applyView(view(), qs)).toHaveLength(3);
    expect(applyView(view({ favOnly: true }), qs).map((q) => q.id)).toEqual(["q1"]);
    expect(applyView(view({ section: { kind: "doc", id: "d1", hpath: "/行测" } }), qs).map((q) => q.id)).toEqual(["q1", "q2"]);
    expect(applyView(view({ section: { kind: "heading", id: "h1", hpath: "/行测/数量" } }), qs).map((q) => q.id)).toEqual(["q2"]);
    expect(applyView(view({ search: "解析乙" }), qs).map((q) => q.id)).toEqual(["q2"]);
    expect(applyView(view({ search: "Q1" }), qs).map((q) => q.id)).toEqual(["q1"]);
  });

  it("未知 schema 版本：不过滤（宁多勿错杀），不静默改变含义", () => {
    const old = view({ v: 99 as unknown as 1, favOnly: true });
    expect(applyView(old, qs)).toHaveLength(3);
  });

  it("章节不再命中 → 空列表而非回退全部（hpath 语义如实）", () => {
    expect(applyView(view({ section: { kind: "heading", id: "hx", hpath: "/已删除章节" } }), qs)).toHaveLength(0);
    // 无 hpath 的旧数据对 heading 过滤不误选
    expect(applyView(view({ section: { kind: "heading", id: "h1", hpath: "/行测/言语" } }), [{ ...qs[0], hpath: undefined as unknown as string }])).toHaveLength(0);
  });

  it("upsertView：同名覆盖、按创建时间倒序、上限 30", () => {
    let list = upsertView([], view({ name: "a", createdAt: 1 }));
    list = upsertView(list, view({ name: "b", createdAt: 2 }));
    list = upsertView(list, view({ name: "a", createdAt: 3 })); // 同名覆盖
    expect(list.map((v) => v.name)).toEqual(["a", "b"]);
    for (let i = 0; i < 35; i++) list = upsertView(list, view({ name: `v${i}`, createdAt: 10 + i }));
    expect(list).toHaveLength(30);
    expect(list[0].name).toBe("v34");
  });

  it("跨库视图显式提示（viewBankMismatch）", () => {
    expect(viewBankMismatch(view({ bankId: "b1" }), "b2")).toBe(true);
    expect(viewBankMismatch(view({ bankId: "b1" }), "b1")).toBe(false);
  });
});
