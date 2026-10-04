import { describe, it, expect } from "vitest";
import { nextActionFactLines, buildNextActionMessages, type NextActionFactsInput } from "../src/ai/nextAction";

const base = (over: Partial<NextActionFactsInput> = {}): NextActionFactsInput => ({
  windowLabel: "今日",
  capacity: { minutes: 25, low: 18, high: 34, sourced: true },
  openActions: [
    { detail: "重练：资料分析/增长率", kind: "redo", ageDays: 2 },
    { detail: "补笔记：比重 vs 比例", kind: "note", ageDays: 0 },
  ],
  weakKp: [{ kp: "资料分析/增长率", accuracy: 55, attempts: 9 }],
  wrongInBook: 14,
  recentAttempts: 32,
  recentAccuracy: 72,
  ...over,
});

describe("117-02 下一行动事实行", () => {
  it("容量/行动/弱项/在册/近期逐行如实；行动超 5 条截断计数", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ detail: `行动${i}`, kind: "redo", ageDays: i }));
    const lines = nextActionFactLines(base({ openActions: many })).join("\n");
    expect(lines).toContain("今日可用容量：约 25 分钟（区间 18-34）");
    expect(lines).toContain("开放行动〔redo〕：行动0（搁置 0 天）");
    expect(lines).toContain("另有开放行动 2 条未列出");
    expect(lines).toContain("弱项考点〔资料分析/增长率〕：9 题中未掌握比例 55%");
    expect(lines).toContain("错题在册：14 题");
    expect(lines).toContain("近期表现：今日作答 32 题，正确率 72%");
    expect(lines).toContain("以上为全部事实");
  });

  it("容量缺失：明说不排分钟；行动/弱项为空显式说明", () => {
    const lines = nextActionFactLines(
      base({ capacity: null, openActions: [], weakKp: [], recentAttempts: 0, recentAccuracy: null }),
    ).join("\n");
    expect(lines).toContain("缺历史口径，无法估量（只给任务顺序，不排分钟）");
    expect(lines).toContain("开放行动：无");
    expect(lines).toContain("弱项考点：窗口内无可列项");
    expect(lines).toContain("近期表现：今日无作答记录");
  });

  it("容量含默认值时说明口径偏粗；弱项样本 <5 标注仅作线索", () => {
    const lines = nextActionFactLines(
      base({
        capacity: { minutes: 20, low: 15, high: 28, sourced: false },
        weakKp: [{ kp: "数量关系", accuracy: 40, attempts: 3 }],
      }),
    ).join("\n");
    expect(lines).toContain("含默认值（部分题型缺历史，容量口径偏粗）");
    expect(lines).toContain("样本 <5 仅作线索");
  });

  it("system 约束与红线：总负荷不超容量、缺容量不排分钟、完成定义、不虚构题源", () => {
    const sys = buildNextActionMessages(base())[0].content;
    expect(sys).toContain("总负荷不得超过给定容量");
    expect(sys).toContain("容量缺失时明说");
    expect(sys).toContain("完成定义");
    expect(sys).toContain("不得虚构题源数量");
    expect(sys).toContain("建议非指令");
    const user = buildNextActionMessages(base())[1].content;
    expect(user).toContain("今日可用容量：约 25 分钟");
  });
});
