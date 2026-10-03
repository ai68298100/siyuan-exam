import { describe, it, expect } from "vitest";
import { calibration } from "../src/core/report";
import type { AttemptEvent } from "../src/core/types";

const NOW = 1_790_000_000_000;
let n = 0;
const ev = (over: Partial<AttemptEvent>): AttemptEvent => ({
  v: 1, eid: "e" + n++, ts: NOW, qid: "q", kind: "practice", mode: "single",
  verdict: "correct", myAnswer: null, sessionId: "s", examId: null, queue: "normal", device: "d", seq: n,
  ...over,
});

describe("置信度校准聚合（U12 最小切片）", () => {
  it("分档统计正确率；recite/card 与未作答不参与；缺信心计入 unreported", () => {
    const events = [
      ev({ confidence: "sure", verdict: "correct" }),
      ev({ confidence: "sure", verdict: "correct" }),
      ev({ confidence: "sure", verdict: "wrong" }),
      ev({ confidence: "guess", verdict: "wrong" }),
      ev({ confidence: "guess", verdict: "wrong" }),
      ev({ confidence: "guess", verdict: "correct" }),
      ev({ verdict: "correct" }),                                   // 未报信心
      ev({ kind: "recite", selfRating: 4, confidence: "sure" }),    // 背诵自评不参与
      ev({ kind: "card", confidence: "sure" }),                     // 闪卡不参与
      ev({ verdict: "not_attempted", confidence: "guess" }),        // 跳过不参与
    ];
    const r = calibration(events);
    const sure = r.rows.find((x) => x.confidence === "sure")!;
    const guess = r.rows.find((x) => x.confidence === "guess")!;
    expect(sure.attempts).toBe(3);
    expect(sure.accuracy).toBe(67);
    expect(guess.attempts).toBe(3);
    expect(guess.accuracy).toBe(33);
    expect(r.unreported).toBe(1);
    expect(r.spread).toBe(33);   // 2/3 − 1/3 = 33.3 → 33
  });

  it("样本不足（任一档 <3 题）不输出 spread，避免小样本误导", () => {
    const r = calibration([ev({ confidence: "sure", verdict: "correct" }), ev({ confidence: "guess", verdict: "wrong" })]);
    expect(r.spread).toBeNull();
    expect(r.rows).toHaveLength(2);
  });

  it("零信心作答只有 unreported：rows 为空也不炸", () => {
    const r = calibration([ev({}), ev({ verdict: "wrong" })]);
    expect(r.rows).toHaveLength(0);
    expect(r.unreported).toBe(2);
    expect(r.spread).toBeNull();
  });
});
