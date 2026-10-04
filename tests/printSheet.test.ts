import { describe, it, expect } from "vitest";
import { buildQuestionSheet, buildAnswerSheet } from "../src/core/printSheet";
import type { Question } from "../src/core/types";

function q(partial: Partial<Question>): Question {
  return {
    id: "q-print001",
    type: "single",
    stem: "水的化学式是？",
    options: ["H2O", "CO2"],
    answer: "A",
    analysis: "基础化学常识。",
    kp: "化学/基础",
    score: 1,
    origin: "manual",
    hash: "h",
    ...partial,
  };
}

const LIST = [
  q({}),
  q({ id: "q-print002", type: "material", stem: "最可能的诊断是？", options: ["肺炎", "肺癌"], answer: "A", analysis: "患者发热咳嗽三天，影像学提示感染。" }),
  q({ id: "q-print003", type: "fill", stem: "水的化学式是____。", options: [], answer: "H2O", analysis: "" }),
];

describe("68-01 打印视图", () => {
  it("题册：含题干/选项/答题区，绝不含答案与解析（红线）", () => {
    const html = buildQuestionSheet("今日练习", LIST);
    expect(html).toContain("水的化学式是？");
    expect(html).toContain("A. H2O");
    expect(html).toContain("answer-area"); // 填空有答题区
    expect(html).toContain("class=\"material\""); // 材料题解析按材料框展示
    // 红线：题册不泄露答案/解析（材料题的解析字段按材料口径展示，属题面）
    expect(html).not.toContain("基础化学常识");
    expect(html).not.toContain(">A</span>"); // 不标答案字母行
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("答案册：同序含答案与解析", () => {
    const html = buildAnswerSheet("今日练习", LIST);
    expect(html).toContain("答案册");
    expect(html).toContain("基础化学常识");
    expect(html.indexOf("1.")).toBeLessThan(html.indexOf("2."));
    expect(html.indexOf("3.")).toBeGreaterThan(html.indexOf("2."));
  });

  it("HTML 转义：题干中的尖括号/引号不逃逸", () => {
    const html = buildQuestionSheet("转义<t\">", [q({ stem: "<script>alert(1)</script>" })]);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("转义&lt;t&quot;&gt;");
  });

  it("空列表也不抛错（返回合法文档）", () => {
    expect(buildQuestionSheet("空", [])).toContain("共 0 题");
    expect(buildAnswerSheet("空", [])).toContain("共 0 题");
  });
});
