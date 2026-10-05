// 65-05 lite：可复现随机——同种子同序、不同种子（几乎必然）异序、抽样、持久化往返
import { describe, expect, it } from "vitest";
import { hashSeed, mulberry32, randomSeedId, seededPickN, seededShuffle } from "../src/core/random";
import { makeQuestion } from "../src/core/blockTemplate";
import { PracticeSession } from "../src/core/session";
import type { Question } from "../src/core/types";

const qs = (n: number): Question[] =>
  Array.from({ length: n }, (_, i) => makeQuestion({ type: "single", stem: `题${i}`, options: ["1", "2"], answer: "A" }));

describe("random.ts（65-05 种子随机）", () => {
  it("同 seed 同数组 → 同洗牌序（可复现）", () => {
    const arr = qs(20).map((q) => q.id);
    expect(seededShuffle(arr, "s-abc")).toEqual(seededShuffle(arr, "s-abc"));
  });

  it("不同 seed →（统计上）不同序；原数组不被修改", () => {
    const arr = qs(30).map((q) => q.id);
    const a = seededShuffle(arr, "s-1");
    const b = seededShuffle(arr, "s-2");
    expect(a).not.toEqual(b);
    expect(arr).toHaveLength(30); // 原数组不动
  });

  it("mulberry32 确定性；seed 相同 → 同序列", () => {
    const r1 = mulberry32(hashSeed("s-1"));
    const r2 = mulberry32(hashSeed("s-1"));
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
    expect(r1()).not.toBe(r1()); // 序列推进
  });

  it("seededPickN：n 截断与全量", () => {
    const arr = qs(10).map((q) => q.id);
    expect(seededPickN(arr, 3, "s-x")).toHaveLength(3);
    expect(seededPickN(arr, 50, "s-x")).toHaveLength(10);
  });

  it("randomSeedId：非空且基本唯一", () => {
    const a = randomSeedId();
    const b = randomSeedId();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe("PracticeSession seed 持久化（checkpoint 往返）", () => {
  it("seed 写入 state 且随快照保留（恢复后仍可展示复现标识）", () => {
    const s = new PracticeSession(qs(5), "daily");
    s.state.seed = "s-xyz";
    const snapshot = JSON.parse(JSON.stringify(s.state)) as { seed?: string };
    const restored = new PracticeSession(qs(5), "daily", snapshot);
    expect(restored.state.seed).toBe("s-xyz");
  });
});
