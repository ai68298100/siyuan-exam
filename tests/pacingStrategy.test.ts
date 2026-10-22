import { describe, it, expect } from "vitest";
import {
  calculateExamPacingStrategy,
  auditPacingPostMortem,
  exportPacingReportMarkdown,
} from "../src/core/pacingStrategy";
import type { Blueprint } from "../src/core/mock";

describe("考场配时策略与分段节奏沙盘引擎 (pacingStrategy)", () => {
  const testBp: Blueprint = {
    id: "bp-test",
    name: "模拟公务员行测综合卷",
    durationS: 7200, // 120 分钟
    passLine: 60,
    shuffleOptions: true,
    sectionTimed: false,
    sections: [
      { name: "一、常识判断", count: 20, scoreEach: 0.5, source: "mixed", types: ["single"] },
      { name: "二、言语理解", count: 30, scoreEach: 1, source: "mixed", types: ["single"] },
      { name: "三、判断推理", count: 40, scoreEach: 1, source: "mixed", types: ["single"] },
    ],
  };

  it("calculateExamPacingStrategy 科学配比各模块建议时长与单题预算", () => {
    const strategy = calculateExamPacingStrategy(testBp);
    expect(strategy.totalDurationS).toBe(7200);
    expect(strategy.totalQuestions).toBe(90);
    expect(strategy.sections.length).toBe(3);

    const s1 = strategy.sections[0];
    expect(s1.sectionName).toBe("一、常识判断");
    expect(s1.budgetSeconds).toBeGreaterThan(600); // 至少 10 分钟以上
    expect(s1.targetPerQuestionS).toBeGreaterThan(0);
    expect(s1.alertThresholdS).toBeGreaterThan(s1.targetPerQuestionS);

    // 预算之和不大于总时限
    const sumBudget = strategy.sections.reduce((acc, s) => acc + s.budgetSeconds, 0);
    expect(sumBudget).toBeLessThanOrEqual(7200);
  });

  it("auditPacingPostMortem 诊断耗时陷阱区与提分高效区", () => {
    const strategy = calculateExamPacingStrategy(testBp);

    // 假设常识判断非常快（10 分钟做完，大幅低于预算），但判断推理严重超时（用了 70 分钟）
    const actualSeconds: Record<string, number> = {
      "一、常识判断": 400, // 高效
      "二、言语理解": 2000,
      "三、判断推理": 4500, // 耗时陷阱
    };

    const postMortem = auditPacingPostMortem(strategy, actualSeconds);
    expect(postMortem.sections.length).toBe(3);
    expect(postMortem.efficientSections).toContain("一、常识判断");
    expect(postMortem.timeSinkSections).toContain("三、判断推理");

    const s1 = postMortem.sections.find((s) => s.sectionName === "一、常识判断");
    expect(s1?.status).toBe("efficient");

    const s3 = postMortem.sections.find((s) => s.sectionName === "三、判断推理");
    expect(s3?.status).toBe("time_sink");

    // 导出 Markdown 报告
    const md = exportPacingReportMarkdown(postMortem);
    expect(md).toContain("考场配时策略与作答节奏沙盘复盘");
    expect(md).toContain("耗时陷阱");
    expect(md).toContain("快速提分");
  });
});
