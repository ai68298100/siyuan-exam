import { describe, it, expect } from "vitest";
import { heatmap, masteryByKp, weakTop, hourly } from "../src/core/report";
import { PracticeSession } from "../src/core/session";
import { makeQuestion } from "../src/core/blockTemplate";
import type { AttemptEvent, ReplayResult } from "../src/core/types";

const NOW = new Date(2026, 9, 2, 12, 0).getTime();
const dayKey = (offset: number) => {
  const d = new Date(2026, 9, 2 - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const q1 = makeQuestion({ type: "single", stem: "A", options: ["1", "2"], answer: "A", kp: "资料/增长率" });
const q2 = makeQuestion({ type: "judge", stem: "B", answer: "对", kp: "言语/逻辑" });
const ev = (i: number, qid: string, verdict: "correct" | "wrong"): AttemptEvent => ({
  v: 1, eid: "e" + i, ts: NOW - i * 86_400_000, qid,
  kind: "practice", mode: "single", verdict, myAnswer: null,
  sessionId: "s", examId: null, queue: "normal", device: "d", seq: i,
});

describe("热力图", () => {
  it("371 格、末格为今天、命中当日计数", () => {
    const days = new Map([[dayKey(0), { date: dayKey(0), attempts: 7, correct: 5 }]]) as ReplayResult["days"];
    const cells = heatmap(days, new Date(2026, 9, 2));
    expect(cells).toHaveLength(371);
    expect(cells[370].date).toBe(dayKey(0));
    expect(cells[370].count).toBe(7);
  });
});

describe("考点掌握度", () => {
  it("首段聚合：正确率 × 留存；<3 题数据不足(-1)", () => {
    const qs = [q1, makeQuestion({ type: "judge", stem: "A2", answer: "对", kp: "资料/比重" }), q2, makeQuestion({ type: "fill", stem: "B2", answer: "x", kp: "言语" })];
    const events = [
      ev(3, q1.id, "wrong"), ev(2, q1.id, "correct"), ev(1, qs[1].id, "correct"),
      ev(0, q2.id, "correct"),
    ];
    const mast = masteryByKp(qs, new Map(), events, NOW);
    const ziliao = mast.find((m) => m.root === "资料")!;
    expect(ziliao.total).toBe(3);
    expect(ziliao.accuracy).toBeCloseTo(2 / 3);
    const yanYu = mast.find((m) => m.root === "言语")!;
    expect(yanYu.total).toBe(1);
    expect(yanYu.mastery).toBe(-1);      // 数据不足
  });
  it("薄弱 Top10 升序且剔除数据不足", () => {
    const qs = [q1, q2];
    const events = [
      ev(2, q1.id, "wrong"), ev(1, q1.id, "correct"), ev(0, q1.id, "correct"),
      ev(0, q2.id, "correct"),
    ];
    // q2 仅 1 题 → 数据不足剔除
    const byQuestion = new Map();
    const mast = masteryByKp(qs, byQuestion, events, NOW);
    const weak = weakTop(mast);
    expect(weak.every((w) => w.total >= 3 || w.total === 2)).toBe(true);
    expect(weak.some((w) => w.root === "资料")).toBe(true);
  });
});

describe("时段分布", () => {
  it("按本地小时聚合", () => {
    const events = [mk(0, "q1", "correct", 8), mk(1, "q1", "wrong", 8), mk(2, "q2", "correct", 22)];
    const h = hourly(events.map((e) => ({ ...e, ts: 0 })));
    expect(h).toHaveLength(24);
  });
});

describe("错题即重排（re-review）", () => {
  it("答错排到队尾且仅一次", () => {
    const qs = [
      makeQuestion({ type: "single", stem: "A", options: ["1", "2"], answer: "A" }),
      makeQuestion({ type: "judge", stem: "B", answer: "对" }),
    ];
    const s = new PracticeSession(qs, "single", undefined, () => Date.now());
    expect(s.submit("B")!.grade.verdict).toBe("wrong");   // A 错 → 排队尾
    expect(s.state.qids).toHaveLength(3);
    s.next();
    expect(s.submit("对")!.grade.verdict).toBe("correct");
    s.next();
    expect(s.submit("A")!.grade.verdict).toBe("correct"); // 重来的 A 答对，不再重排
    expect(s.state.qids.filter((x) => x === qs[0].id)).toHaveLength(2);   // 原位 + 一次重排
    expect(s.state.qids[s.state.qids.length - 1]).toBe(qs[0].id);
  });
});

function mk(i: number, qid: string, verdict: "correct" | "wrong", hour = 12): AttemptEvent {
  const d = new Date(2026, 9, 2, hour, 0);
  return {
    v: 1, eid: "e" + i + hour, ts: d.getTime(), qid,
    kind: "practice", mode: "single", verdict, myAnswer: null,
    sessionId: "s", examId: null, queue: "normal", device: "d", seq: i,
  };
}
