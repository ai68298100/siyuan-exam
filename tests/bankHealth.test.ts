import { describe, it, expect } from "vitest";
import { duplicateClusters, missingFields, bankHealthReport, jaccard } from "../src/core/bankHealth";
import { makeQuestion } from "../src/core/blockTemplate";
import type { Question } from "../src/core/types";

const q = (stem: string, over: Partial<Question> = {}): Question =>
  makeQuestion({ type: "single", stem, options: ["甲", "乙"], answer: "A", ...over } as Parameters<
    typeof makeQuestion
  >[0]);

describe("题库健康：重复检测（TODO 2.2）", () => {
  it("精确重复（题干+选项一致）归簇 similarity=1；忽略空白差异", () => {
    const a = q("我国的内核是用什么语言写的？");
    const b = q("我国的内核是用 什么语言写的？"); // 仅空白差异 → 同指纹
    const c = q("完全不同的一道题");
    const clusters = duplicateClusters([a, b, c]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].similarity).toBe(1);
    expect(clusters[0].ids).toEqual([a.id, b.id]);
  });

  it("高相似但不同题干 → 模糊簇（similarity<1）；低相似不成簇", () => {
    const a = q("下列关于资料分析增长率说法正确的是哪一项");
    const b = q("下列关于资料分析增长率说法不正确的是哪一项"); // 一字之差（陷阱题，相似度会很高）
    const c = q("方程 x^2=4 的解是哪一组");
    const clusters = duplicateClusters([a, b, c], 0.8);
    const hit = clusters.find((cl) => cl.ids.includes(a.id));
    expect(hit).toBeDefined();
    expect(hit!.similarity).toBeLessThan(1);
    expect(jaccard("完全无关甲", "风马牛不相及乙")).toBeLessThan(0.3);
  });

  it("同题干不同选项不算精确重复（指纹含选项）；高相似只进模糊簇", () => {
    const a = q("同一题干，选项不同");
    const b = makeQuestion({ type: "single", stem: "同一题干，选项不同", options: ["丙", "丁"], answer: "A" });
    const clusters = duplicateClusters([a, b], 0.55);
    expect(clusters.filter((c) => c.similarity === 1)).toHaveLength(0); // 精确指纹不同
  });
});

describe("题库健康：字段缺失清单（TODO 2.2）", () => {
  it("选择题缺选项/缺答案、全题型缺解析/考点/出处 分别计数", () => {
    const qs: Question[] = [
      q("完整题", { analysis: "有", kp: "言语", source: "2023 国考" }),
      makeQuestion({ type: "judge", stem: "判断缺选项不算", answer: "对" }),
      q("缺答案题", { answer: "" }),
      makeQuestion({ type: "single", stem: "选项不足", options: ["唯一项"], answer: "A" }),
    ];
    const rows = missingFields(qs);
    const byField = new Map(rows.map((r) => [r.field, r]));
    expect(byField.get("analysis")!.count).toBe(3); // qs[0] 齐全
    expect(byField.get("kp")!.count).toBe(3);
    expect(byField.get("source")!.count).toBe(3);
    expect(byField.get("answer")!.count).toBe(1);
    expect(byField.get("options")!.count).toBe(1);
    expect(byField.get("options")!.qids).not.toContain(qs[1].id); // judge 不检查选项
  });

  it("空字段（空白串）计缺失；报告聚合一键可用", () => {
    const qs = [q("A", { analysis: "  " }), q("B", { kp: "" })];
    const report = bankHealthReport(qs);
    expect(report.total).toBe(2);
    const fields = report.missing.map((r) => r.field);
    expect(fields).toContain("analysis");
    expect(fields).toContain("kp");
    expect(report.clusters).toHaveLength(0);
  });
});
