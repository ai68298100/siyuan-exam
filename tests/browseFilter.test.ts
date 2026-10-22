import { describe, it, expect } from "vitest";
import {
  matchesBrowseFilter,
  filterBrowseQuestions,
  questionMatchesKeyword,
  type BrowseQuestion,
  type BrowseFilterInput,
} from "../src/core/browseFilter";

/** 构造带运行时字段（rootId/hpath）的题目，模拟读取层合并后的形状 */
function q(over: Partial<BrowseQuestion> = {}): BrowseQuestion {
  return {
    id: "q1",
    type: "single",
    stem: "中国的首都是哪里？",
    options: ["北京", "上海", "广州", "深圳"],
    answer: "A",
    score: 1,
    origin: "import",
    batch: "b1",
    review: "verified",
    hash: "h1",
    ...over,
  } as BrowseQuestion;
}

const ids = (...v: string[]) => new Set(v);

describe("浏览过滤谓词（从 PracticeTab.filteredQuestions 抽出）", () => {
  describe("questionMatchesKeyword 关键词匹配", () => {
    it("空关键词放行一切", () => {
      expect(questionMatchesKeyword(q(), "")).toBe(true);
      expect(questionMatchesKeyword(q(), "   ")).toBe(true);
    });

    it("大小写不敏感；命中题干/选项/解析/考点/id", () => {
      const item = q({ stem: "Photosynthesis", options: ["Light"], analysis: "叶绿体", kp: "生物/光合作用" });
      expect(questionMatchesKeyword(item, "photosynth")).toBe(true);
      expect(questionMatchesKeyword(item, "LIGHT")).toBe(true);
      expect(questionMatchesKeyword(item, "叶绿体")).toBe(true);
      expect(questionMatchesKeyword(item, "光合作用")).toBe(true);
      expect(questionMatchesKeyword(item, "q1")).toBe(true);
    });

    it("未命中任何字段则排除；选项缺失时不抛错（防御性，仍可命中题干）", () => {
      expect(questionMatchesKeyword(q(), "不存在的词")).toBe(false);
      expect(() => questionMatchesKeyword(q({ options: undefined as never }), "北京")).not.toThrow();
      // 选项已缺失 → 该词不再命中（不再依赖选项），题干仍可命中
      expect(questionMatchesKeyword(q({ options: undefined as never }), "北京")).toBe(false);
      expect(questionMatchesKeyword(q({ options: undefined as never }), "首都")).toBe(true);
    });
  });

  describe("matchesBrowseFilter 单条件", () => {
    it("无任何条件时全部放行", () => {
      expect(matchesBrowseFilter(q())).toBe(true);
      expect(matchesBrowseFilter(q(), {})).toBe(true);
    });

    it("题型过滤精确匹配", () => {
      expect(matchesBrowseFilter(q({ type: "single" }), { type: "single" })).toBe(true);
      expect(matchesBrowseFilter(q({ type: "judge" }), { type: "single" })).toBe(false);
      expect(matchesBrowseFilter(q({ type: "judge" }), { type: "" })).toBe(true);
    });

    it("生命周期过滤：缺省 status 视为 published", () => {
      expect(matchesBrowseFilter(q(), { status: "published" })).toBe(true);
      expect(matchesBrowseFilter(q(), { status: "draft" })).toBe(false);
      expect(matchesBrowseFilter(q({ status: "draft" }), { status: "draft" })).toBe(true);
    });

    it("争议过滤：仅未解决争议题（resolved 不算）", () => {
      expect(matchesBrowseFilter(q(), { disputedOnly: true })).toBe(false);
      expect(matchesBrowseFilter(q({ dispute: { state: "open" } as never }), { disputedOnly: true })).toBe(true);
    });

    it("定向 id 集合：不在集合内排除；null 视为不限", () => {
      expect(matchesBrowseFilter(q({ id: "q9" }), { targetIds: ids("q9", "q2") })).toBe(true);
      expect(matchesBrowseFilter(q({ id: "q3" }), { targetIds: ids("q9") })).toBe(false);
      expect(matchesBrowseFilter(q({ id: "q3" }), { targetIds: null })).toBe(true);
    });

    it("来源过滤：@@none 表示仅无来源；精确匹配去空白", () => {
      expect(matchesBrowseFilter(q({ source: "真题" }), { source: "真题" })).toBe(true);
      expect(matchesBrowseFilter(q({ source: "真题" }), { source: "模拟" })).toBe(false);
      expect(matchesBrowseFilter(q({ source: undefined }), { source: "@@none" })).toBe(true);
      expect(matchesBrowseFilter(q({ source: "  " }), { source: "@@none" })).toBe(true);
      expect(matchesBrowseFilter(q({ source: "真题" }), { source: "@@none" })).toBe(false);
      expect(matchesBrowseFilter(q({ source: " 真题 " }), { source: "真题" })).toBe(true);
    });

    it("错题过滤依赖注入的计数查询；未提供计数视为无错题", () => {
      expect(matchesBrowseFilter(q({ id: "w1" }), { wrongOnly: true, wrongCountOf: () => 2 })).toBe(true);
      expect(matchesBrowseFilter(q({ id: "w1" }), { wrongOnly: true, wrongCountOf: () => 0 })).toBe(false);
      expect(matchesBrowseFilter(q({ id: "w1" }), { wrongOnly: true })).toBe(false); // 无查询器 → 0
    });

    it("已求助 / 近期练习集合过滤；缺失集合一律排除（不静默放行）", () => {
      expect(matchesBrowseFilter(q({ id: "h1" }), { helpedOnly: true, helped: ids("h1") })).toBe(true);
      expect(matchesBrowseFilter(q({ id: "x" }), { helpedOnly: true, helped: ids("h1") })).toBe(false);
      expect(matchesBrowseFilter(q({ id: "x" }), { helpedOnly: true, helped: null })).toBe(false);

      expect(matchesBrowseFilter(q({ id: "r1" }), { recentOnly: true, recent: ids("r1") })).toBe(true);
      expect(matchesBrowseFilter(q({ id: "x" }), { recentOnly: true, recent: null })).toBe(false);
    });

    it("章节过滤按 rootId 精确 / hpath 前缀匹配", () => {
      const section = { kind: "doc" as const, id: "d1", hpath: "/题库/卷一" };
      expect(matchesBrowseFilter(q({ rootId: "d1" }), { section })).toBe(true);
      expect(matchesBrowseFilter(q({ rootId: "d2" }), { section })).toBe(false);
      const heading = { kind: "heading" as const, id: "h1", hpath: "/题库/卷一/第一章" };
      expect(matchesBrowseFilter(q({ hpath: "/题库/卷一/第一章/节" }), { section: heading })).toBe(true);
      expect(matchesBrowseFilter(q({ hpath: "/题库/卷二" }), { section: heading })).toBe(false);
    });
  });

  describe("matchesBrowseFilter 组合与优先级", () => {
    it("多个启用条件须同时满足（AND 语义）", () => {
      const item = q({ id: "q1", type: "single", source: "真题", kp: "言语" });
      const input: BrowseFilterInput = { type: "single", source: "真题", keyword: "言语" };
      expect(matchesBrowseFilter(item, input)).toBe(true);
      expect(matchesBrowseFilter(item, { ...input, type: "judge" })).toBe(false);
      expect(matchesBrowseFilter(item, { ...input, source: "模拟" })).toBe(false);
      expect(matchesBrowseFilter(item, { ...input, keyword: "数量" })).toBe(false);
    });

    it("任一条件不满足即短路排除（章节 + 争议 + 错题叠加）", () => {
      const item = q({ rootId: "d1", dispute: { state: "open" } as never });
      const input: BrowseFilterInput = {
        section: { kind: "doc", id: "d1", hpath: "/a" },
        disputedOnly: true,
        wrongOnly: true,
        wrongCountOf: () => 3,
      };
      expect(matchesBrowseFilter(item, input)).toBe(true);
      expect(matchesBrowseFilter(item, { ...input, wrongCountOf: () => 0 })).toBe(false);
    });
  });

  describe("filterBrowseQuestions 批量", () => {
    it("保持原顺序、仅保留命中项", () => {
      const list = [
        q({ id: "a", type: "single" }),
        q({ id: "b", type: "judge" }),
        q({ id: "c", type: "single" }),
      ];
      const out = filterBrowseQuestions(list, { type: "single" });
      expect(out.map((x) => x.id)).toEqual(["a", "c"]);
    });

    it("userTag 速记标签过滤（好题/陷阱/存疑）", () => {
      const qStar = q({ id: "q-s", userTags: ["star", "key"] });
      const qTrap = q({ id: "q-t", userTags: ["trap"] });
      const qNone = q({ id: "q-n" });

      expect(matchesBrowseFilter(qStar, { userTag: "star" })).toBe(true);
      expect(matchesBrowseFilter(qTrap, { userTag: "star" })).toBe(false);
      expect(matchesBrowseFilter(qNone, { userTag: "star" })).toBe(false);
      expect(matchesBrowseFilter(qTrap, { userTag: "trap" })).toBe(true);
    });

    it("空列表与无条件过滤返回等长副本", () => {
      expect(filterBrowseQuestions([], { keyword: "x" })).toEqual([]);
      const list = [q({ id: "a" }), q({ id: "b" })];
      expect(filterBrowseQuestions(list).map((x) => x.id)).toEqual(["a", "b"]);
    });

    it("泛型保留子类型字段（blockId 等运行时字段不丢）", () => {
      const list = [q({ id: "a", blockId: "b-a" } as Partial<BrowseQuestion> & { blockId: string })];
      const out = filterBrowseQuestions(list, {});
      expect(out[0].blockId).toBe("b-a");
    });
  });
});
