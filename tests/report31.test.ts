import { describe, it, expect } from "vitest";
import { confidentWrongList } from "../src/core/report";
import { trendToCsv, heatmapToCsv, hourlyToCsv } from "../src/core/exportMd";
import { PracticeSession } from "../src/core/session";
import { makeQuestion } from "../src/core/blockTemplate";
import type { AttemptEvent } from "../src/core/types";

const ev = (over: Partial<AttemptEvent>): AttemptEvent =>
  ({
    v: 2, eid: "e", ts: 1_000, qid: "q1", kind: "practice", mode: "single",
    verdict: "wrong", myAnswer: "A", sessionId: "s1", queue: "normal", device: "d", seq: 1,
    confidence: "sure",
    ...over,
  }) as AttemptEvent;

describe("confident-wrong 下钻（44-02 lite，三一批）", () => {
  it("只收 practice/mock 的 sure-wrong；按 qid 去重保留最近一次；时间倒序", () => {
    const list = confidentWrongList([
      ev({ eid: "a", qid: "q1", ts: 100 }),
      ev({ eid: "b", qid: "q1", ts: 300 }),                       // 同题更近 → 覆盖
      ev({ eid: "c", qid: "q2", ts: 200, confidence: "guess" }),  // 非 sure → 排除
      ev({ eid: "d", qid: "q3", ts: 400, verdict: "correct" as AttemptEvent["verdict"] }), // 非错 → 排除
      ev({ eid: "e", qid: "q4", ts: 500, kind: "recite" }),       // recite 自评不参与
      ev({ eid: "f", qid: "q5", ts: 600 }),
    ]);
    expect(list.map((x) => x.qid)).toEqual(["q5", "q1"]);
    expect(list[1].ts).toBe(300);
    expect(list[1].myAnswer).toBe("A");
  });

  it("空流水 → 空清单", () => {
    expect(confidentWrongList([])).toHaveLength(0);
  });
});

describe("submit 已答位置守卫（兜底审计，三一批）", () => {
  it("K 回退到已答位置再提交返回 null 不重复记录；重排队错题在新位置可重答", () => {
    const qs = [
      makeQuestion({ type: "judge", stem: "题1", options: [], answer: "对" }),
      makeQuestion({ type: "judge", stem: "题2", options: [], answer: "错" }),
    ];
    const s = new PracticeSession(qs, "single", undefined, () => 1);
    s.setDraft(qs[0].id, "对");
    expect(s.submit("对", 10)).not.toBeNull(); // pos0 首答
    s.prev(); // 回到 pos0（已答）
    expect(s.submit("错", 10)).toBeNull();     // 守卫：不重计
    expect(s.answered).toHaveLength(1);
    s.next(); // 前进回 pos1（未答）
    expect(s.submit("错", 10)).not.toBeNull(); // 正常作答
    expect(s.answered).toHaveLength(2);
  });
});

describe("图表 CSV 文本等价物（45-08，三一批）", () => {
  it("trend/heatmap/hourly CSV：表头+数据行与 SVG 同一数据", () => {
    const trend = trendToCsv([{ date: "2026-10-01", attempts: 12 }, { date: "2026-10-02", attempts: 3 }]);
    expect(trend).toContain("日期,作答题数");
    expect(trend).toContain("2026-10-01,12");
    const heat = heatmapToCsv([{ date: "2026-10-01", count: 5 }]);
    expect(heat).toContain("2026-10-01,5");
    const hourly = hourlyToCsv([0, 2, 0]);
    expect(hourly).toContain("01:00-01:59,2");
    expect(hourly.startsWith("\uFEFF")).toBe(true); // BOM：Excel 中文不乱码
  });
});
