import { describe, it, expect } from "vitest";
import type { Question, AttemptEvent } from "../src/core/types";
import { auditForgettingRisks, exportForgettingRiskMarkdown } from "../src/core/forgettingRisk";

describe("艾宾浩斯记忆遗忘衰退评估与考点急救引擎 (forgettingRisk)", () => {
  const now = new Date("2026-10-23T12:00:00Z").getTime();
  const dayMs = 86_400_000;

  const qs: Question[] = [
    { id: "q1", type: "single", stem: "考点A题1", options: ["A", "B"], answer: "A", kp: "考点A" },
    { id: "q2", type: "single", stem: "考点A题2", options: ["A", "B"], answer: "A", kp: "考点A" },
    { id: "q3", type: "single", stem: "考点B题1", options: ["A", "B"], answer: "A", kp: "考点B" },
    { id: "q4", type: "single", stem: "考点C题1", options: ["A", "B"], answer: "A", kp: "考点C" }, // 从未练过
  ];

  it("auditForgettingRisks 准确量化考点遗忘风险分级与急救候选题", () => {
    // 模拟流水：
    // 考点A：昨天刚做过 (1天前)，正确率 100% -> fresh
    // 考点B：10天前做过，且做错 -> critical
    // 考点C：从未做过 -> critical
    const attempts: AttemptEvent[] = [
      { v: 1, eid: "e1", qid: "q1", verdict: "correct", ts: now - 1 * dayMs },
      { v: 1, eid: "e2", qid: "q3", verdict: "wrong", ts: now - 10 * dayMs },
    ];

    const report = auditForgettingRisks(qs, attempts, now);

    expect(report.evaluatedKpCount).toBe(3);
    expect(report.criticalCount).toBeGreaterThanOrEqual(2); // 考点B 和 考点C
    expect(report.freshCount).toBeGreaterThanOrEqual(1); // 考点A

    const kpB = report.items.find((k) => k.kp === "考点B");
    expect(kpB?.riskTier).toBe("critical");
    expect(kpB?.daysSinceLast).toBe(10);
    expect(kpB?.estimatedRetentionPct).toBeLessThan(40);
    expect(kpB?.advice).toContain("临界衰退区");
    expect(kpB?.candidateQids).toContain("q3");

    const kpA = report.items.find((k) => k.kp === "考点A");
    expect(kpA?.riskTier).toBe("fresh");
    expect(kpA?.daysSinceLast).toBe(1);
    expect(kpA?.estimatedRetentionPct).toBeGreaterThanOrEqual(60);

    // 紧急抢救清单排在最前
    expect(report.urgentRescueKps.length).toBeGreaterThanOrEqual(2);
    expect(["考点B", "考点C"]).toContain(report.urgentRescueKps[0].kp);

    // 导出 Markdown 报告
    const md = exportForgettingRiskMarkdown(report);
    expect(md).toContain("艾宾浩斯记忆衰退与考点遗忘风险预警报告");
    expect(md).toContain("优先抢救考点清单");
    expect(md).toContain("考点B");
  });
});
