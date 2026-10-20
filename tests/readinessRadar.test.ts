import { describe, it, expect } from "vitest";
import type { Question, AttemptEvent } from "../src/core/types";
import type { KpMastery } from "../src/core/report";
import {
  identifyBlindspots,
  calculateReadinessDimensions,
  generateReadinessReport,
  exportReadinessReportMarkdown,
  exportReadinessReportCsv,
} from "../src/core/readinessRadar";

describe("readinessRadar - 考点盲区雷达与备考完备度体检引擎", () => {
  const baseQuestions: Question[] = [
    {
      id: "q1",
      stem: "关于刑法因果关系，下列说法正确的是？",
      kind: "single",
      options: ["A", "B", "C", "D"],
      answer: "A",
      kp: "刑法/因果关系",
    },
    {
      id: "q2",
      stem: "关于正当防卫与紧急避险，下列说法正确的是？",
      kind: "single",
      options: ["A", "B", "C", "D"],
      answer: "B",
      kp: "刑法/正当防卫",
    },
    {
      id: "q3",
      stem: "物权法的基本原则包括？",
      kind: "multiple",
      options: ["A", "B", "C", "D"],
      answer: ["A", "B"],
      kp: "民法/物权法",
    },
    {
      id: "q4",
      stem: "合同解除的法定事由包括？",
      kind: "single",
      options: ["A", "B", "C", "D"],
      answer: "C",
      kp: "民法/合同法",
    },
    {
      id: "q5",
      stem: "行政诉讼的受案范围包括？",
      kind: "single",
      options: ["A", "B", "C", "D"],
      answer: "D",
      kp: "行政法/受案范围",
    },
  ];

  it("当题库考点未作答时，应准确识别为 critical 高危盲区并给出补练处方", () => {
    const masteryList: KpMastery[] = [
      {
        root: "刑法",
        total: 5,
        accuracy: 0.8,
        retention: 0.9,
        mastery: 0.72,
        uniqueQids: 2,
        independentCorrect: 2,
        coverage: 1.0,
        evidenceAt: Date.now(),
      },
    ];

    const blindspots = identifyBlindspots(baseQuestions, masteryList, Date.now());
    expect(blindspots.length).toBeGreaterThan(0);

    // 民法和行政法没有练过，应该判定为 critical
    const minfa = blindspots.find((b) => b.kp === "民法");
    expect(minfa).toBeDefined();
    expect(minfa?.risk).toBe("critical");
    expect(minfa?.practicedCount).toBe(0);
    expect(minfa?.urgencyReason).toContain("尚未练习任何独立题目");
    expect(minfa?.prescription).toContain("立即开展破冰专项刷题");
  });

  it("当掌握度低且正确率低时，判定为 critical 高危错题重灾区", () => {
    const now = Date.now();
    const masteryList: KpMastery[] = [
      {
        root: "民法",
        total: 4,
        accuracy: 0.25,
        retention: 0.5,
        mastery: 0.125,
        uniqueQids: 2,
        independentCorrect: 0,
        coverage: 1.0,
        evidenceAt: now,
      },
    ];

    const blindspots = identifyBlindspots(baseQuestions, masteryList, now);
    const minfa = blindspots.find((b) => b.kp === "民法");
    expect(minfa?.risk).toBe("critical");
    expect(minfa?.urgencyReason).toContain("处于高危错题重灾区");
    expect(minfa?.prescription).toContain("复盘错因自诊断");
  });

  it("当考点超过 21 天未复习导致留存衰减时，判定为 warning 中危遗忘", () => {
    const now = Date.now();
    const twentyFiveDaysAgo = now - 25 * 24 * 3600 * 1000;
    const masteryList: KpMastery[] = [
      {
        root: "刑法",
        total: 10,
        accuracy: 0.75,
        retention: 0.65,
        mastery: 0.4875,
        uniqueQids: 2,
        independentCorrect: 2,
        coverage: 1.0,
        evidenceAt: twentyFiveDaysAgo,
      },
    ];

    const blindspots = identifyBlindspots(baseQuestions, masteryList, now);
    const xingfa = blindspots.find((b) => b.kp === "刑法");
    expect(xingfa?.risk).toBe("warning");
    expect(xingfa?.urgencyReason).toContain("艾宾浩斯留存衰减显著");
    expect(xingfa?.prescription).toContain("启动艾宾浩斯唤醒复习");
  });

  it("当考点掌握度高且近期复习时，判定为 cleared 已攻克", () => {
    const now = Date.now();
    const masteryList: KpMastery[] = [
      {
        root: "刑法",
        total: 15,
        accuracy: 0.85,
        retention: 0.95,
        mastery: 0.8,
        uniqueQids: 2,
        independentCorrect: 2,
        coverage: 1.0,
        evidenceAt: now - 3600 * 1000,
      },
    ];

    const blindspots = identifyBlindspots(baseQuestions, masteryList, now);
    const xingfa = blindspots.find((b) => b.kp === "刑法");
    expect(xingfa?.risk).toBe("cleared");
    expect(xingfa?.prescription).toContain("保持常态考前抽测即可");
  });

  it("计算五维健康度：掌握度、覆盖率、新鲜度、盲区清零度、自律度", () => {
    const now = Date.now();
    const events: AttemptEvent[] = [
      { id: "e1", qid: "q1", at: now - 1000, ts: now - 1000, score: 1 } as any,
      { id: "e2", qid: "q2", at: now - 86400 * 1000, ts: now - 86400 * 1000, score: 1 } as any,
      { id: "e3", qid: "q3", at: now - 2 * 86400 * 1000, ts: now - 2 * 86400 * 1000, score: 0 } as any,
    ];
    const masteryList: KpMastery[] = [
      {
        root: "刑法",
        total: 6,
        accuracy: 0.9,
        retention: 0.85,
        mastery: 0.76,
        uniqueQids: 2,
        independentCorrect: 2,
        coverage: 1.0,
        evidenceAt: now - 1000,
      },
    ];

    const blindspots = identifyBlindspots(baseQuestions, masteryList, now);
    const dimensions = calculateReadinessDimensions(baseQuestions, masteryList, blindspots, events, now);

    expect(dimensions.mastery.score).toBeGreaterThan(0);
    expect(dimensions.coverage.score).toBeGreaterThan(0);
    expect(dimensions.recency.score).toBeGreaterThan(0);
    expect(dimensions.blindspotClearance.score).toBeGreaterThanOrEqual(0);
    expect(dimensions.stamina.score).toBeGreaterThan(0);
  });

  it("生成全局体检报告与冲刺处方，等级判定准确", () => {
    const now = Date.now();
    const masteryList: KpMastery[] = [
      {
        root: "刑法",
        total: 10,
        accuracy: 0.8,
        retention: 0.85,
        mastery: 0.68,
        uniqueQids: 2,
        independentCorrect: 2,
        coverage: 1.0,
        evidenceAt: now,
      },
      {
        root: "民法",
        total: 8,
        accuracy: 0.75,
        retention: 0.8,
        mastery: 0.6,
        uniqueQids: 2,
        independentCorrect: 2,
        coverage: 1.0,
        evidenceAt: now,
      },
      {
        root: "行政法",
        total: 5,
        accuracy: 0.7,
        retention: 0.75,
        mastery: 0.525,
        uniqueQids: 1,
        independentCorrect: 1,
        coverage: 1.0,
        evidenceAt: now,
      },
    ];

    const report = generateReadinessReport(baseQuestions, masteryList, [], { now });
    expect(report.overallScore).toBeGreaterThan(0);
    expect(["S", "A", "B", "C", "D"]).toContain(report.grade);
    expect(report.prescriptions.length).toBeGreaterThan(0);
    expect(report.radarModel).not.toBeNull();
    expect(report.radarModel?.axes.length).toBe(5);
  });

  it("导出 Markdown 诊断报告包含各维度指标与考点盲区表格", () => {
    const report = generateReadinessReport(baseQuestions, []);
    const md = exportReadinessReportMarkdown(report);

    expect(md).toContain("# 🎯 备考完备度体检与考点盲区诊断报告");
    expect(md).toContain("五维体检雷达指标");
    expect(md).toContain("考点盲区扫描清单");
    expect(md).toContain("知识掌握度");
    expect(md).toContain("题库覆盖率");
  });

  it("导出 CSV 纯文本契约合规且字段转义正确", () => {
    const report = generateReadinessReport(baseQuestions, []);
    const csv = exportReadinessReportCsv(report);

    expect(csv).toContain("考点名称,风险等级,掌握度得分");
    expect(csv).toContain("刑法");
    expect(csv).toContain("民法");
    expect(csv).toContain("行政法");
  });

  it("雷达几何模型生成测试：同心环网格、轴坐标与多边形数据点", () => {
    const report = generateReadinessReport(baseQuestions, [
      {
        root: "刑法",
        total: 5,
        accuracy: 0.8,
        retention: 0.8,
        mastery: 0.64,
        uniqueQids: 2,
        independentCorrect: 2,
        coverage: 1.0,
        evidenceAt: Date.now(),
      },
    ]);

    const radar = report.radarModel;
    expect(radar).toBeDefined();
    expect(radar?.axes.length).toBe(5);
    expect(radar?.rings.length).toBe(4); // 25%, 50%, 75%, 100%
    expect(radar?.points.length).toBe(5);
    expect(radar?.polygonPointsString).toMatch(/[\d.-]+,[\d.-]+/);

    // 检查轴线与数据点结构
    radar?.axes.forEach((axis) => {
      expect(axis.to.x).toBeTypeOf("number");
      expect(axis.to.y).toBeTypeOf("number");
      expect(axis.labelPoint.x).toBeTypeOf("number");
      expect(axis.labelPoint.y).toBeTypeOf("number");
    });
  });

  it("支持自定义权重计算与不同备考等级处方", () => {
    // 权重大幅倾斜于盲区清零度
    const reportCustom = generateReadinessReport(
      baseQuestions,
      [],
      [],
      {
        weights: {
          mastery: 0.1,
          coverage: 0.1,
          recency: 0.1,
          blindspotClearance: 0.6,
          stamina: 0.1,
        },
      }
    );
    expect(reportCustom.dimensions.blindspotClearance.weight).toBe(0.6);
  });

  it("CSV 导出时正确转义包含逗号与双引号的特殊考点名称", () => {
    const questionsWithSpecialKp: Question[] = [
      {
        id: "qs1",
        stem: "关于“刑法，分则”的特殊题目",
        kind: "single",
        options: ["A", "B"],
        answer: "A",
        kp: '刑法, "重点"法条',
      },
    ];

    const report = generateReadinessReport(questionsWithSpecialKp, []);
    const csv = exportReadinessReportCsv(report);

    expect(csv).toContain('"刑法, ""重点""法条"');
  });

  it("边界安全测试：空题库与空掌握度列表不抛异常", () => {
    const report = generateReadinessReport([], []);
    expect(report.overallScore).toBe(0);
    expect(report.grade).toBe("D");
    expect(report.blindspots.length).toBe(0);
    expect(report.prescriptions.length).toBeGreaterThan(0);

    const md = exportReadinessReportMarkdown(report);
    expect(md).toContain("综合评分：**0 / 100**");

    const csv = exportReadinessReportCsv(report);
    expect(csv).toContain("考点名称");
  });
});
