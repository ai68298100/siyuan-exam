import { describe, it, expect } from "vitest";
import {
  calculateItemScore,
  calculateSectionScore,
  applyScoreRounding,
  simulateAllPolicySamples,
  SCORING_POLICY_SAMPLE_CASES,
  type ScoringPolicy,
} from "../src/core/scoringPolicy";
import { makeQuestion } from "../src/core/blockTemplate";
import { MockSession, type Blueprint } from "../src/core/mock";

describe("55-04 版本化评分政策与样例验算（五五批）", () => {
  describe("calculateItemScore 单题计分", () => {
    it("standard 标准政策：全对满分，错题 0 分，未作答 0 分", () => {
      const policy: ScoringPolicy = { v: 1, kind: "standard" };
      expect(calculateItemScore({ scoreEach: 2, verdict: "correct" }, policy)).toBe(2);
      expect(calculateItemScore({ scoreEach: 2, verdict: "wrong" }, policy)).toBe(0);
      expect(calculateItemScore({ scoreEach: 2, verdict: "wrong", factor: 0.5 }, policy)).toBe(0);
      expect(calculateItemScore({ scoreEach: 2, verdict: "not_attempted" }, policy)).toBe(0);
    });

    it("partial_indefinite 政策：部分分按比例给分，错选 0 分", () => {
      const policy: ScoringPolicy = { v: 1, kind: "partial_indefinite" };
      expect(calculateItemScore({ scoreEach: 2, verdict: "correct", factor: 1 }, policy)).toBe(2);
      expect(calculateItemScore({ scoreEach: 2, verdict: "wrong", factor: 0.5 }, policy)).toBe(1);
      expect(calculateItemScore({ scoreEach: 2, verdict: "wrong", factor: 0 }, policy)).toBe(0);
    });

    it("penalty 倒扣分政策：答错扣分，未作答 0 分不倒扣", () => {
      const policy: ScoringPolicy = { v: 1, kind: "penalty", penaltyRatio: 0.5 };
      expect(calculateItemScore({ scoreEach: 2, verdict: "correct" }, policy)).toBe(2);
      expect(calculateItemScore({ scoreEach: 2, verdict: "wrong" }, policy)).toBe(-1); // 扣 50%
      expect(calculateItemScore({ scoreEach: 4, verdict: "wrong" }, policy)).toBe(-2);
      expect(calculateItemScore({ scoreEach: 2, verdict: "not_attempted" }, policy)).toBe(0); // 未答不扣分
    });
  });

  describe("applyScoreRounding 舍入取整策略", () => {
    it("raw、round、floor、ceil 正确执行数值舍入", () => {
      expect(applyScoreRounding(2.345, "raw")).toBe(2.35);
      expect(applyScoreRounding(2.6, "round")).toBe(3);
      expect(applyScoreRounding(2.4, "round")).toBe(2);
      expect(applyScoreRounding(2.9, "floor")).toBe(2);
      expect(applyScoreRounding(2.1, "ceil")).toBe(3);
    });
  });

  describe("calculateSectionScore 模块与整卷得分计算", () => {
    it("默认 floorZero=true 保底总分不为负数", () => {
      const policy: ScoringPolicy = { v: 1, kind: "penalty", penaltyRatio: 1, floorZero: true };
      const items = [
        { scoreEach: 2, verdict: "correct" as const },
        { scoreEach: 2, verdict: "wrong" as const },
        { scoreEach: 2, verdict: "wrong" as const },
      ];
      // 2 - 2 - 2 = -2 -> 保底 0 分
      const res = calculateSectionScore(items, policy);
      expect(res.totalScore).toBe(0);
      expect(res.fullScore).toBe(6);
      expect(res.correctCount).toBe(1);
      expect(res.wrongCount).toBe(2);
    });

    it("floorZero=false 时允许负总分", () => {
      const policy: ScoringPolicy = { v: 1, kind: "penalty", penaltyRatio: 0.5, floorZero: false };
      const items = [
        { scoreEach: 2, verdict: "wrong" as const },
        { scoreEach: 2, verdict: "wrong" as const },
      ];
      // -1 - 1 = -2
      const res = calculateSectionScore(items, policy);
      expect(res.totalScore).toBe(-2);
    });
  });

  describe("simulateAllPolicySamples 样例验算模拟", () => {
    it("5 题标准样例卷在 4 种政策下模拟得分对比符合预期", () => {
      const sim = simulateAllPolicySamples(SCORING_POLICY_SAMPLE_CASES);

      expect(sim.standard).toBeDefined();
      expect(sim.partial_indefinite).toBeDefined();
      expect(sim.partial_all).toBeDefined();
      expect(sim.penalty).toBeDefined();

      // 基准题满分 10 分
      expect(sim.standard.fullScore).toBe(10);
      // 1. standard: 只有第 1 题全对得 2 分
      expect(sim.standard.totalScore).toBe(2);
      // 2. partial_indefinite: 题1得 2 分 + 题2多选少选得 1 分 = 3 分
      expect(sim.partial_indefinite.totalScore).toBe(3);
      // 3. partial_all: 题1得 2 分 + 题2得 1 分 + 题5多空得 1 分 = 4 分
      expect(sim.partial_all.totalScore).toBe(4);
      // 4. penalty: 题1得 2 分 - 题2扣 1 分 - 题3扣 1 分 - 题5扣 1 分 = -1 -> 保底 0 分
      expect(sim.penalty.totalScore).toBe(0);
    });
  });

  describe("MockSession 模考评分政策集成", () => {
    it("蓝图配置 penalty 评分政策时，模考交卷 score() 精确计算倒扣分并记录政策快照", () => {
      const q1 = makeQuestion({ type: "single", stem: "题1", options: ["A", "B"], answer: "A" });
      const q2 = makeQuestion({ type: "single", stem: "题2", options: ["A", "B"], answer: "B" });
      const q3 = makeQuestion({ type: "single", stem: "题3", options: ["A", "B"], answer: "C" });

      const bp: Blueprint = {
        id: "bp-penalty",
        name: "倒扣分模考",
        durationS: 3600,
        passLine: 60,
        shuffleOptions: false,
        sectionTimed: false,
        scoringPolicy: {
          v: 1,
          kind: "penalty",
          penaltyRatio: 0.5,
          floorZero: true,
          rounding: "raw",
        },
        sections: [
          { name: "单选区", count: 3, scoreEach: 2, source: "mixed", types: ["single"] },
        ],
      };

      const sectionOf = new Map([
        [q1.id, "单选区"],
        [q2.id, "单选区"],
        [q3.id, "单选区"],
      ]);
      const scoreOf = new Map([
        [q1.id, 2],
        [q2.id, 2],
        [q3.id, 2],
      ]);

      const session = new MockSession(bp, [q1, q2, q3], { sectionOf, scoreOf }, 1000);

      // 题1：答对得 2 分
      session.setAnswer(q1.id, "A", 100);
      // 题2：答错扣 1 分 (2 * 0.5)
      session.setAnswer(q2.id, "A", 200);
      // 题3：未答得 0 分

      session.submit(2000);
      const score = session.score();

      // 预期得分：2 - 1 + 0 = 1 分（满分 6 分）
      expect(score.full).toBe(6);
      expect(score.total).toBe(1);
      expect(score.percent).toBe(16.7);
      expect(score.scoringPolicy?.kind).toBe("penalty");

      // 快照持久化完整保留 scoringPolicy
      const snap = session.toSnapshot("r-1");
      expect(snap.bp.scoringPolicy).toEqual(bp.scoringPolicy);
    });
  });
});
