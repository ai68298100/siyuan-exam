import { describe, it, expect } from "vitest";
import { replay, activeWrongItems } from "../src/core/replayer";
import type { AttemptEvent } from "../src/core/types";

const ev = (over: Partial<AttemptEvent>): AttemptEvent => ({
  v: 1, eid: "e" + Math.random().toString(36).slice(2), ts: 1_790_000_000_000, qid: "q-friend",
  kind: "practice", mode: "challenge", verdict: "wrong", myAnswer: "A",
  sessionId: "s-challenge", examId: null, queue: "normal", device: "d", seq: 1,
  ...over,
});

describe("挑战码作答不入错题本（13 组审计：孤儿错题防污染）", () => {
  it("challenge 答错不进错题本（对手题无消灭路径）；但计入活动统计", () => {
    const r = replay([ev({})]);
    expect(r.wrongbook.size).toBe(0);
    expect(activeWrongItems(r)).toHaveLength(0);
    expect(r.byQuestion.get("q-friend")?.attempts).toBe(1);   // 统计仍计
    expect(r.days.size).toBe(1);                              // 日活动仍计
  });

  it("同样作答在普通练习模式照常收录（规则只豁免 challenge）", () => {
    const r = replay([ev({ mode: "quick" })]);
    expect(r.wrongbook.size).toBe(1);
    expect(activeWrongItems(r)).toHaveLength(1);
  });

  it("混合流：challenge 连对不计入练习错题的消灭 streak（隔离证明）", () => {
    const r = replay([
      ev({ eid: "p1", mode: "quick", qid: "q-mine", verdict: "wrong" }),
      ev({ eid: "c1", mode: "challenge", qid: "q-friend", verdict: "wrong" }),
      ev({ eid: "c2", mode: "challenge", qid: "q-friend", verdict: "correct" }),
      ev({ eid: "c3", mode: "challenge", qid: "q-friend", verdict: "correct" }),
      ev({ eid: "p2", mode: "quick", qid: "q-mine", verdict: "correct" }),
    ]);
    expect(r.wrongbook.has("q-friend")).toBe(false);
    // 若 challenge 连对渗入 streak，p2 后即达 2 次消灭；隔离正确时仅 1 次 → 仍 active
    const mine = r.wrongbook.get("q-mine")!;
    expect(mine.status).toBe("active");
    expect(mine.streakCorrect).toBe(1);
  });
});
