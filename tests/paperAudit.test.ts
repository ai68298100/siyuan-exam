import { describe, it, expect } from "vitest";
import type { Question, AttemptEvent } from "../src/core/types";
import type { SyllabusNode } from "../src/core/syllabus";
import {
  predictPaperDifficulty,
  auditPaperSyllabusBalance,
  exportPaperAuditMarkdown,
} from "../src/core/paperAudit";

describe("试卷预估难度与大纲分值契合度体检引擎 (paperAudit)", () => {
  const qs: Question[] = [
    {
      id: "q1",
      type: "single",
      stem: "基础概念题1",
      options: ["A", "B"],
      answer: "A",
      kp: "民法典/总则/民事主体",
      difficulty: 1, // 易
      score: 2,
    },
    {
      id: "q2",
      type: "single",
      stem: "中等难度题2",
      options: ["A", "B"],
      answer: "A",
      kp: "民法典/物权/所有权",
      difficulty: 3, // 中
      score: 2,
    },
    {
      id: "q3",
      type: "short",
      stem: "主观压轴大题3",
      options: [],
      answer: "核心解析",
      kp: "民法典/物权/担保物权",
      difficulty: 5, // 难
      score: 10,
    },
  ];

  const syllabusRoots: SyllabusNode[] = [
    {
      id: "n1",
      title: "民法典",
      kpPrefix: "民法典",
      children: [
        { id: "n2", title: "民事主体", kpPrefix: "民法典/总则/民事主体", children: [] },
        { id: "n3", title: "所有权", kpPrefix: "民法典/物权/所有权", children: [] },
        { id: "n4", title: "侵权责任", kpPrefix: "民法典/侵权责任", children: [] }, // 本次试卷未覆盖
      ],
    },
  ];

  it("predictPaperDifficulty 综合星级与实测作答流水预测全卷难度", () => {
    // 模拟真实作答：q1 正确率 100% (4/4)，q2 正确率 50% (2/4)
    const attempts: AttemptEvent[] = [
      { v: 1, eid: "e1", qid: "q1", verdict: "correct", ts: 1000 },
      { v: 1, eid: "e2", qid: "q1", verdict: "correct", ts: 2000 },
      { v: 1, eid: "e3", qid: "q1", verdict: "correct", ts: 3000 },
      { v: 1, eid: "e4", qid: "q1", verdict: "correct", ts: 4000 },
      { v: 1, eid: "e5", qid: "q2", verdict: "correct", ts: 5000 },
      { v: 1, eid: "e6", qid: "q2", verdict: "wrong", ts: 6000 },
      { v: 1, eid: "e7", qid: "q2", verdict: "correct", ts: 7000 },
      { v: 1, eid: "e8", qid: "q2", verdict: "wrong", ts: 8000 },
    ];

    const pred = predictPaperDifficulty(qs, attempts);
    expect(pred.totalQuestions).toBe(3);
    expect(pred.totalScore).toBe(14);
    expect(pred.measuredSampleCount).toBe(2);
    expect(pred.estimatedCount).toBe(1); // q3 没有作答，按 5 星推断 P=0.15
    expect(pred.averageP).toBeGreaterThan(0.2);
    expect(pred.averageP).toBeLessThan(0.8);
    expect(pred.difficultyLabel).toBeTruthy();
  });

  it("auditPaperSyllabusBalance 检出客观题/主观题分值比与大纲空白考点", () => {
    const report = auditPaperSyllabusBalance(qs, syllabusRoots);
    expect(report.objectiveScore).toBe(4);
    expect(report.subjectiveScore).toBe(10);
    expect(report.subjectiveRatio).toBeGreaterThan(60); // 主观题占 10/14 分
    expect(report.missingSyllabusNodes).toContain("侵权责任"); // 未出题的大纲节点
    expect(report.kpDistributions.length).toBe(3);

    // 担保物权占了 10 分（超 70%），判定为 crowded 偏科
    const danbao = report.kpDistributions.find((k) => k.kp.includes("担保物权"));
    expect(danbao?.status).toBe("crowded");
    expect(report.crowdedKps.length).toBeGreaterThanOrEqual(1);

    // 导出 Markdown 报告
    const pred = predictPaperDifficulty(qs);
    const md = exportPaperAuditMarkdown(pred, report, "2026年民法期末模拟卷");
    expect(md).toContain("预估难度与大纲体检报告");
    expect(md).toContain("客观题分值");
    expect(md).toContain("未覆盖考点");
  });
});
