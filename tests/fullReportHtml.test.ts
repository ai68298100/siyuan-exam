import { describe, it, expect } from "vitest";
import { buildFullReportHtml } from "../src/core/fullReportHtml";

describe("全景学情诊断报告 HTML 导出引擎 (fullReportHtml)", () => {
  it("buildFullReportHtml 正确渲染题库名、核心 KPI、艾宾浩斯临界考点、五维完备度与薄弱考点", () => {
    const html = buildFullReportHtml({
      bankName: "2026年公务员行测备考题库",
      rangeDays: 30,
      kpi: {
        attempts: 1520,
        accuracy: 78,
        streakDays: 14,
      },
      forgettingSummary: {
        criticalCount: 2,
        urgentKps: [
          { kp: "常识判断/宪法学", retentionPct: 28, riskTier: "critical" },
          { kp: "言语理解/选词填空", retentionPct: 33, riskTier: "critical" },
        ],
      },
      radarDimensions: [
        { label: "覆盖率", score: 85, fullScore: 100, grade: "优秀" },
        { label: "正确率", score: 78, fullScore: 100, grade: "良好" },
      ],
      weakKps: [
        { kp: "判断推理/定义判断", accuracy: 52, total: 45 },
      ],
    });

    expect(html).toContain("2026年公务员行测备考题库");
    expect(html).toContain("全景学情诊断分析报告");
    expect(html).toContain("1520");
    expect(html).toContain("78%");
    expect(html).toContain("14");
    expect(html).toContain("常识判断/宪法学");
    expect(html).toContain("28%");
    expect(html).toContain("覆盖率");
    expect(html).toContain("判断推理/定义判断");
    expect(html).toContain("52%");
    expect(html).toContain("Printed via Lv Exam · Local First");
  });
});
