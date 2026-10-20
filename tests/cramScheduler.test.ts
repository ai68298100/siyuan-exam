import { describe, it, expect } from "vitest";
import type { Question, WrongItem } from "../src/core/types";
import {
  calculateDaysLeft,
  computeCompressionFactor,
  computeExamUrgency,
  compressIntervalDays,
  extractCramCandidates,
  calculateCramBudget,
  createCramSessionSpec,
} from "../src/core/cramScheduler";

function createMockQuestion(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    type: "single",
    stem: `题目 ${id}`,
    options: ["A", "B", "C", "D"],
    answer: "A",
    score: 1,
    origin: "manual",
    hash: `hash-${id}`,
    ...overrides,
  };
}

describe("CramScheduler 考前急救冲刺与动态间隔压缩引擎 (53-04 / 39-02 / ADR 0003)", () => {
  describe("距考天数与紧急度分级计算", () => {
    it("空考期、非法格式或已过期的考期正确返回 none 级别", () => {
      const now = new Date("2026-10-20T10:00:00").getTime();

      expect(calculateDaysLeft("", now)).toBe(-1);
      expect(computeCompressionFactor(-1)).toBe(1.0);

      const u1 = computeExamUrgency("", now);
      expect(u1.level).toBe("none");
      expect(u1.compressionFactor).toBe(1.0);

      const u2 = computeExamUrgency("invalid-date", now);
      expect(u2.level).toBe("none");

      const u3 = computeExamUrgency("2026-10-10", now); // 过去时间
      expect(u3.level).toBe("none");
      expect(u3.label).toBe("考期已过");
    });

    it("临考自适应分级：emergency (≤7天)、sprint (8-14天)、relaxed (>14天)", () => {
      const now = new Date("2026-10-20T10:00:00").getTime();

      // 1. 距考 3 天 -> emergency
      const uEmergency = computeExamUrgency("2026-10-23", now);
      expect(uEmergency.level).toBe("emergency");
      expect(uEmergency.daysLeft).toBe(3);
      expect(uEmergency.compressionFactor).toBe(0.15);
      expect(uEmergency.description).toContain("考前急救冲刺");

      // 2. 距考 10 天 -> sprint
      const uSprint = computeExamUrgency("2026-10-30", now);
      expect(uSprint.level).toBe("sprint");
      expect(uSprint.daysLeft).toBe(10);
      expect(uSprint.compressionFactor).toBe(0.65);

      // 3. 距考 30 天 -> relaxed
      const uRelaxed = computeExamUrgency("2026-11-20", now);
      expect(uRelaxed.level).toBe("relaxed");
      expect(uRelaxed.daysLeft).toBeGreaterThan(14);
      expect(uRelaxed.compressionFactor).toBe(1.0);
    });
  });

  describe("动态间隔压缩算法 (compressIntervalDays)", () => {
    it("长周期间隔在临考前非线性压缩，且单次间隔不超过考期一半", () => {
      // 距考 5 天，原长线 FSRS 间隔为 30 天
      const daysLeft = 5;
      const regularInterval = 30;
      const compressed = compressIntervalDays(regularInterval, daysLeft);

      // 考前 5 天，最多允许复习间隔 = floor(5 * 0.5) = 2 天
      expect(compressed).toBe(2);
      expect(compressed).toBeLessThan(regularInterval);
    });

    it("极度紧迫状态下保底单日复习，不出现 0 天或负数", () => {
      expect(compressIntervalDays(10, 0)).toBe(1);
      expect(compressIntervalDays(10, -1)).toBe(1);
      expect(compressIntervalDays(1, 1)).toBe(1);
    });
  });

  describe("extractCramCandidates (候选加权排序)", () => {
    it("排除已归档题与争议题，顽固错题与高危错因排在冲刺队列最前列", () => {
      const q1 = createMockQuestion("q-stubborn", { kp: "常识/宪法" });
      const q2 = createMockQuestion("q-trap", { kp: "言语/逻辑" });
      const q3 = createMockQuestion("q-careless", { kp: "常识/经济" });
      const q4 = createMockQuestion("q-archived", { kp: "常识/地理" });
      const q5 = createMockQuestion("q-disputed", { kp: "法律/刑法", dispute: { status: "pending", reason: "wrong_answer", reportedAt: 1 } });
      const q6 = createMockQuestion("q-fresh", { kp: "数学/几何" });

      const wrongItems: WrongItem[] = [
        { qid: "q-stubborn", firstWrongAt: 100, lastWrongAt: 200, wrongCount: 4, streakCorrect: 0, reason: "unknown", myAnswer: "B" },
        { qid: "q-trap", firstWrongAt: 100, lastWrongAt: 200, wrongCount: 2, streakCorrect: 0, reason: "trap", myAnswer: "C" },
        { qid: "q-careless", firstWrongAt: 100, lastWrongAt: 200, wrongCount: 1, streakCorrect: 1, reason: "careless", myAnswer: "D" },
        { qid: "q-archived", firstWrongAt: 100, lastWrongAt: 200, wrongCount: 5, streakCorrect: 0, reason: "unknown", myAnswer: "B" },
      ];

      const wrongReasons = new Map<string, string>([
        ["q-stubborn", "unknown"],
        ["q-trap", "trap"],
        ["q-careless", "careless"],
      ]);

      const archivedQids = new Set(["q-archived"]);

      const candidates = extractCramCandidates({
        allQuestions: [q1, q2, q3, q4, q5, q6],
        wrongItems,
        wrongReasons,
        archivedQids,
        daysLeft: 5,
        filter: { includeUnattempted: true, limit: 10 },
      });

      // 验证排除项：q-archived 和 q-disputed 被安全过滤
      const candIds = candidates.map((c) => c.question.id);
      expect(candIds).not.toContain("q-archived");
      expect(candIds).not.toContain("q-disputed");

      // 验证第一名必定是顽固攻坚题 q-stubborn（高错次 + 盲区加权 + 顽固加权）
      expect(candIds[0]).toBe("q-stubborn");
      expect(candidates[0].isStubborn).toBe(true);
      expect(candidates[0].reasons).toContain("🔥 顽固攻坚题");

      // 第二名是陷阱题 q-trap
      expect(candIds[1]).toBe("q-trap");

      // 未答题 q-fresh 作为盲测题加入队尾
      expect(candIds).toContain("q-fresh");
      const freshCand = candidates.find((c) => c.question.id === "q-fresh");
      expect(freshCand?.reasons).toContain("考前全新题盲测");
    });

    it("支持考点前缀与题型精准过滤", () => {
      const q1 = createMockQuestion("q1", { type: "single", kp: "资料分析/比重" });
      const q2 = createMockQuestion("q2", { type: "multiple", kp: "资料分析/增长率" });
      const q3 = createMockQuestion("q3", { type: "single", kp: "言语理解/主旨" });

      const wrongItems: WrongItem[] = [
        { qid: "q1", firstWrongAt: 1, lastWrongAt: 2, wrongCount: 2, streakCorrect: 0, myAnswer: "A" },
        { qid: "q2", firstWrongAt: 1, lastWrongAt: 2, wrongCount: 2, streakCorrect: 0, myAnswer: "A" },
        { qid: "q3", firstWrongAt: 1, lastWrongAt: 2, wrongCount: 2, streakCorrect: 0, myAnswer: "A" },
      ];

      const candidates = extractCramCandidates({
        allQuestions: [q1, q2, q3],
        wrongItems,
        filter: {
          kpPrefix: "资料分析",
          types: ["single"],
          limit: 10,
        },
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].question.id).toBe("q1");
    });
  });

  describe("calculateCramBudget (容量与防爆量预算)", () => {
    it("根据可用时长测算题量，并严格遵守上限与下限夹取", () => {
      // 1. 20 分钟，平均 40 秒/题 -> 理论 30 题
      const budget1 = calculateCramBudget({
        targetMinutes: 20,
        avgSecondsPerQuestion: 40,
        candidateCount: 100,
        urgencyLevel: "sprint",
      });
      expect(budget1.recommendedCount).toBe(30);

      // 2. 超大时间目标（如 120 分钟），触发上限夹取
      const budget2 = calculateCramBudget({
        targetMinutes: 120,
        avgSecondsPerQuestion: 30,
        candidateCount: 200,
        urgencyLevel: "sprint",
        maxCap: 50,
      });
      expect(budget2.recommendedCount).toBe(50); // 截断到 50

      // 3. 临考急救期 (emergency) 自动将上限压紧到 40，防止临考过载
      const budget3 = calculateCramBudget({
        targetMinutes: 120,
        candidateCount: 200,
        urgencyLevel: "emergency",
        maxCap: 60,
      });
      expect(budget3.maxCap).toBe(40);
      expect(budget3.recommendedCount).toBe(40);
      expect(budget3.rationale).toContain("考前急救模式启用防疲劳安全上限");
    });
  });

  describe("createCramSessionSpec (ADR 0003 与 39-02 契约保障)", () => {
    it("会话规格严格标注 cram 队列身份，writesBack 恒为 false (Anki reschedule-off)", () => {
      const q = createMockQuestion("q1");
      const candidates = [{ question: q, score: 50, reasons: ["测试"], isStubborn: false, wrongCount: 2 }];
      const budget = calculateCramBudget({ candidateCount: 1, urgencyLevel: "emergency" });

      const spec = createCramSessionSpec({
        examDate: "2026-10-23",
        candidates,
        budget,
        nowMs: new Date("2026-10-20T10:00:00").getTime(),
      });

      // 关键契约断言
      expect(spec.mode).toBe("cram");
      expect(spec.queue).toBe("cram");
      expect(spec.semantics.kind).toBe("cram");
      expect(spec.semantics.writesBack).toBe(false);
      expect(spec.receipt).toContain("Anki reschedule-off");
      expect(spec.receipt).toContain("不影响内核卡包长期复习排期");
      expect(spec.questions).toHaveLength(1);
    });
  });
});
