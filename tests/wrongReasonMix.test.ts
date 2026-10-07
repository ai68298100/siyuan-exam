// wrongReasonMix 回归锁：错题本错因分布口径（maps 优先 → 遗留字段 → 未标注桶）
// 背景：WrongItem.reason 为恒空的遗留字段，真实标注在 reasons map——混用曾导致分布恒「未标注」
import { describe, expect, it } from "vitest";
import { wrongReasonMix } from "../src/core/replayer";

const items = (rs: (string | undefined)[]) => rs.map((r, i) => ({ qid: `q${i + 1}`, reason: r as any }));

describe("wrongReasonMix 错因分布口径", () => {
  it("空列表 → 全零", () => {
    expect(wrongReasonMix([], new Map())).toEqual({ careless: 0, unknown: 0, trap: 0, unmarked: 0 });
  });

  it("reasons map 优先于遗留字段", () => {
    const reasons = new Map([["q1", "unknown" as const]]);
    // q1 遗留字段写 careless，但 map 标注 unknown → 以 map 为准
    expect(wrongReasonMix(items(["careless"]), reasons)).toEqual({ careless: 0, unknown: 1, trap: 0, unmarked: 0 });
  });

  it("无 map 标注时回落遗留字段；两路皆空计未标注", () => {
    const mix = wrongReasonMix(items(["trap", undefined, "careless"]), new Map());
    expect(mix).toEqual({ careless: 1, unknown: 0, trap: 1, unmarked: 1 });
  });

  it("map 中已知键之外的项目不影响其它桶", () => {
    const reasons = new Map([["q9", "trap" as const]]); // q9 不在列表 → 忽略
    expect(wrongReasonMix(items([undefined, undefined]), reasons)).toEqual({ careless: 0, unknown: 0, trap: 0, unmarked: 2 });
  });
});
