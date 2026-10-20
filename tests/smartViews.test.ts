import { describe, it, expect } from "vitest";
import {
  applyView,
  upsertView,
  viewBankMismatch,
  exportSmartViewsJson,
  importSmartViewsJson,
  type SmartView,
} from "../src/core/smartViews";

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

  it("43-05 强化：题型、考点前缀、错题与争议过滤叠加生效", () => {
    const questions = [
      { id: "q1", stem: "题1", options: ["A", "B"], type: "single" as const, kp: "资料/比重", sourceKind: "real" as const, dispute: { status: "pending" } },
      { id: "q2", stem: "题2", options: ["A", "B"], type: "multiple" as const, kp: "资料/增长", sourceKind: "mock" as const },
      { id: "q3", stem: "题3", options: [], type: "fill" as const, kp: "常识" },
    ];

    // 1. 题型与考点过滤
    const v1 = view({ types: ["single"], kpPrefix: "资料" });
    expect(applyView(v1, questions).map((q) => q.id)).toEqual(["q1"]);

    // 2. 错题与争议过滤
    const v2 = view({ onlyWrong: true });
    expect(applyView(v2, questions, { wrongQids: new Set(["q2"]) }).map((q) => q.id)).toEqual(["q2"]);

    const v3 = view({ onlyDisputed: true });
    expect(applyView(v3, questions).map((q) => q.id)).toEqual(["q1"]);
  });

  it("65-07 导出与导入：跨工作区 JSON 导入导出与目标题库自动适配", () => {
    const list = [view({ name: "视图A", kpPrefix: "常识", bankId: "old-bank" })];
    const json = exportSmartViewsJson(list);
    expect(json).toContain("视图A");

    // 导入到新题库
    const res = importSmartViewsJson(json, "new-bank");
    expect(res.imported).toHaveLength(1);
    expect(res.imported[0].name).toBe("视图A");
    expect(res.imported[0].bankId).toBe("new-bank");
    expect(res.imported[0].kpPrefix).toBe("常识");

    // 损坏数据容错
    expect(importSmartViewsJson("invalid-json").imported).toHaveLength(0);
  });
});
