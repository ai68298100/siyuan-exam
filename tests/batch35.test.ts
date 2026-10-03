import { describe, it, expect } from "vitest";
import { coverageStats } from "../src/core/bankHealth";
import { mockSectionsToCsv, mockHistoryToCsv } from "../src/core/exportMd";
import { AttemptLog, MemoryStorage } from "../src/core/attemptLog";
import { replay } from "../src/core/replayer";
import { makeQuestion } from "../src/core/blockTemplate";
import type { AttemptEvent } from "../src/core/types";

describe("43-04 覆盖概览（三五批）", () => {
  it("题型分布/来源 distinct 与缺失/考点顶层聚合/短解析", () => {
    const mk = (id: string, over: Partial<import("../src/core/types").Question>) =>
      ({ ...makeQuestion({ type: "single", stem: id, options: ["1", "2"], answer: "A" }), id, ...over });
    const qs = [
      mk("a", { type: "single", source: "2023 国考", kp: "资料/比重", analysis: "这条解析的长度足够超过十个字" }),
      mk("b", { type: "single", source: "2023 国考", kp: "资料/增长" }),
      mk("c", { type: "judge", kp: "言语", analysis: "短" }), // 短解析
      mk("d", { type: "fill" }), // 缺来源缺考点
    ];
    const c = coverageStats(qs as never[]);
    expect(c.byType).toEqual([{ type: "single", count: 2 }, { type: "judge", count: 1 }, { type: "fill", count: 1 }]);
    expect(c.sources).toBe(1);
    expect(c.sourceMissing).toBe(2); // c、d 均缺来源
    expect(c.kpTops).toEqual([{ top: "资料", count: 2 }, { top: "言语", count: 1 }]);
    expect(c.kpMissing).toBe(1);
    expect(c.shortAnalysis).toBe(1);
  });

  it("空题库：全零不抛错", () => {
    const c = coverageStats([]);
    expect(c.sources).toBe(0);
    expect(c.byType).toHaveLength(0);
  });
});

describe("114-01 受助标记流水往返（三五批）", () => {
  it("AttemptEvent.help 落盘/读回保留；replayer 不受未知扩展字段影响", async () => {
    let t = 1_700_000_000_000;
    const clock = () => (t += 1_000);
    const log = new AttemptLog(new MemoryStorage(), "k", clock);
    await log.load("d-help");
    const e1 = log.append({ qid: "q1", kind: "practice", mode: "wrong", verdict: "wrong", myAnswer: "A", sessionId: "s1", queue: "wrong" });
    const e2 = log.append({ qid: "q1", kind: "practice", mode: "wrong", verdict: "correct", myAnswer: "B", sessionId: "s1", queue: "wrong", help: "explain" });
    const e3 = log.append({ qid: "q1", kind: "practice", mode: "wrong", verdict: "correct", myAnswer: "B", sessionId: "s1", queue: "wrong", help: "explain" });
    expect((e1 as AttemptEvent).help).toBeUndefined();
    expect((e2 as AttemptEvent).help).toBe("explain");
    expect((e3 as AttemptEvent).help).toBe("explain");
    const r = replay(log.all());
    expect(r.wrongbook.get("q1")!.status).toBe("eliminated"); // 错→对→对 消灭语义不受影响
  });
});

describe("45-08 收口：模考成绩 CSV（三七批）", () => {
  it("分段/历史 CSV 与雷达/折线同一数据快照", () => {
    const sec = mockSectionsToCsv([
      { name: "言语", score: 8, full: 10, correct: 8, total: 10 },
      { name: "数量", score: 3, full: 10, correct: 3, total: 10 },
    ]);
    expect(sec).toContain("模块,得分,满分,答对,题数,正确率%");
    expect(sec).toContain("言语,8,10,8,10,80");
    expect(sec).toContain("数量,3,10,3,10,30");
    const hist = mockHistoryToCsv([{ name: "模考一", percent: 62 }, { name: "模考二", percent: 71 }]);
    expect(hist).toContain("考试,得分率%");
    expect(hist).toContain("模考二,71");
  });
});
