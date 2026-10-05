// 63-01：置信度×结果四象限聚合测试
import { describe, expect, it } from "vitest";
import { quadrantReport, quadrantSignals, type QuadrantReport } from "../src/core/quadrant";
import type { AttemptEvent } from "../src/core/types";

let seq = 0;
function ev(partial: Partial<AttemptEvent>): AttemptEvent {
  return {
    v: 2,
    eid: `q-${++seq}`,
    ts: 1_800_000_000_000 + seq * 1000,
    qid: "q1",
    kind: "practice",
    mode: "daily",
    verdict: "correct",
    myAnswer: "A",
    sessionId: "s1",
    queue: "normal",
    device: "t",
    seq,
    ...partial,
  };
}

describe("quadrantReport（63-01 四象限）", () => {
  it("六格计数：确定✓/确定✗/猜对/犹豫对/犹豫✗/猜✗", () => {
    const r = quadrantReport(
      [
        ev({ confidence: "sure", verdict: "correct" }),
        ev({ confidence: "sure", verdict: "wrong" }),
        ev({ confidence: "guess", verdict: "correct" }),
        ev({ confidence: "fuzzy", verdict: "correct" }),
        ev({ confidence: "fuzzy", verdict: "wrong" }),
        ev({ confidence: "guess", verdict: "wrong" }),
      ],
      () => "single",
    );
    expect(r.cells).toEqual({
      sureRight: 1, sureWrong: 1, fuzzyRight: 1, fuzzyWrong: 1, guessedRight: 1, guessedWrong: 1, noConfidence: 0,
    });
    expect(r.denominator).toBe(6);
    expect(r.lowSample).toBe(true); // < 10 如实标注
  });

  it("置信度缺失不补猜测：单列 noConfidence", () => {
    const r = quadrantReport([ev({}), ev({ confidence: "sure", verdict: "correct" })], () => "single");
    expect(r.cells.noConfidence).toBe(1);
    expect(r.denominator).toBe(2);
  });

  it("同一分母口径：mock/recite/not_attempted 不入表", () => {
    const r = quadrantReport(
      [
        ev({ kind: "mock", confidence: "sure", verdict: "correct" }),
        ev({ kind: "recite", confidence: "sure", verdict: "correct" }),
        ev({ verdict: "not_attempted", confidence: "sure" }),
        ev({ confidence: "sure", verdict: "correct" }),
      ],
      () => "single",
    );
    expect(r.denominator).toBe(1);
    expect(r.cells.sureRight).toBe(1);
  });

  it("按题型下钻：typeOf 注入，降序排列", () => {
    const types: Record<string, string> = { q1: "single", q2: "fill", q3: "fill" };
    const r = quadrantReport(
      [
        ev({ qid: "q1", confidence: "sure", verdict: "correct" }),
        ev({ qid: "q2", confidence: "guess", verdict: "correct" }),
        ev({ qid: "q3", confidence: "guess", verdict: "wrong" }),
      ],
      (qid) => types[qid] ?? "—",
    );
    expect(r.byType[0].type).toBe("fill");
    expect(r.byType[0].total).toBe(2);
    expect(r.byType[1].type).toBe("single");
  });

  it("signals：确定错≥10%、猜对≥15%、缺信心过半才提示", () => {
    const mk = (n: number, f: (i: number) => AttemptEvent) => Array.from({ length: n }, (_, i) => f(i));
    const many: AttemptEvent[] = [
      ...mk(20, (i) => ev({ eid: `a${i}`, confidence: "sure", verdict: "correct" })),
    ];
    // 20 题全对（确定）→ 无信号
    expect(quadrantSignals(quadrantReport(many, () => "single"))).toEqual([]);
    // 加入 3 题确定错（3/23 ≈ 13% ≥ 10%）→ sureWrong 信号
    many.push(ev({ eid: "w1", confidence: "sure", verdict: "wrong" }));
    many.push(ev({ eid: "w2", confidence: "sure", verdict: "wrong" }));
    many.push(ev({ eid: "w3", confidence: "sure", verdict: "wrong" }));
    const r2 = quadrantReport(many, () => "single");
    expect(quadrantSignals(r2)).toContain("sureWrong");
  });

  it("窗口天数如实透传", () => {
    const r: QuadrantReport = quadrantReport([], () => "single", 7);
    expect(r.windowDays).toBe(7);
    expect(r.lowSample).toBe(true);
  });
});
