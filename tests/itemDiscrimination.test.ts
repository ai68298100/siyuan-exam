import { describe, it, expect } from "vitest";
import type { AttemptEvent, Question } from "../src/core/types";
import {
  computeEmpiricalStars,
  evaluateDiscriminationGrade,
  calculateItemDiscrimination,
  auditBankDiscrimination,
  exportDiscriminationCsv,
} from "../src/core/itemDiscrimination";

function mkQuestion(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    type: "single",
    stem: `题目 ${id} 题干内容`,
    options: ["A", "B", "C", "D"],
    answer: "A",
    score: 1,
    origin: "manual",
    hash: `hash-${id}`,
    difficulty: 3,
    ...overrides,
  };
}

function mkAttempt(
  qid: string,
  verdict: "correct" | "wrong" | "not_attempted",
  sessionId: string,
  ts: number,
): AttemptEvent {
  return {
    v: 1,
    eid: `e-${qid}-${ts}`,
    ts,
    qid,
    kind: "practice",
    mode: "single",
    verdict,
    myAnswer: verdict === "correct" ? "A" : "B",
    queue: "normal",
    device: "d1",
    seq: ts,
    sessionId,
  };
}

describe("ItemDiscrimination 题目实测难度与区分度自动校准引擎 (43-08 / 45-08)", () => {
  describe("难度换算与区分度评级 (computeEmpiricalStars / evaluateDiscriminationGrade)", () => {
    it("正确根据通过率 P 换算 1-5 星级", () => {
      expect(computeEmpiricalStars(0.9)).toBe(1); // 极易
      expect(computeEmpiricalStars(0.75)).toBe(2); // 偏易
      expect(computeEmpiricalStars(0.55)).toBe(3); // 中等
      expect(computeEmpiricalStars(0.35)).toBe(4); // 较难
      expect(computeEmpiricalStars(0.15)).toBe(5); // 极难
    });

    it("依据 Ebel 标准评定区分度等级", () => {
      expect(evaluateDiscriminationGrade(0.45)).toBe("excellent");
      expect(evaluateDiscriminationGrade(0.35)).toBe("good");
      expect(evaluateDiscriminationGrade(0.25)).toBe("marginal");
      expect(evaluateDiscriminationGrade(0.1)).toBe("poor");
      expect(evaluateDiscriminationGrade(-0.2)).toBe("negative");
    });
  });

  describe("calculateItemDiscrimination 单题分析", () => {
    it("零作答题目安全返回，不崩溃且 confident 为 false", () => {
      const q = mkQuestion("q-empty");
      const res = calculateItemDiscrimination(q, [], []);

      expect(res.qid).toBe("q-empty");
      expect(res.validAttempts).toBe(0);
      expect(res.difficultyP).toBe(-1);
      expect(res.confident).toBe(false);
      expect(res.diagnosisNote).toContain("暂无有效作答");
    });

    it("优质题目：高分组通过率高、低分组通过率低，计算出高区分度 D", () => {
      const q = mkQuestion("q-good", { difficulty: 2 });

      // 构造 10 次作答：
      // 在 high-session 中作答 5 次全对（能力值高）
      // 在 low-session 中作答 5 次全错（能力值低）
      const highSessionEvents: AttemptEvent[] = Array.from({ length: 5 }, (_, i) =>
        mkAttempt("q-good", "correct", "high-session", 1000 + i),
      );
      // high-session 还有其他答对题，确保 session 胜率为 1.0
      highSessionEvents.push(mkAttempt("other", "correct", "high-session", 1010));

      const lowSessionEvents: AttemptEvent[] = Array.from({ length: 5 }, (_, i) =>
        mkAttempt("q-good", "wrong", "low-session", 2000 + i),
      );
      // low-session 还有其他答错题，确保 session 胜率为 0.0
      lowSessionEvents.push(mkAttempt("other", "wrong", "low-session", 2010));

      const allEvents = [...highSessionEvents, ...lowSessionEvents];
      const qEvents = allEvents.filter((e) => e.qid === "q-good");

      const res = calculateItemDiscrimination(q, qEvents, allEvents, { minSample: 10 });

      expect(res.validAttempts).toBe(10);
      expect(res.difficultyP).toBe(0.5); // 5/10
      expect(res.empiricalStars).toBe(3);
      expect(res.authorStars).toBe(2);
      expect(res.difficultyBias).toBe(-1); // 作者标 2 星，实测 3 星，作者略微低估难度

      // 高分组通过率 1.0，低分组通过率 0.0 -> D = 1.0
      expect(res.highGroup.passRate).toBe(1.0);
      expect(res.lowGroup.passRate).toBe(0.0);
      expect(res.discriminationD).toBe(1.0);
      expect(res.grade).toBe("excellent");
      expect(res.confident).toBe(true);
      expect(res.diagnosisNote).toContain("试题区分能力优异");
    });

    it("负区分度异常告警：高分组答错，低分组答对，触发重大异常提示", () => {
      const q = mkQuestion("q-bad");

      // 高分组考生在该题答错，低分组考生在该题蒙对
      const highEvents: AttemptEvent[] = Array.from({ length: 5 }, (_, i) =>
        mkAttempt("q-bad", "wrong", "high-session", 1000 + i),
      );
      highEvents.push(mkAttempt("other", "correct", "high-session", 1010));

      const lowEvents: AttemptEvent[] = Array.from({ length: 5 }, (_, i) =>
        mkAttempt("q-bad", "correct", "low-session", 2000 + i),
      );
      lowEvents.push(mkAttempt("other", "wrong", "low-session", 2010));

      const allEvents = [...highEvents, ...lowEvents];
      const qEvents = allEvents.filter((e) => e.qid === "q-bad");

      const res = calculateItemDiscrimination(q, qEvents, allEvents, { minSample: 10 });

      expect(res.discriminationD).toBeLessThan(0);
      expect(res.grade).toBe("negative");
      expect(res.diagnosisNote).toContain("负区分度严重异常");
      expect(res.diagnosisNote).toContain("标准答案错误");
    });

    it("样本不足门槛保护：作答次数不足时不盲目认定结论", () => {
      const q = mkQuestion("q-small");
      const events = [
        mkAttempt("q-small", "correct", "s1", 100),
        mkAttempt("q-small", "wrong", "s1", 200),
      ];

      const res = calculateItemDiscrimination(q, events, events, { minSample: 10 });
      expect(res.validAttempts).toBe(2);
      expect(res.confident).toBe(false);
      expect(res.diagnosisNote).toContain("样本较少");
    });
  });

  describe("auditBankDiscrimination 全库体检与 CSV 导出", () => {
    it("全面汇总全库难度与区分度指标，准确检出异常题目清单", () => {
      const qNormal = mkQuestion("q1");
      const qAnomaly = mkQuestion("q2");

      // qNormal: 正常良好（在 session-A 高分组中答对，在 session-B 低分组中答错）
      const events1: AttemptEvent[] = [
        ...Array.from({ length: 6 }, (_, i) => mkAttempt("q1", "correct", "session-A", i * 10)),
        ...Array.from({ length: 6 }, (_, i) => mkAttempt("q1", "wrong", "session-B", 100 + i * 10)),
      ];
      events1.push(mkAttempt("bench-1", "correct", "session-A", 1));
      events1.push(mkAttempt("bench-2", "wrong", "session-B", 2));

      // qAnomaly: 异常负区分度（在 session-C 高分组中答错，在 session-D 低分组中答对）
      const events2: AttemptEvent[] = [
        ...Array.from({ length: 6 }, (_, i) => mkAttempt("q2", "wrong", "session-C", 200 + i * 10)),
        ...Array.from({ length: 6 }, (_, i) => mkAttempt("q2", "correct", "session-D", 300 + i * 10)),
      ];
      events2.push(mkAttempt("bench-3", "correct", "session-C", 201));
      events2.push(mkAttempt("bench-4", "wrong", "session-D", 301));

      const allEvents = [...events1, ...events2];
      const audit = auditBankDiscrimination([qNormal, qAnomaly], allEvents, { minSample: 10 });

      expect(audit.totalQuestions).toBe(2);
      expect(audit.analyzedCount).toBe(2);
      expect(audit.confidentCount).toBe(2);
      expect(audit.gradeCounts.excellent).toBeGreaterThanOrEqual(1);
      expect(audit.gradeCounts.negative).toBeGreaterThanOrEqual(1);

      // q2 成功归入异常题清单
      expect(audit.anomalies.some((it) => it.qid === "q2")).toBe(true);

      // 导出 CSV 验证
      const csv = exportDiscriminationCsv(audit);
      expect(csv.startsWith("\uFEFF")).toBe(true); // UTF-8 BOM
      expect(csv).toContain("题目ID,题干摘要,题型,有效作答次数,实测通过率P");
      expect(csv).toContain("q1");
      expect(csv).toContain("q2");
      expect(csv).toContain("负区分度严重异常");
    });

    it("空 stem 或草稿损坏题目安全容错，不抛出异常", () => {
      const corruptQ = mkQuestion("q-corrupt", { stem: undefined as unknown as string });
      expect(() => calculateItemDiscrimination(corruptQ, [])).not.toThrow();
      const res = calculateItemDiscrimination(corruptQ, []);
      expect(res.stemSnippet).toBe("未命名题干");
    });
  });
});
