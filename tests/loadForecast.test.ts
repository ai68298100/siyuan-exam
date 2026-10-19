import { describe, it, expect } from "vitest";
import {
  estimateNextDueMs,
  forecastFutureLoad,
  exportLoadForecastCsv,
} from "../src/core/loadForecast";
import type { Question, AttemptEvent } from "../src/core/types";

const makeQ = (id: string, blockId?: string): Question => ({
  id,
  type: "single",
  stem: `Stem ${id}`,
  options: ["A", "B"],
  answer: "A",
  score: 1,
  origin: "import",
  batch: "b1",
  review: "verified",
  hash: `h-${id}`,
  blockId,
});

const makeAttempt = (qid: string, verdict: "correct" | "wrong" | "not_attempted", ts: number): AttemptEvent => ({
  eid: `e-${qid}-${ts}`,
  ts,
  qid,
  kind: "practice",
  mode: "single",
  verdict,
  myAnswer: verdict === "correct" ? "A" : "B",
  sessionId: "s1",
});

describe("39-06 遗忘曲线、未来到期负荷预测与建议每日量", () => {
  const baseTime = Date.parse("2026-10-19T10:00:00Z");

  describe("estimateNextDueMs 间隔到期估算", () => {
    it("无事件返回 null", () => {
      expect(estimateNextDueMs([], baseTime)).toBeNull();
    });

    it("最后一次答错，间隔收缩为 24 小时", () => {
      const events = [
        makeAttempt("q1", "correct", baseTime - 2 * 86_400_000),
        makeAttempt("q1", "wrong", baseTime - 86_400_000),
      ];
      const due = estimateNextDueMs(events, baseTime);
      expect(due).toBe(baseTime - 86_400_000 + 86_400_000);
    });

    it("连续答对时间隔递增（1.8^streak）", () => {
      const e1 = [makeAttempt("q1", "correct", baseTime - 86_400_000)];
      // streak=1 -> interval=1天
      expect(estimateNextDueMs(e1, baseTime)).toBe(baseTime);

      const e2 = [
        makeAttempt("q1", "wrong", baseTime - 5 * 86_400_000),
        makeAttempt("q1", "correct", baseTime - 3 * 86_400_000),
        makeAttempt("q1", "correct", baseTime - 86_400_000),
      ];
      // streak=2 -> interval=round(1.8^1)=2天
      expect(estimateNextDueMs(e2, baseTime)).toBe(baseTime - 86_400_000 + 2 * 86_400_000);
    });
  });

  describe("forecastFutureLoad 负荷预测与建议量", () => {
    it("空题库与空作答安全返回零负荷", () => {
      const r = forecastFutureLoad([], [], { now: baseTime, windowDays: 7 });
      expect(r.windowDays).toBe(7);
      expect(r.backlogCount).toBe(0);
      expect(r.totalDueInWindow).toBe(0);
      expect(r.recommendedDaily).toBe(0);
      expect(r.calibers.totalQuestions).toBe(0);
      expect(r.calibers.practicedQuestions).toBe(0);
      expect(r.days).toHaveLength(7);
    });

    it("今天已到期的题严格归入 backlog，不成为未来幽灵数据", () => {
      const q1 = makeQ("q1");
      // 3 天前答错，2 天前已到期
      const atts = [makeAttempt("q1", "wrong", baseTime - 3 * 86_400_000)];
      const r = forecastFutureLoad([q1], atts, { now: baseTime, windowDays: 7 });
      expect(r.backlogCount).toBe(1);
      // 未来 7 天的每日预测中，q1 不得重复出现
      for (const d of r.days) {
        expect(d.dueCount).toBe(0);
        expect(d.cumulativeDue).toBe(1); // 累积包含积压
      }
    });

    it("未来到期的题按到期日分配到相应偏移天数", () => {
      const q1 = makeQ("q1");
      // 今天答对 1 次（streak=1 -> 间隔 1 天 -> 明天到期）
      const atts = [makeAttempt("q1", "correct", baseTime)];
      const r = forecastFutureLoad([q1], atts, { now: baseTime, windowDays: 7 });
      expect(r.backlogCount).toBe(0);
      expect(r.days[0].dayOffset).toBe(1); // 明天
      expect(r.days[0].dueCount).toBe(1);
      expect(r.days[0].qids).toContain("q1");
      expect(r.days[1].dueCount).toBe(0);
    });

    it("双口径统计：已练题与未练题明确区分，未练题不进复习预测", () => {
      const qs = [makeQ("q1"), makeQ("q2"), makeQ("q3")];
      const atts = [makeAttempt("q1", "correct", baseTime)];
      const r = forecastFutureLoad(qs, atts, { now: baseTime });
      expect(r.calibers.totalQuestions).toBe(3);
      expect(r.calibers.practicedQuestions).toBe(1);
      expect(r.calibers.unpracticedQuestions).toBe(2);
    });

    it("直接传入的卡片到期时间优先于作答估算", () => {
      const q1 = makeQ("q1", "block-1");
      const atts = [makeAttempt("q1", "wrong", baseTime - 3 * 86_400_000)]; // 否则是积压
      // 直接指定 2 天后到期
      const cardDues = new Map([["block-1", baseTime + 2 * 86_400_000]]);
      const r = forecastFutureLoad([q1], atts, { now: baseTime, cardDues });
      expect(r.calibers.cardDueCount).toBe(1);
      expect(r.backlogCount).toBe(0);
    });

    it("建议每日做题量平摊负荷并夹取在上下限内", () => {
      const qs: Question[] = [];
      const atts: AttemptEvent[] = [];
      // 构造 60 道积压题
      for (let i = 0; i < 60; i++) {
        const id = `q${i}`;
        qs.push(makeQ(id));
        atts.push(makeAttempt(id, "wrong", baseTime - 3 * 86_400_000));
      }
      const r = forecastFutureLoad(qs, atts, {
        now: baseTime,
        windowDays: 7,
        maxDailyCap: 20,
        minDailyFloor: 5,
      });
      // 60 / 7 = 9题/天，在 [5, 20] 之间
      expect(r.recommendedDaily).toBe(9);

      // 超上限测试
      const r2 = forecastFutureLoad(qs, atts, {
        now: baseTime,
        windowDays: 2,
        maxDailyCap: 15,
      });
      expect(r2.recommendedDaily).toBe(15);
    });
  });

  describe("exportLoadForecastCsv 文本等价物", () => {
    it("导出包含 UTF-8 BOM、各项口径统计与每日明细", () => {
      const qs = [makeQ("q1")];
      const atts = [makeAttempt("q1", "correct", baseTime)];
      const r = forecastFutureLoad(qs, atts, { now: baseTime, windowDays: 7 });
      const csv = exportLoadForecastCsv(r);
      expect(csv.startsWith("\uFEFF")).toBe(true);
      expect(csv).toContain("未来复习到期负荷预测与建议量");
      expect(csv).toContain("预测窗口,近 7 天");
      expect(csv).toContain("今日积压,0,0,0");
      expect(csv).toContain("建议每日复习量");
    });
  });
});
