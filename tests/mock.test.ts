import { describe, it, expect } from "vitest";
import { assemble, blueprintTotals, MockSession, type Blueprint } from "../src/core/mock";
import { makeQuestion } from "../src/core/blockTemplate";
import type { Question } from "../src/core/types";

const q = (id: string, type: Question["type"], sourceKind: "real" | "mock", kp: string): Question => ({
  ...makeQuestion({
    type,
    stem: id,
    options: type === "single" ? ["1", "2"] : [],
    answer: type === "judge" ? "对" : type === "single" ? "A" : "A",
  }),
  id,
  sourceKind,
  kp,
});

const bank: Question[] = [
  q("r1", "single", "real", "言语"),
  q("r2", "single", "real", "言语"),
  q("r3", "single", "real", "数量"),
  q("m1", "single", "mock", "言语"),
  q("m2", "judge", "mock", "判断"),
  q("m3", "judge", "mock", "判断"),
  q("m4", "judge", "mock", "判断"),
];

const bp: Blueprint = {
  id: "bp1",
  name: "行测模拟",
  durationS: 3600,
  passLine: 60,
  shuffleOptions: false,
  sectionTimed: true,
  sections: [
    { name: "言语", count: 3, scoreEach: 0.8, source: "real", types: ["single"] },
    { name: "判断", count: 4, scoreEach: 1, source: "mock", types: ["judge"] },
  ],
};

describe("组卷", () => {
  it("按蓝图拼卷：各段题数/分值/来源；判断段短缺显式报告", () => {
    const r = assemble(bp, bank, () => 0);
    expect(r.paper).toHaveLength(6);
    expect(r.sectionOf.get("r1")).toBe("言语");
    expect(r.scoreOf.get("r1")).toBe(0.8);
    expect(r.sectionOf.get("m2")).toBe("判断");
    // 判断段 mock judge 仅 3 道（need 4）
    expect(r.shortages).toEqual([{ name: "判断", need: 4, have: 3, filledFromMixed: 0 }]);
    expect(blueprintTotals(bp)).toEqual({ questions: 7, score: 6.4 });
  });
  it("来源不足 → mixed 兜底并计入 filledFromMixed", () => {
    const tight: Blueprint = {
      ...bp,
      sections: [{ name: "言语", count: 4, scoreEach: 1, source: "real", types: ["single"] }],
    };
    const r = assemble(tight, bank, () => 0);
    expect(r.paper).toHaveLength(4);
    expect(r.paper.some((q) => q.id === "m1")).toBe(true); // mock 单选兜底
    expect(r.shortages).toEqual([{ name: "言语", need: 4, have: 4, filledFromMixed: 1 }]);
  });
  it("题型过滤", () => {
    const typed: Blueprint = {
      ...bp,
      sections: [{ name: "判断", count: 2, scoreEach: 1, source: "mixed", types: ["judge"] }],
    };
    const r = assemble(typed, bank, () => 0);
    expect(r.paper.every((x) => x.type === "judge")).toBe(true);
  });
});

describe("模考会话", () => {
  const build = () => {
    const r = assemble(bp, bank, () => 0);
    const start = 1_000_000;
    return { s: new MockSession(bp, r.paper, r, start), start, r };
  };

  it("计时段：进入新段记录起始，段剩余按份额折算", () => {
    const { s, start } = build();
    const first = s.state.qids[0];
    const sec1 = s.sectionOf.get(first)!;
    s.enterSection(sec1, start);
    expect(s.sectionRemaining(sec1, start)).toBeGreaterThan(0);
    expect(s.remaining(start)).toBe(3_600_000);
    expect(s.remaining(start + 3_600_000)).toBe(0);
  });

  it("作答/改答计数/标旗/交卷", () => {
    const { s, start, r } = build();
    const q1 = r.paper[0]; // real 言语 答案 A
    s.setAnswer(q1.id, "A", start + 10_000);
    s.setAnswer(q1.id, "B", start + 20_000); // 改答
    s.toggleFlag(q1.id);
    expect(s.answers.get(q1.id)!.changes).toBe(1);
    expect(s.flags.has(q1.id)).toBe(true);
    expect(s.shouldAutoSubmit(start + 30_000)).toBe(false);
    s.submit(start + 30_000);
    expect(s.shouldAutoSubmit(start + 3_600_000)).toBe(false); // 已交卷：不再触发自动
  });

  it("结算：未答计 0 分占满额；及格线；最后 20 分钟", () => {
    const { s, start, r } = build();
    // 只答 3 题：对 2（言语 1 题 0.8 + 判断 2 题 2.0）
    const answerPairs: [string, string][] = [
      [r.paper[0].id, r.paper[0].answer],
      [r.paper[1].id, "Z"],
      [r.paper[3].id, r.paper[3].answer],
      [r.paper[4].id, r.paper[4].answer],
    ];
    let t = start + 1000;
    for (const [id, a] of answerPairs) {
      s.setAnswer(id, a, t);
      t += 60_000;
    }
    s.submit(start + 3_599_000);
    const score = s.score();
    expect(score.full).toBeCloseTo(6.4);
    expect(score.total).toBeCloseTo(0.8 + 2.0);
    expect(score.pass).toBe(false);
    expect(score.sections.find((x) => x.name === "言语")!.total).toBe(3);
    expect(score.last20min.attempted).toBeGreaterThanOrEqual(0);
    expect(score.flagsUsed).toBe(0);
  });

  it("自动交卷边界", () => {
    const { s, start } = build();
    expect(s.shouldAutoSubmit(start)).toBe(false);
    expect(s.shouldAutoSubmit(start + 3_600_001)).toBe(true);
    s.submit(start + 3_600_001);
    expect(s.shouldAutoSubmit(start + 3_600_002)).toBe(false);
  });
});
