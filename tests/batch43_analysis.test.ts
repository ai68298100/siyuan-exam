import { describe, it, expect } from "vitest";
import { makeQuestion } from "../src/core/blockTemplate";
import type { AttemptEvent, Question } from "../src/core/types";
import {
  analyzeQuestionUsage,
  exportItemAnalysisCsv,
  MIN_ITEM_ANALYSIS_SAMPLE,
} from "../src/core/itemAnalysis";

const mockEvent = (over: Partial<AttemptEvent>): AttemptEvent => ({
  v: 1,
  eid: "e-" + Math.random().toString(36).slice(2),
  ts: 1_700_000_000_000,
  qid: "q1",
  kind: "practice",
  mode: "quick",
  verdict: "correct",
  myAnswer: "A",
  sessionId: "s1",
  queue: "normal",
  device: "dev1",
  seq: 1,
  timeMs: 5000,
  ...over,
});

describe("43-02 题目使用分析与干扰项效率（四三批分析深化）", () => {
  const singleQ: Question = makeQuestion({
    type: "single",
    stem: "光的三原色是哪三种？",
    options: ["红绿蓝", "红黄蓝", "黑白灰", "品红青黄"],
    answer: "A",
  });

  describe("analyzeQuestionUsage 基础指标与低样本判定", () => {
    it("无任何作答记录时，各项指标安全归零且标记低样本", () => {
      const rep = analyzeQuestionUsage(singleQ, []);
      expect(rep.totalAttempts).toBe(0);
      expect(rep.correctCount).toBe(0);
      expect(rep.wrongCount).toBe(0);
      expect(rep.accuracy).toBe(0);
      expect(rep.avgTimeMs).toBe(0);
      expect(rep.isLowSample).toBe(true);
      expect(rep.lastAttemptAt).toBeNull();
    });

    it("作答次数不足门槛（< 5）时，正确计算指标并标记 isLowSample=true", () => {
      const events: AttemptEvent[] = [
        mockEvent({ qid: singleQ.id, verdict: "correct", myAnswer: "A", timeMs: 4000, ts: 100 }),
        mockEvent({ qid: singleQ.id, verdict: "wrong", myAnswer: "B", timeMs: 6000, ts: 200 }),
        mockEvent({ qid: singleQ.id, verdict: "correct", myAnswer: "A", timeMs: 8000, ts: 300 }),
      ];

      const rep = analyzeQuestionUsage(singleQ, events);
      expect(rep.totalAttempts).toBe(3);
      expect(rep.correctCount).toBe(2);
      expect(rep.wrongCount).toBe(1);
      expect(rep.accuracy).toBe(67); // 2 / 3
      expect(rep.avgTimeMs).toBe(6000); // (4000 + 6000 + 8000) / 3
      expect(rep.isLowSample).toBe(true);
      expect(rep.lastAttemptAt).toBe(300);
    });

    it("作答次数达到门槛（>= 5）时，isLowSample 为 false", () => {
      const events: AttemptEvent[] = Array.from({ length: MIN_ITEM_ANALYSIS_SAMPLE }, (_, i) =>
        mockEvent({ qid: singleQ.id, verdict: i % 2 === 0 ? "correct" : "wrong", myAnswer: i % 2 === 0 ? "A" : "B", timeMs: 2000 }),
      );

      const rep = analyzeQuestionUsage(singleQ, events);
      expect(rep.totalAttempts).toBe(MIN_ITEM_ANALYSIS_SAMPLE);
      expect(rep.isLowSample).toBe(false);
    });

    it("跳过题目计入 skippedCount 与 skipRate，不影响正确率分母", () => {
      const events: AttemptEvent[] = [
        mockEvent({ qid: singleQ.id, verdict: "correct", myAnswer: "A" }),
        mockEvent({ qid: singleQ.id, verdict: "wrong", myAnswer: "B" }),
        mockEvent({ qid: singleQ.id, verdict: "not_attempted", myAnswer: null }),
        mockEvent({ qid: singleQ.id, verdict: "not_attempted", myAnswer: null }),
      ];

      const rep = analyzeQuestionUsage(singleQ, events);
      expect(rep.totalAttempts).toBe(2); // 仅有效作答
      expect(rep.skippedCount).toBe(2);
      expect(rep.accuracy).toBe(50); // 1 / 2
      expect(rep.skipRate).toBe(50); // 2 / 4
    });
  });

  describe("选项选择率与干扰项效率分析（OptionPickStat）", () => {
    it("正确计算各选项选择比例，并标记有效与零命中干扰项", () => {
      // 构造 10 次作答（充足样本）:
      // A (正确): 6次 (60%)
      // B (干扰项): 3次 (30%)
      // C (干扰项): 1次 (10%)
      // D (干扰项): 0次 (0%) -> 零命中干扰项
      const events: AttemptEvent[] = [
        ...Array.from({ length: 6 }, () => mockEvent({ qid: singleQ.id, verdict: "correct" as const, myAnswer: "A" })),
        ...Array.from({ length: 3 }, () => mockEvent({ qid: singleQ.id, verdict: "wrong" as const, myAnswer: "B" })),
        ...Array.from({ length: 1 }, () => mockEvent({ qid: singleQ.id, verdict: "wrong" as const, myAnswer: "C" })),
      ];

      const rep = analyzeQuestionUsage(singleQ, events);
      expect(rep.options).toHaveLength(4);

      // A: 正确答案
      const optA = rep.options[0];
      expect(optA.letter).toBe("A");
      expect(optA.count).toBe(6);
      expect(optA.pct).toBe(60);
      expect(optA.isCorrect).toBe(true);
      expect(optA.isDistractor).toBe(false);
      expect(optA.isDeadDistractor).toBe(false);

      // B: 有效干扰项
      const optB = rep.options[1];
      expect(optB.letter).toBe("B");
      expect(optB.count).toBe(3);
      expect(optB.pct).toBe(30);
      expect(optB.isCorrect).toBe(false);
      expect(optB.isDistractor).toBe(true);
      expect(optB.isDeadDistractor).toBe(false);

      // C: 有效干扰项
      const optC = rep.options[2];
      expect(optC.letter).toBe("C");
      expect(optC.count).toBe(1);
      expect(optC.pct).toBe(10);
      expect(optC.isDeadDistractor).toBe(false);

      // D: 零命中干扰项（Dead Distractor）
      const optD = rep.options[3];
      expect(optD.letter).toBe("D");
      expect(optD.count).toBe(0);
      expect(optD.pct).toBe(0);
      expect(optD.isCorrect).toBe(false);
      expect(optD.isDistractor).toBe(true);
      expect(optD.isDeadDistractor).toBe(true);

      expect(rep.effectiveDistractorsCount).toBe(2); // B, C
      expect(rep.deadDistractorsCount).toBe(1); // D
    });

    it("样本不足时不将零选择误判为死干扰项（isDeadDistractor 保持 false）", () => {
      const events: AttemptEvent[] = [
        mockEvent({ qid: singleQ.id, verdict: "correct", myAnswer: "A" }),
      ];

      const rep = analyzeQuestionUsage(singleQ, events);
      const optD = rep.options.find((o) => o.letter === "D");
      expect(optD?.count).toBe(0);
      expect(optD?.isDeadDistractor).toBe(false); // 低样本不误报
    });

    it("多选题逐项统计被选择的字母比例", () => {
      const multiQ: Question = makeQuestion({
        type: "multiple",
        stem: "属于哺乳动物的是？",
        options: ["大熊猫", "蓝鲸", "麻雀", "扬子鳄"],
        answer: "AB",
      });

      const events: AttemptEvent[] = [
        mockEvent({ qid: multiQ.id, verdict: "correct", myAnswer: "AB" }),
        mockEvent({ qid: multiQ.id, verdict: "wrong", myAnswer: "AC" }),
      ];

      const rep = analyzeQuestionUsage(multiQ, events);
      const optA = rep.options.find((o) => o.letter === "A");
      const optB = rep.options.find((o) => o.letter === "B");
      const optC = rep.options.find((o) => o.letter === "C");

      expect(optA?.count).toBe(2);
      expect(optA?.pct).toBe(100);
      expect(optA?.isCorrect).toBe(true);

      expect(optB?.count).toBe(1);
      expect(optB?.pct).toBe(50);
      expect(optB?.isCorrect).toBe(true);

      expect(optC?.count).toBe(1);
      expect(optC?.pct).toBe(50);
      expect(optC?.isDistractor).toBe(true);
    });
  });

  describe("错因聚合与 exportItemAnalysisCsv", () => {
    it("正确聚合题目的错因分布", () => {
      const events: AttemptEvent[] = [
        mockEvent({ qid: singleQ.id, verdict: "wrong", myAnswer: "B" }),
        mockEvent({ qid: singleQ.id, verdict: "wrong", myAnswer: "C" }),
      ];
      const wrongReasonMap = new Map([
        [singleQ.id, "careless"],
      ]);

      const rep = analyzeQuestionUsage(singleQ, events, { wrongReasonMap });
      expect(rep.reasonCounts.careless).toBe(2);
    });

    it("exportItemAnalysisCsv 正确生成带 BOM 的结构化 CSV 清单", () => {
      const events: AttemptEvent[] = [
        mockEvent({ qid: singleQ.id, verdict: "correct", myAnswer: "A", timeMs: 3000 }),
        mockEvent({ qid: singleQ.id, verdict: "wrong", myAnswer: "B", timeMs: 5000 }),
      ];

      const rep = analyzeQuestionUsage(singleQ, events);
      const csv = exportItemAnalysisCsv(rep);

      expect(csv.startsWith("\uFEFF")).toBe(true);
      expect(csv).toContain(`"题目ID","${singleQ.id}"`);
      expect(csv).toContain(`"正确率","50%"`);
      expect(csv).toContain("选项,类型,选择次数,选择占比,选项内容,状态");
      expect(csv).toContain('A,正确答案,1,50%,"红绿蓝",有效');
      expect(csv).toContain('B,干扰项,1,50%,"红黄蓝",有效');
    });
  });
});
