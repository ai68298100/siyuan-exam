import { describe, it, expect } from "vitest";
import { estimateScore } from "../src/core/estimate";

describe("估分", () => {
  it("基础对分与及格线", () => {
    const r = estimateScore("BADCA", "BADCB", { scoreEach: 2, passLine: 60 })!;
    expect(r.total).toBe(5);
    expect(r.correct).toBe(4);
    expect(r.wrong).toBe(1);
    expect(r.score).toBe(8);
    expect(r.full).toBe(10);
    expect(r.percent).toBe(80);
    expect(r.pass).toBe(true);
    expect(r.marks).toEqual(["✓", "✓", "✓", "✓", "✕"]);
  });
  it("空题标记 . / ？ 不计正误", () => {
    const r = estimateScore("AB.C？", "ABDCA", { scoreEach: 1 })!;
    expect(r.blank).toBe(2); // pos2 '.' 与 pos4 '？'（全角折半角）均为空题
    expect(r.answered).toBe(3); // A✓ B✓ C✓（std[3]=C）
    expect(r.percent).toBe(60);
    expect(r.marks).toEqual(["✓", "✓", "–", "✓", "–"]);
  });
  it("大小写与空白折叠", () => {
    const r = estimateScore(" b a d c a ", "BADCA")!;
    expect(r.correct).toBe(5);
  });
  it("标准化后的长度不齐时拒绝估分", () => {
    expect(estimateScore("AB", "ABCDE", { scoreEach: 1 })).toBeNull();
  });
  it("长度校验前折叠全半角与所有空白", () => {
    const r = estimateScore("Ａ B\nC", "ABC", { scoreEach: 1 })!;
    expect(r.total).toBe(3);
    expect(r.correct).toBe(3);
  });
  it("空输入 → null", () => {
    expect(estimateScore("", "")).toBeNull();
    expect(estimateScore("AB", "")).toBeNull();
  });
});
