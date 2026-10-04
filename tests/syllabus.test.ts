import { describe, it, expect } from "vitest";
import {
  parseSyllabus,
  coverageTree,
  subtreeCount,
  subtreeLearned,
  gapsToCsv,
  serializeSyllabus,
  parseSyllabusDoc,
  EMPTY_SYLLABUS,
  type SyllabusNode,
} from "../src/core/syllabus";

const OUTLINE = [
  "# 第一章 资料分析 => 资料分析",
  "## 增长率",
  "## 比重",
  "# 第二章 数量关系 => 数量",
  "  - 行程问题",
  "  - 概率 => 数量/概率初步",
].join("\n");

describe("51-01/51-03 考纲解析", () => {
  it("Markdown 标题 + 列表缩进混合解析成树；=> 映射与层级前缀继承", () => {
    const roots = parseSyllabus(OUTLINE);
    expect(roots).toHaveLength(2);
    expect(roots[0].title).toBe("第一章 资料分析");
    expect(roots[0].kpPrefix).toBe("资料分析");
    expect(roots[0].children.map((c) => c.title)).toEqual(["增长率", "比重"]);
    expect(roots[0].children[0].kpPrefix).toBe("资料分析/增长率"); // 未映射子节点继承父前缀
    expect(roots[1].children.map((c) => c.title)).toEqual(["行程问题", "概率"]);
    expect(roots[1].kpPrefix).toBe("数量");
    expect(roots[1].children[1].kpPrefix).toBe("数量/概率初步"); // 显式映射覆盖继承
    expect(roots[0].id).not.toBe(roots[1].id);
  });

  it("空行跳过、跳档不丢节点（深直接跟浅）、上限 500", () => {
    const roots = parseSyllabus("# A\n\n\n## A1\n#### A1a 深\n# B");
    expect(roots.map((r) => r.title)).toEqual(["A", "B"]);
    expect(roots[0].children[0].children[0].title).toBe("A1a 深");
    const many = parseSyllabus(Array.from({ length: 520 }, (_, i) => `节点${i}`).join("\n"));
    expect(JSON.stringify(many).length).toBeGreaterThan(0);
    const total = (n: SyllabusNode): number => 1 + n.children.reduce((s, c) => s + total(c), 0);
    expect(many.reduce((s, r) => s + total(r), 0)).toBeLessThanOrEqual(500);
  });
});

describe("51-03 覆盖对照", () => {
  const kpStats: Record<string, { total: number; learned: number }> = {
    "资料分析/增长率": { total: 12, learned: 4 },
    "资料分析/比重": { total: 5, learned: 5 },
    "数量/概率初步": { total: 3, learned: 0 },
    "言语理解": { total: 8, learned: 1 },
  };

  it("节点计数：子优先认领、父计剩余（不重复归账）；独立掌握分开统计", () => {
    const cov = coverageTree(parseSyllabus(OUTLINE), kpStats);
    expect(cov[0].node.title).toBe("第一章 资料分析");
    expect(subtreeCount(cov[0])).toBe(17);
    expect(subtreeLearned(cov[0])).toBe(9);
    expect(cov[0].total).toBe(0); // 全部被子节点认领
    expect(subtreeCount(cov[0].children[0])).toBe(12);
    expect(subtreeLearned(cov[0].children[0])).toBe(4);
    expect(subtreeCount(cov[1])).toBe(3);
    expect(subtreeLearned(cov[1].children[0])).toBe(0); // 行程问题零题
    expect(subtreeLearned(cov[1].children[1])).toBe(0); // 有题但零独立掌握
  });

  it("缺口 CSV：零题节点与有题零掌握节点都进清单，四列含独立掌握", () => {
    const csv = gapsToCsv(parseSyllabus(OUTLINE), kpStats);
    const rows = csv.split("\n");
    expect(rows[0]).toBe("大纲节点,kp 前缀,题目数,已独立掌握");
    expect(rows).toContain("第二章 数量关系 / 行程问题,数量/行程问题,0,0");
    expect(rows).toContain("第二章 数量关系 / 概率,数量/概率初步,3,0");
    expect(csv).not.toContain("增长率"); // 有独立掌握的节点不进缺口
  });

  it("序列化往返；过版本拒绝为空+标记", () => {
    const doc = { v: 1 as const, meta: { publisher: "人社部", year: "2026" }, roots: parseSyllabus(OUTLINE), importedAt: 123 };
    const back = parseSyllabusDoc(JSON.parse(JSON.stringify(serializeSyllabus(doc))));
    expect(back.doc.roots).toEqual(doc.roots);
    expect(back.doc.meta.publisher).toBe("人社部");
    const tooNew = parseSyllabusDoc({ v: 2, roots: [] });
    expect(tooNew.versionTooNew).toBe(true);
    expect(parseSyllabusDoc(undefined).doc).toEqual(EMPTY_SYLLABUS);
  });
});
