import { describe, it, expect } from "vitest";
import {
  extractCriterionKeywords,
  evaluateStudentAnswerAgainstRubric,
  exportRubricEvaluationMarkdown,
} from "../src/core/rubricEvaluator";
import type { RubricSpec } from "../src/core/rubric";

describe("主观题采分点智能对齐与诊断引擎 (rubricEvaluator)", () => {
  it("extractCriterionKeywords 正确过滤停用词并提取核心专业词组", () => {
    const text = "核心要点：依法治国是社会主义民主政治的基本保障，包括科学立法、严格执法。";
    const kws = extractCriterionKeywords(text);
    expect(kws).toContain("依法治国");
    expect(kws).toContain("科学立法");
    expect(kws).toContain("严格执法");
    expect(kws).not.toContain("是");
    expect(kws).not.toContain("的");
  });

  it("evaluateStudentAnswerAgainstRubric 准确识别完全命中、部分提及与遗漏", () => {
    const testRubric: RubricSpec = {
      v: 1,
      kind: "rubric",
      fullScore: 10,
      criteria: [
        {
          id: "c1",
          label: "要点一：阐明依法治国基本要求（科学立法与严格执法）",
          weight: 0.5,
          example: "依法治国 科学立法 严格执法",
          levels: [],
        },
        {
          id: "c2",
          label: "要点二：坚持人民主体地位与宪法权威",
          weight: 0.5,
          example: "人民主体 宪法权威",
          levels: [],
        },
      ],
    };

    // 学员作答只回答了第一点的大部分内容，但未提及人民主体与宪法权威
    const studentAnswer = "推进全面依法治国，必须坚持科学立法和严格执法，提升司法公信力。";
    const result = evaluateStudentAnswerAgainstRubric({
      studentAnswer,
      rubric: testRubric,
    });

    expect(result.fullScore).toBe(10);
    expect(result.estimatedScore).toBeGreaterThanOrEqual(4); // 第一项 5 分大概率命中
    expect(result.matchRatio).toBeGreaterThan(30);

    const res1 = result.criteriaResults.find((c) => c.criterionId === "c1");
    expect(res1?.matchedKeywords).toContain("科学立法");
    expect(res1?.matchedKeywords).toContain("严格执法");
    expect(res1?.recommendedLevel).toBe("full");

    const res2 = result.criteriaResults.find((c) => c.criterionId === "c2");
    expect(res2?.recommendedLevel).toBe("none");
    expect(res2?.diagnosticAdvice).toContain("未检索到");

    // 推荐给分预填字典
    expect(result.recommendedRatings["c1"]).toBe("full");
    expect(result.recommendedRatings["c2"]).toBe("none");

    // 导出 Markdown 报告
    const md = exportRubricEvaluationMarkdown(result);
    expect(md).toContain("主观题采分点对齐与诊断报告");
    expect(md).toContain("完全命中");
    expect(md).toContain("未命中");
  });
});
