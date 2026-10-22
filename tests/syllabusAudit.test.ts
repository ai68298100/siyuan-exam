import { describe, it, expect } from "vitest";
import type { Question } from "../src/core/types";
import { parseSyllabus, auditSyllabusCoverage, exportSyllabusAuditMarkdown } from "../src/core/syllabus";

describe("考纲知识点题量配比与出题缺口深度体检 (syllabusAudit)", () => {
  const syllabusText = `
# 法学综合考试大纲
## 宪法学
### 宪法基本原则
### 公民基本权利
## 刑法学
### 犯罪构成要件
### 正当防卫
  `;

  const qs: Question[] = [
    {
      id: "q-1",
      type: "single",
      stem: "宪法基本原则题1",
      options: ["A", "B"],
      answer: "A",
      kp: "宪法基本原则",
    },
    {
      id: "q-2",
      type: "single",
      stem: "宪法基本原则题2",
      options: ["A", "B"],
      answer: "A",
      kp: "宪法基本原则",
    },
    {
      id: "q-3",
      type: "single",
      stem: "宪法基本原则题3",
      options: ["A", "B"],
      answer: "A",
      kp: "宪法基本原则",
    },
    {
      id: "q-4",
      type: "single",
      stem: "公民基本权利题1",
      options: ["A", "B"],
      answer: "A",
      kp: "公民基本权利",
    },
  ];

  it("auditSyllabusCoverage 检出零题盲区与题量不足考点", () => {
    const roots = parseSyllabus(syllabusText);
    const report = auditSyllabusCoverage(roots, qs, { minQuestionsPerKp: 3 });

    expect(report.totalNodes).toBeGreaterThanOrEqual(4);
    expect(report.coveredNodes).toBeGreaterThanOrEqual(1); // "宪法基本原则" 有 3 题，达到要求
    expect(report.insufficientNodes).toBeGreaterThanOrEqual(1); // "公民基本权利" 仅 1 题 < 3
    expect(report.uncoveredNodes).toBeGreaterThanOrEqual(2); // "犯罪构成要件" 和 "正当防卫" 为 0 题

    const zeroKp = report.items.find((it) => it.title === "犯罪构成要件");
    expect(zeroKp?.status).toBe("uncovered");
    expect(zeroKp?.suggestedAction).toContain("零题覆盖盲区");

    const partialKp = report.items.find((it) => it.title === "公民基本权利");
    expect(partialKp?.status).toBe("insufficient");
    expect(partialKp?.suggestedAction).toContain("题量不足");

    // 导出 Markdown 报告
    const md = exportSyllabusAuditMarkdown(report);
    expect(md).toContain("考纲出题完备度与知识点覆盖缺口体检报告");
    expect(md).toContain("教师补充出题建议清单");
    expect(md).toContain("零题盲区");
  });
});
