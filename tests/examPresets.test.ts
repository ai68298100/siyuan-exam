import { describe, it, expect } from "vitest";
import type { Question, WrongItem } from "../src/core/types";
import {
  listExamBlueprintPresets,
  adaptPresetToBlueprint,
  convertWrongbookToMockBlueprint,
} from "../src/core/examPresets";

describe("经典组卷蓝图预设与错题限时卷引擎 (examPresets)", () => {
  const dummyQuestions: Question[] = [
    { id: "q1", type: "single", stem: "题干1", options: ["A", "B"], answer: "A", kp: "常识判断" },
    { id: "q2", type: "single", stem: "题干2", options: ["A", "B"], answer: "A", kp: "常识判断" },
    { id: "q3", type: "multiple", stem: "题干3", options: ["A", "B", "C"], answer: "AB", kp: "法学" },
    { id: "q4", type: "judge", stem: "题干4", options: [], answer: "对", kp: "综合" },
    { id: "q5", type: "fill", stem: "题干5", options: [], answer: "42", kp: "数学" },
  ];

  it("listExamBlueprintPresets 返回完整的标准化蓝图清单", () => {
    const presets = listExamBlueprintPresets();
    expect(presets.length).toBeGreaterThanOrEqual(5);
    const ids = presets.map((p) => p.id);
    expect(ids).toContain("civil_service_general");
    expect(ids).toContain("postgraduate_politics");
    expect(ids).toContain("law_exam_objective");
    expect(ids).toContain("academic_final_exam");
    expect(ids).toContain("micro_quiz_sprint");
  });

  it("adaptPresetToBlueprint 智能根据题库实际题量与考点自适应平账", () => {
    const bp = adaptPresetToBlueprint("civil_service_general", dummyQuestions);
    expect(bp.name).toContain("行政职业能力测验");
    expect(bp.durationS).toBe(120 * 60);
    expect(bp.sections.length).toBeGreaterThanOrEqual(5);

    // 常识段匹配到题库中的两道常识题
    const csSec = bp.sections.find((s) => s.name.includes("常识"));
    expect(csSec?.count).toBe(2);
  });

  it("convertWrongbookToMockBlueprint 将错题一键装配为多题型全真模拟考卷", () => {
    const wrongs: WrongItem[] = [
      { qid: "q1", status: "active", wrongCount: 2, lastWrongAt: 1000 },
      { qid: "q3", status: "active", wrongCount: 1, lastWrongAt: 2000 },
      { qid: "q4", status: "active", wrongCount: 3, lastWrongAt: 3000 },
    ];

    const result = convertWrongbookToMockBlueprint(wrongs, dummyQuestions);
    expect(result.totalCount).toBe(3);
    expect(result.blueprint.sections.length).toBe(3);

    const singleSec = result.blueprint.sections.find((s) => s.types.includes("single"));
    expect(singleSec?.count).toBe(1);

    const multiSec = result.blueprint.sections.find((s) => s.types.includes("multiple"));
    expect(multiSec?.count).toBe(1);

    const judgeSec = result.blueprint.sections.find((s) => s.types.includes("judge"));
    expect(judgeSec?.count).toBe(1);

    expect(result.blueprint.passLine).toBe(70);
    expect(result.blueprint.durationS).toBeGreaterThan(0);
  });
});
