import { describe, it, expect } from "vitest";
import { answerDistribution, unreviewedStats } from "../src/core/bankHealth";
import type { Question } from "../src/core/types";

function choice(id: string, answer: string, extra: Partial<Question> = {}): Question {
  return {
    id,
    type: "single",
    stem: `S${id}`,
    options: ["a", "b", "c", "d"],
    answer,
    score: 1,
    origin: "imported",
    hash: "h" + id,
    ...extra,
  };
}

describe("67-03 lite 答案分布异常", () => {
  it("样本 <10 不判定（skewed/starved 为空）", () => {
    const qs = Array.from({ length: 8 }, (_, i) => choice(`q${i}`, "A"));
    const d = answerDistribution(qs);
    expect(d.total).toBe(8);
    expect(d.skewed).toBeNull();
    expect(d.starved).toEqual([]);
  });

  it("样本 ≥10：单一字母 >60% 判偏斜；未出现字母判零次", () => {
    const qs = [
      ...Array.from({ length: 8 }, (_, i) => choice(`a${i}`, "A")),
      ...Array.from({ length: 3 }, (_, i) => choice(`b${i}`, "B")),
      choice("c0", "C"),
    ];
    const d = answerDistribution(qs);
    expect(d.total).toBe(12);
    expect(d.skewed).toBe("A");
    expect(d.skewedRatio).toBe(67);
    expect(d.starved).toEqual(["D"]);
  });

  it("均衡分布无异常；多选逐字母计数", () => {
    const qs = [
      ...Array.from({ length: 5 }, (_, i) => choice(`a${i}`, ["A", "B", "C", "D"][i % 4])),
      ...Array.from({ length: 5 }, (_, i) => choice(`b${i}`, ["A", "B", "C", "D"][i % 4])),
      choice("m0", "AB", { type: "multiple" }),
    ];
    const d = answerDistribution(qs);
    expect(d.skewed).toBeNull();
    expect(d.starved).toEqual([]);
    expect(d.counts.A).toBe(5); // 单选 a0/a4/b0 + 多选 A
    expect(d.counts.B).toBe(3); // 单选 a1/b1 + 多选 B
    expect(d.total).toBe(12);
  });

  it("非选择题不参与；小写答案归一", () => {
    const qs = [
      ...Array.from({ length: 12 }, (_, i) => choice(`a${i}`, i < 7 ? "a" : "B")),
      choice("f0", "任意文本", { type: "fill", options: [] }),
    ];
    const d = answerDistribution(qs);
    expect(d.counts.A).toBe(7);
    expect(d.counts.B).toBe(5);
    expect(d.total).toBe(12);
  });
});

describe("67-03 lite 未审校比例", () => {
  it("AI 待审计数与占比；无 AI 题为 null", () => {
    const qs = [
      choice("a0", "A", { origin: "ai", review: "pending" }),
      choice("a1", "B", { origin: "ai", review: "pending" }),
      choice("a2", "C", { origin: "ai", review: "verified" }),
      choice("m0", "D", { origin: "manual" }),
    ];
    expect(unreviewedStats(qs)).toEqual({ count: 2, ratio: 67 });
    expect(unreviewedStats([choice("m1", "A", { origin: "manual" })]).ratio).toBeNull();
  });

  it("review 缺省按 pending（AI 题未显式标记=未审校）", () => {
    const qs = [choice("a0", "A", { origin: "ai" })];
    expect(unreviewedStats(qs)).toEqual({ count: 1, ratio: 100 });
  });
});
