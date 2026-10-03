import { describe, it, expect } from "vitest";
import {
  selfRatingToRiffRating,
  binaryToRiffRating,
  pickSameKp,
  cramQueue,
  dailySet,
  deckNameForBank,
} from "../src/core/memory";
import { makeQuestion } from "../src/core/blockTemplate";

const qs = [
  makeQuestion({ type: "single", stem: "S1", options: ["1", "2"], answer: "A", kp: "资料/增长率" }),
  makeQuestion({ type: "single", stem: "S2", options: ["1", "2"], answer: "B", kp: "资料/比重" }),
  makeQuestion({ type: "single", stem: "S3", options: ["1", "2"], answer: "A", kp: "言语/逻辑" }),
  makeQuestion({ type: "judge", stem: "J1", answer: "对", kp: "资料/增长率" }),
];

describe("评级映射", () => {
  it("四级 → riff 0-3", () => {
    expect(selfRatingToRiffRating(1)).toBe(0);
    expect(selfRatingToRiffRating(2)).toBe(1);
    expect(selfRatingToRiffRating(3)).toBe(2);
    expect(selfRatingToRiffRating(4)).toBe(3);
    expect(selfRatingToRiffRating(99)).toBe(0);
  });
  it("二元", () => {
    expect(binaryToRiffRating(true)).toBe(2);
    expect(binaryToRiffRating(false)).toBe(0);
  });
  it("卡包命名空间", () => {
    expect(deckNameForBank("公考题库")).toBe("小驴考试/公考题库");
  });
});

describe("举一反三", () => {
  it("完整考点优先，其次同章节，排除种子题", () => {
    const picked = pickSameKp(qs, qs[0], 2);
    expect(picked[0].kp).toBe("资料/增长率"); // 完整考点：J1
    expect(picked[1].kp?.split("/")[0]).toBe("资料"); // 退到同章节：资料/比重
    expect(picked.every((q) => q.id !== qs[0].id)).toBe(true);
  });
  it("完整考点被排除后回退同章节", () => {
    const picked = pickSameKp(qs, qs[0], 1, new Set([qs[3].id]));
    expect(picked[0].kp).toBe("资料/比重");
  });
});

describe("cram 队列", () => {
  it("错 ≥2 才入队，按错次降序，limit 生效", () => {
    const counts = new Map([
      [qs[0].id, 5],
      [qs[1].id, 2],
      [qs[2].id, 1],
    ]);
    const q = cramQueue(qs, counts, 2, 50);
    expect(q.map((x) => x.id)).toEqual([qs[0].id, qs[1].id]);
    expect(cramQueue(qs, counts, 2, 1)).toHaveLength(1);
  });
});

describe("每日一练", () => {
  it("到期优先 → 错次次序 → 随机补足，去重且不超 n", () => {
    const counts = new Map([[qs[2].id, 3]]);
    const due = [qs[3]];
    const set = dailySet(qs, due, counts, 3);
    expect(set).toHaveLength(3);
    expect(set[0].id).toBe(qs[3].id);
    expect(set[1].id).toBe(qs[2].id);
    expect(new Set(set.map((q) => q.id)).size).toBe(3);
  });
});
