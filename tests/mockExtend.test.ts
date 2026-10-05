import { describe, it, expect } from "vitest";
import { MockSession, type Blueprint } from "../src/core/mock";
import type { Question } from "../src/core/types";

function makePaper(n: number): Question[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `q-${String(i).padStart(3, "0")}`,
    type: "single" as const,
    stem: `S${i}`,
    options: ["a", "b", "c", "d"],
    answer: "A",
    score: 1,
    origin: "imported" as const,
    hash: `h${i}`,
  }));
}

function makeBp(durationS = 600, sectionTimed = false): Blueprint {
  return {
    id: "bp-1",
    name: "测试卷",
    durationS,
    passPercent: 60,
    sectionTimed,
    sections: [{ name: "全卷", kp: "", count: 5, score: 1 }],
  } as unknown as Blueprint;
}

function makeSession(): MockSession {
  const paper = makePaper(5);
  return new MockSession(makeBp(), paper, { sectionOf: new Map(), scoreOf: new Map() }, 1_000_000);
}

describe("55-06 单次模考时间覆盖", () => {
  const NOW = 1_000_000 + 120_000; // 开考后 120 秒

  it("extendTime 累计延时；remaining 相应延长；已交卷拒绝", () => {
    const s = makeSession();
    expect(s.remaining(NOW)).toBe(480_000); // 600-120
    expect(s.extendTime(300)).toBe(300);
    expect(s.extendTime(60)).toBe(360); // 累计
    expect(s.state.extraTimeS).toBe(360);
    expect(s.remaining(NOW)).toBe(480_000 + 360_000);
    s.submit(NOW);
    expect(s.extendTime(60)).toBeNull(); // 已交卷拒绝
  });

  it("非法秒数拒绝（≤0）", () => {
    const s = makeSession();
    expect(s.extendTime(0)).toBeNull();
    expect(s.extendTime(-5)).toBeNull();
    expect(s.state.extraTimeS ?? 0).toBe(0);
  });

  it("分段计时：延时按比例摊入各段预算", () => {
    const paper = makePaper(4);
    const sectionOf = new Map(paper.map((q) => [q.id, "全卷"]));
    const s = new MockSession(makeBp(400, true), paper, { sectionOf, scoreOf: new Map() }, 0);
    // 4 题同段 → 段预算=总预算；延时 100s → 段预算 400+100
    s.extendTime(100);
    const budget = s.sectionRemaining("全卷", 50_000);
    expect(budget).toBeCloseTo((400 + 100) * 1000 - 50_000, -2);
  });

  it("快照携带 extraTimeS（未延时不写字段）；restore 恢复延时条件", () => {
    const s = makeSession();
    const snap0 = s.toSnapshot("r-1", NOW);
    expect("extraTimeS" in snap0).toBe(false); // 未延时不写字段
    s.extendTime(300);
    const snap = s.toSnapshot("r-1", NOW);
    expect(snap.extraTimeS).toBe(300);
    // restore 恢复后 remaining 一致
    const { session: restored } = MockSession.restore(snap, makePaper(5));
    expect(restored.state.extraTimeS).toBe(300);
    expect(restored.remaining(NOW)).toBe(s.remaining(NOW));
  });
});
