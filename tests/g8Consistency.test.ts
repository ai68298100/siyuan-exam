import { describe, it, expect } from "vitest";
import { replay, activeWrongItems, streak, localDate } from "../src/core/replayer";
import { calibration, heatmap, hourly } from "../src/core/report";
import { weeklyAggregates, dailyTrend } from "../src/core/weekly";
import { buildPublicStats } from "../src/core/publicStats";
import { planToday } from "../src/core/planner";
import { makeQuestion } from "../src/core/blockTemplate";
import type { AttemptEvent, Question } from "../src/core/types";

// G8（docs/19 §6）跨入口一致性：同一份流水 fixture 喂给重算/报告/公开统计/计划
// 各个入口，"同一事实"（分母/对错/日界/在册错题）必须处处一致。

const NOW = new Date(2026, 9, 3, 12, 0).getTime(); // 2026-10-03 12:00 本地
const qs: Question[] = [
  makeQuestion({ type: "single", stem: "Q1", options: ["1", "2"], answer: "A", kp: "言语" }),
  makeQuestion({ type: "single", stem: "Q2", options: ["1", "2"], answer: "B", kp: "数量" }),
  makeQuestion({ type: "judge", stem: "Q3", answer: "对", kp: "判断" }),
];
let seq = 0;
const ev = (over: Partial<AttemptEvent>): AttemptEvent => ({
  v: 1,
  eid: `e${seq++}`,
  ts: NOW,
  qid: qs[0].id,
  kind: "practice",
  mode: "quick",
  verdict: "correct",
  myAnswer: "A",
  sessionId: "s1",
  examId: null,
  queue: "normal",
  device: "d",
  seq: seq,
  ...over,
});

// 固定 fixture：练习（含信心）×3、模考对/未答 ×2、背诵 ×1、挑战 ×1（不入错题本）
const events: AttemptEvent[] = [
  ev({ qid: qs[0].id, verdict: "correct", confidence: "sure" }),
  ev({ qid: qs[0].id, verdict: "correct", confidence: "sure" }),
  ev({ qid: qs[0].id, verdict: "wrong", myAnswer: "B", confidence: "guess" }),
  ev({ qid: qs[1].id, kind: "mock", verdict: "correct", examId: "r-1" }),
  ev({ qid: qs[2].id, kind: "mock", verdict: "not_attempted", myAnswer: null, examId: "r-1" }),
  ev({ qid: qs[2].id, kind: "recite", verdict: "correct", selfRating: 4 }),
  ev({ qid: "q-friend", mode: "challenge", verdict: "wrong" }),
];

const d = replay(events);

describe("G8 相同事实跨入口一致性", () => {
  it("分母口径：重算/校准/热力/时段/公开统计 对'有效作答'的计数一致", () => {
    // 事实（既有口径）：byQuestion 计入 practice/mock/recite/challenge 的客观作答 = 6；
    // not_attempted 不计。错题本则只吃 practice/mock 且豁免 challenge（challenge 隔离）
    const byQTotal = [...d.byQuestion.values()].reduce((n, s) => n + s.attempts, 0);
    expect(byQTotal).toBe(6);

    // 校准只吃 practice/mock：sure 2 对、guess 1 错
    const calib = calibration(events);
    const sure = calib.rows.find((r) => r.confidence === "sure")!;
    const guess = calib.rows.find((r) => r.confidence === "guess")!;
    expect(sure).toMatchObject({ attempts: 2, correct: 2, accuracy: 100 });
    expect(guess).toMatchObject({ attempts: 1, correct: 0, accuracy: 0 });
    expect(calib.unreported).toBe(2); // 模考对题 + 挑战错题均未报信心（kind=practice 既有口径）

    // 热力/时段/趋势 的日合计与 days 表一致
    const dayAttempts = d.days.get(localDate(NOW))!.attempts;
    expect(heatmap(d.days, new Date(NOW)).at(-1)!.count).toBe(dayAttempts);
    expect(dailyTrend(d.days, new Date(NOW), 7).at(-1)!.attempts).toBe(dayAttempts);
    const week = weeklyAggregates(d.days, new Date(NOW), 1);
    expect(week.at(-1)!.attempts).toBe(dayAttempts);
    expect(hourly(events).reduce((a, b) => a + b, 0)).toBe(6); // 7 事件 − 1 not_attempted
    expect(dayAttempts).toBe(6); // recite/challenge 也计日活动
  });

  it("错题事实：重算/activeWrong/公开统计 三处一致；challenge 隔离；streak 同源", () => {
    const actives = activeWrongItems(d);
    expect(actives.map((w) => w.qid)).toEqual([qs[0].id]); // 只有练习答错的 Q1 在册
    const publicStats = buildPublicStats(d, events, streak(d), NOW);
    expect(publicStats.activeWrong).toBe(actives.length);
    expect(publicStats.eliminated).toBe([...d.wrongbook.values()].filter((w) => w.status === "eliminated").length);
    expect(publicStats.attempts).toBe([...d.byQuestion.values()].reduce((n, s) => n + s.attempts, 0));
    expect(publicStats.streak).toBe(streak(d));
    expect(publicStats.streak).toBe(1);
  });

  it("计划入口：planToday 的错题回流集合与重算的 activeWrong 严格一致", () => {
    const activeIds = new Set(activeWrongItems(d).map((w) => w.qid));
    const wrongCounts = new Map(
      [...d.wrongbook.values()].filter((w) => w.status === "active").map((w) => [w.qid, w.wrongCount]),
    );
    const plan = planToday(
      {
        dailyGoal: 10,
        all: qs,
        wrongCounts,
        activeWrongIds: activeIds,
        wrongReasons: new Map(),
        examDate: null,
        rnd: () => 0,
      },
      new Date(NOW),
    );
    // 计划队列中来自错题回流的每一题都必须在册（不会混入 challenge/已消灭题）
    const inPlan = plan.queue.filter((q) => activeIds.has(q.id));
    expect(plan.queue.length).toBeGreaterThan(0);
    expect(inPlan.length).toBeGreaterThan(0);
    for (const q of plan.queue) {
      if (activeIds.has(q.id)) expect(wrongCounts.get(q.id)).toBeGreaterThan(0);
    }
  });
});
