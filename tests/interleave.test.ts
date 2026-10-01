import { describe, it, expect } from "vitest";
import { interleaveGroups } from "../src/core/interleave";
import { makeQuestion } from "../src/core/blockTemplate";

const q = (stem: string, group?: string) => ({
  ...makeQuestion({ type: "single", stem, options: ["1", "2"], answer: "A" }),
  group,
});

describe("interleaveGroups（材料组埋藏）", () => {
  it("同组子题被无组题分隔", () => {
    const qs = [q("g1a", "g1"), q("loose", undefined), q("g1b", "g1"), q("loose2", undefined), q("g1c", "g1")];
    const result = interleaveGroups(qs);
    // 同组不相邻
    for (let i = 1; i < result.length; i++) {
      if (result[i].group && result[i - 1].group) {
        expect(result[i].group).not.toBe(result[i - 1].group);
      }
    }
    expect(result).toHaveLength(5);
  });
  it("两个组互相穿插", () => {
    const qs = [q("a1", "ga"), q("a2", "ga"), q("b1", "gb"), q("b2", "gb")];
    const result = interleaveGroups(qs);
    // 不应出现同组连续
    for (let i = 1; i < result.length; i++) {
      if (result[i].group && result[i - 1].group) {
        expect(result[i].group).not.toBe(result[i - 1].group);
      }
    }
  });
  it("空数组", () => {
    expect(interleaveGroups([])).toEqual([]);
  });
});
