import { describe, it, expect } from "vitest";
import {
  accumulateDeficit,
  computeAbsenceStats,
  calculateCompensation,
  generatePlanPreview,
  executePlanRecount,
  type CompensateConfig,
} from "../src/core/dailyPlan";

describe("44-05 每日计划欠账与超额处理", () => {
  const config: CompensateConfig = {
    enabled: true,
    strategy: "constant",
    maxDailyCap: 100,
    minDailyFloor: 5,
  };

  describe("accumulateDeficit 欠账累计", () => {
    it("未完成则累加欠题数", () => {
      expect(accumulateDeficit(0, 20, 15)).toBe(5);
      expect(accumulateDeficit(5, 20, 10)).toBe(15);
    });

    it("完成或超额则清零（不累积负值）", () => {
      expect(accumulateDeficit(5, 20, 20)).toBe(0);
      expect(accumulateDeficit(5, 20, 25)).toBe(0);
    });

    it("已存在欠账时继续累加", () => {
      expect(accumulateDeficit(3, 20, 18)).toBe(5); // 3 + (20-18)
    });
  });

  describe("computeAbsenceStats 欠账统计", () => {
    it("启用补偿且缺席 >0 时返回正确统计", () => {
      const stats = computeAbsenceStats(config, 3, 15, 5);
      expect(stats.absentStreak).toBe(3);
      expect(stats.totalDue).toBe(15);
      expect(stats.compensated).toBe(5);
      expect(stats.remainingDue).toBe(10);
    });

    it("未启用补偿时所有统计为 0", () => {
      const stats = computeAbsenceStats({ ...config, enabled: false }, 3, 15, 5);
      expect(stats.absentStreak).toBe(3);
      expect(stats.totalDue).toBe(0);
      expect(stats.compensated).toBe(0);
      expect(stats.remainingDue).toBe(0);
    });

    it("缺席为 0 时统计为 0", () => {
      const stats = computeAbsenceStats(config, 0, 15, 5);
      expect(stats.totalDue).toBe(0);
      expect(stats.remainingDue).toBe(0);
    });
  });

  describe("calculateCompensation 补偿计算", () => {
    it("恒定策略：平摊到未来每一天", () => {
      const compensation = calculateCompensation(config, 3, 10, 7, 20);
      // 10 / (7+1) = 1.25 → ceil = 2，但 minDailyFloor=5 → 返回 5
      expect(compensation).toBe(5);
    });

    it("顺延策略：今天不补", () => {
      const compensation = calculateCompensation({ ...config, strategy: "roll-over" }, 3, 10, 7, 20);
      expect(compensation).toBe(0);
    });

    it("考前集中策略：距考≤5 天开始补偿", () => {
      const preExam = calculateCompensation({ ...config, strategy: "pre-exam" }, 3, 10, 3, 20);
      expect(preExam).toBeGreaterThan(0);
      
      const farAway = calculateCompensation({ ...config, strategy: "pre-exam" }, 3, 10, 10, 20);
      expect(farAway).toBe(0);
    });

    it("夹取在 [minDailyFloor, maxDailyCap] 内", () => {
      const low = calculateCompensation({ ...config, minDailyFloor: 10, maxDailyCap: 50 }, 3, 10, 7, 20);
      expect(low).toBeGreaterThanOrEqual(10);
      
      const high = calculateCompensation({ ...config, minDailyFloor: 5, maxDailyCap: 3 }, 3, 100, 7, 20);
      // maxDailyCap < minDailyFloor → 返回 maxDailyCap（因为 Math.max(5, Math.min(3, X)) = 3）
      expect(high).toBeLessThanOrEqual(3);
    });

    it("无欠账时返回 0", () => {
      expect(calculateCompensation(config, 3, 0, 7, 20)).toBe(0);
    });
  });

  describe("generatePlanPreview 预览生成", () => {
    it("生成完整预览信息", () => {
      const preview = generatePlanPreview(config, "2026-10-20", 3, 15, 5, 7, 20);
      expect(preview.date).toBe("2026-10-20");
      expect(preview.originalQuota).toBe(20);
      expect(preview.deficitAdded).toBe(15);
      expect(preview.compensatedToday).toBeGreaterThan(0);
      expect(preview.newQuota).toBeGreaterThan(preview.originalQuota);
      expect(preview.explanation).toContain("连续缺席");
      expect(preview.explanation).toContain("欠账");
      expect(preview.explanation).toContain("新配额");
    });

    it("无欠账时预览简单", () => {
      const preview = generatePlanPreview(config, "2026-10-20", 0, 0, 0, 7, 20);
      expect(preview.deficitAdded).toBe(0);
      expect(preview.compensatedToday).toBe(0);
      expect(preview.newQuota).toBe(20);
    });
  });

  describe("executePlanRecount 执行重算", () => {
    it("用户确认后使用新配额", () => {
      const preview = generatePlanPreview(config, "2026-10-20", 3, 15, 5, 7, 20);
      const result = executePlanRecount(preview, true);
      expect(result.confirmed).toBe(true);
      expect(result.quota).toBe(preview.newQuota);
    });

    it("用户取消后保持原配额", () => {
      const preview = generatePlanPreview(config, "2026-10-20", 3, 15, 5, 7, 20);
      const result = executePlanRecount(preview, false);
      expect(result.confirmed).toBe(false);
      expect(result.quota).toBe(preview.originalQuota);
    });
  });
});
