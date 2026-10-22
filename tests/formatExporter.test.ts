import { describe, it, expect } from "vitest";
import type { Question } from "../src/core/types";
import {
  exportQuestionsToGift,
  exportQuestionsToAnkiTsv,
  exportQuestionsToExamDocMarkdown,
} from "../src/core/formatExporter";

describe("多平台试题格式转换导出器 (formatExporter)", () => {
  const qs: Question[] = [
    {
      id: "q-1",
      type: "single",
      stem: "中华人民共和国的根本制度是（ ）",
      options: ["人民代表大会制度", "社会主义制度", "多党合作制", "民族区域自治"],
      answer: "B",
      kp: "宪法学/国体",
      analysis: "宪法第一条明确规定。",
    },
    {
      id: "q-2",
      type: "judge",
      stem: "所有民事主体从出生起就具有民事行为能力。",
      options: [],
      answer: "错",
      kp: "民法典/总则",
      analysis: "具有民事权利能力，而非完全行为能力。",
    },
    {
      id: "q-3",
      type: "fill",
      stem: "圆周率在数学中通常用符号表示为 ____。",
      options: [],
      answer: "$\\pi$",
    },
  ];

  it("导出为 Moodle/学习通标准 GIFT 格式", () => {
    const gift = exportQuestionsToGift(qs);
    expect(gift).toContain("::宪法学_国体::");
    expect(gift).toContain("=社会主义制度#宪法第一条明确规定。");
    expect(gift).toContain("~人民代表大会制度");
    expect(gift).toContain("{FALSE#具有民事权利能力");
    expect(gift).toContain("{=$\\pi$}");
  });

  it("导出为 Anki / 闪卡平台 TSV 格式（带制表符与 HTML 结构）", () => {
    const tsv = exportQuestionsToAnkiTsv(qs);
    expect(tsv).toContain("#separator:tab");
    expect(tsv).toContain("#html:true");
    expect(tsv).toContain("【单选题】");
    expect(tsv).toContain("社会主义制度");
    expect(tsv).toContain("宪法学_国体");
  });

  it("导出为标准 Markdown 试题精选手册", () => {
    const md = exportQuestionsToExamDocMarkdown(qs, { title: "2026 法律常识核心真题精选" });
    expect(md).toContain("# 📚 2026 法律常识核心真题精选");
    expect(md).toContain("### 1. 【单选题】");
    expect(md).toContain("- **A.** 人民代表大会制度");
    expect(md).toContain("> **【正确答案】**：`B`");
    expect(md).toContain("> **【核心考点】**：宪法学/国体");
  });
});
