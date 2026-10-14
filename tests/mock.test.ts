import { describe, it, expect } from "vitest";
import { assemble, blueprintTotals, defaultMockSections, validateBlueprint, MockSession, type Blueprint } from "../src/core/mock";
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
  it("默认模块名称与考点配额一致，不会把别的考点题抽入本段", () => {
    const questions = [...bank, q("short", "short", "mock", "言语"), q("material", "material", "mock", "数量")];
    const sections = defaultMockSections(questions);
    const result = assemble({ ...bp, sections }, questions, () => 0.99);
    expect(result.paper).toHaveLength(bank.length);
    expect(result.paper.every((question) => !["short", "material"].includes(question.type))).toBe(true);
    for (const question of result.paper) expect(result.sectionOf.get(question.id)).toBe(question.kp!.split("/")[0]);
    expect(result.shortages).toEqual([]);
  });

  it("混有未分类题时默认按全量抽题，不把全部当成考点限制", () => {
    const questions = [q("classified", "single", "mock", "言语"), q("unclassified", "judge", "mock", "")];
    const sections = defaultMockSections(questions);
    expect(sections).toHaveLength(1);
    expect(assemble({ ...bp, sections }, questions).paper).toHaveLength(2);
    expect(defaultMockSections([q("only-short", "short", "mock", "简答")])).toEqual([]);
  });

  it("空白/非数值配置不能让模考带着无效时长或分数开始", () => {
    const invalid: Blueprint = { ...bp, durationS: NaN, passLine: NaN, sections: [
      { name: "小卷", count: -1, scoreEach: NaN, source: "mixed", types: [] },
    ] };
    const issues = validateBlueprint(invalid).join("；");
    expect(issues).toContain("题数必须为非负整数");
    expect(issues).toContain("每题分值必须为有效数字");
    expect(issues).toContain("总时长");
    expect(issues).toContain("及格线");
  });

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
    expect(score.full).toBeCloseTo(5.4); // 40-02：实际卷面（判断段短缺 1 题，不再按蓝图 6.4 虚高）
    expect(score.total).toBeCloseTo(0.8 + 2.0);
    expect(score.pass).toBe(false);
    expect(score.sections.find((x) => x.name === "言语")!.total).toBe(3);
    expect(score.last20min.attempted).toBeGreaterThanOrEqual(0);
    expect(score.flagsUsed).toBe(0);
  });

  it("40-02 逐段满分标注：短缺段 full 按实际卷面 + required/short 如实", () => {
    const { s, r, start } = build();
    for (const q of r.paper) s.setAnswer(q.id, q.answer, start + 1000); // 全部答对
    s.submit(start + 3_599_000);
    const score = s.score();
    const judge = score.sections.find((x) => x.name === "判断")!;
    expect(judge.required).toBe(4);
    expect(judge.total).toBe(3);
    expect(judge.short).toBe(true);
    expect(judge.full).toBeCloseTo(3); // 实际 3×1，不再按蓝图 4 虚高
    expect(judge.short).toBe(true);
    expect(judge.full).toBeCloseTo(3); // 实际 3×1，不再按蓝图 4 虚高
    const yan = score.sections.find((x) => x.name === "言语")!;
    expect(yan.short).toBe(false);
    expect(yan.required).toBe(3);
    expect(score.full).toBeCloseTo(5.4);
    expect(score.percent).toBe(100);
    expect(score.pass).toBe(true);
  });

  it.each([
    { count: 11, correct: 11, passLine: 60, percent: 100, pass: true },
    { count: 5, correct: 3, passLine: 60, percent: 60, pass: true },
    { count: 5, correct: 2, passLine: 60, percent: 40, pass: false },
    { count: 5, correct: 5, passLine: 100, percent: 100, pass: true },
    { count: 5, correct: 4, passLine: 100, percent: 80, pass: false },
    { count: 5, correct: 0, passLine: 0, percent: 0, pass: true },
  ])("小试卷及格线按百分制判断：$correct/$count，及格线 $passLine", ({ count, correct, passLine, percent, pass }) => {
    const paper = Array.from({ length: count }, (_, i) => q(`small-${i}`, "single", "mock", "示例"));
    const smallBp: Blueprint = {
      ...bp,
      passLine,
      sections: [{ name: "示例", count, scoreEach: 1, source: "mixed", types: ["single"] }],
    };
    const assembled = assemble(smallBp, paper, () => 0);
    const s = new MockSession(smallBp, assembled.paper, assembled, 1_000_000);
    for (const question of assembled.paper.slice(0, correct)) s.setAnswer(question.id, question.answer, 1_001_000);
    s.submit(1_002_000);
    expect(s.score()).toMatchObject({ full: count, total: correct, percent, pass });
  });

  it("显示为 60% 但实际未达 60% 时不能因四舍五入判通过", () => {
    const paper = [q("weighted-1", "single", "mock", "示例"), q("weighted-2", "single", "mock", "示例")];
    const weightedBp: Blueprint = { ...bp, sections: [{ name: "示例", count: 2, scoreEach: 1, source: "mixed", types: ["single"] }] };
    const s = new MockSession(weightedBp, paper, {
      sectionOf: new Map(paper.map((question) => [question.id, "示例"])),
      scoreOf: new Map([[paper[0].id, 1499], [paper[1].id, 1001]]),
    }, 1_000_000);
    s.setAnswer(paper[0].id, paper[0].answer, 1_001_000);
    s.submit(1_002_000);
    expect(s.score()).toMatchObject({ full: 2500, total: 1499, percent: 60, pass: false });
  });

  it("实际满分为 0 的试卷不产生及格结果", () => {
    const zeroBp: Blueprint = { ...bp, passLine: 0, sections: [] };
    const s = new MockSession(zeroBp, [], { sectionOf: new Map(), scoreOf: new Map() }, 1_000_000);
    s.submit(1_001_000);
    expect(s.score()).toMatchObject({ full: 0, total: 0, percent: 0, pass: false });
  });

  it("自动交卷边界", () => {
    const { s, start } = build();
    expect(s.shouldAutoSubmit(start)).toBe(false);
    expect(s.shouldAutoSubmit(start + 3_600_001)).toBe(true);
    s.submit(start + 3_600_001);
    expect(s.shouldAutoSubmit(start + 3_600_002)).toBe(false);
  });
});
