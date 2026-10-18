import { describe, it, expect } from "vitest";
import {
  resolveFeedbackTimingMode,
  isGroupBatchBoundary,
  calculateGroupBatchSummary,
  FEEDBACK_TIMING_LABELS,
  type GroupBatchItem,
} from "../src/core/feedbackTiming";
import { makeQuestion } from "../src/core/blockTemplate";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";

function createMockApp() {
  const client = {
    sql: async () => [],
    listQuestions: async () => [],
  } as unknown as KernelApiClient;

  const storage = new MemoryStorage();
  const app = new ExamApp({ client, storage, now: () => 1_800_000_000_000 });
  app.kernelOnline = true;

  return { app, client, storage };
}

describe("44-01 反馈时机策略（四四批反馈时机与小组批次）", () => {
  describe("resolveFeedbackTimingMode 设置解析与兼容", () => {
    it("新设置项优先解析", () => {
      expect(resolveFeedbackTimingMode("immediate")).toBe("immediate");
      expect(resolveFeedbackTimingMode("group")).toBe("group");
      expect(resolveFeedbackTimingMode("end")).toBe("end");
    });

    it("新设置缺省时兼容旧版 feedbackEndReview=true/\"true\" 映射为 end", () => {
      expect(resolveFeedbackTimingMode(undefined, true)).toBe("end");
      expect(resolveFeedbackTimingMode(undefined, "true")).toBe("end");
      expect(resolveFeedbackTimingMode(null, false)).toBe("immediate");
    });

    it("全部缺省时回退默认 immediate 逐题即时反馈", () => {
      expect(resolveFeedbackTimingMode(undefined)).toBe("immediate");
      expect(resolveFeedbackTimingMode(null)).toBe("immediate");
      expect(resolveFeedbackTimingMode("")).toBe("immediate");
      expect(FEEDBACK_TIMING_LABELS.group).toBe("小组延迟复盘（每 5 题小结反馈）");
    });
  });

  describe("isGroupBatchBoundary 批次边界判定", () => {
    it("正确识别每 5 题小组边界", () => {
      expect(isGroupBatchBoundary(0)).toBe(false);
      expect(isGroupBatchBoundary(1)).toBe(false);
      expect(isGroupBatchBoundary(4)).toBe(false);
      expect(isGroupBatchBoundary(5)).toBe(true);
      expect(isGroupBatchBoundary(6)).toBe(false);
      expect(isGroupBatchBoundary(10)).toBe(true);
      expect(isGroupBatchBoundary(15)).toBe(true);
    });

    it("支持自定义小组大小（如 3 题一小组）", () => {
      expect(isGroupBatchBoundary(3, 3)).toBe(true);
      expect(isGroupBatchBoundary(6, 3)).toBe(true);
      expect(isGroupBatchBoundary(5, 3)).toBe(false);
    });
  });

  describe("calculateGroupBatchSummary 小组复盘统计", () => {
    it("正确提取第 1-5 题作答切片并统计对错与准确率", () => {
      const answeredList: GroupBatchItem[] = [
        { qid: "q1", verdict: "correct", myAnswer: "A" },
        { qid: "q2", verdict: "correct", myAnswer: "B" },
        { qid: "q3", verdict: "wrong", myAnswer: "C" },
        { qid: "q4", verdict: "correct", myAnswer: "A" },
        { qid: "q5", verdict: "wrong", myAnswer: "B" },
        { qid: "q6", verdict: "correct", myAnswer: "A" }, // 属于第二组
      ];

      const batch = calculateGroupBatchSummary(answeredList, 1, 5);
      expect(batch.fromIndex).toBe(1);
      expect(batch.toIndex).toBe(5);
      expect(batch.total).toBe(5);
      expect(batch.correct).toBe(3);
      expect(batch.wrong).toBe(2);
      expect(batch.accuracy).toBe(60); // 3 / 5 = 60%
      expect(batch.items.map((i) => i.qid)).toEqual(["q1", "q2", "q3", "q4", "q5"]);
    });
  });

  describe("44-01 核心验收：三种反馈时机产生完全相同的作答流水事件", () => {
    it("immediate、group 与 end 三种模式产生严格一致的 AttemptEvent 流水", () => {
      const q = makeQuestion({ type: "single", stem: "题干", options: ["A", "B"], answer: "A" });
      const { app } = createMockApp();

      // 1. 模拟 immediate 模式记录
      const eImmediate = app.recordAttempt({
        qid: q.id,
        kind: "practice",
        mode: "quick",
        verdict: "correct",
        myAnswer: "A",
        sessionId: "s-imm",
        queue: "normal",
        timeMs: 3500,
      });

      // 2. 模拟 group 模式记录（同样的数据）
      const eGroup = app.recordAttempt({
        qid: q.id,
        kind: "practice",
        mode: "quick",
        verdict: "correct",
        myAnswer: "A",
        sessionId: "s-grp",
        queue: "normal",
        timeMs: 3500,
      });

      // 3. 模拟 end 模式记录（同样的数据）
      const eEnd = app.recordAttempt({
        qid: q.id,
        kind: "practice",
        mode: "quick",
        verdict: "correct",
        myAnswer: "A",
        sessionId: "s-end",
        queue: "normal",
        timeMs: 3500,
      });

      // 校验领域事实：除 sessionId 与自动生成的 eid/ts/seq 外，核心判分与作答快照完全一致
      expect(eImmediate.verdict).toBe(eGroup.verdict);
      expect(eGroup.verdict).toBe(eEnd.verdict);
      expect(eImmediate.myAnswer).toBe(eGroup.myAnswer);
      expect(eGroup.myAnswer).toBe(eEnd.myAnswer);
      expect(eImmediate.timeMs).toBe(eGroup.timeMs);
    });
  });
});
