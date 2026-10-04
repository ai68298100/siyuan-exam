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

  it("68-03 题组连续性：材料框同组只印一次；无组材料题保持原样", () => {
    const mat = q({ id: "q-print004", type: "material", stem: "根据以下病例回答。", analysis: "病例：患者发热咳嗽三天。", group: "grp-1" });
    const sub1 = q({ id: "q-print005", stem: "最可能的诊断是？", group: "grp-1" });
    const sub2 = q({ id: "q-print006", type: "judge", stem: "应立即抗肿瘤治疗？", options: [], answer: "错", group: "grp-1" });
    const html = buildQuestionSheet("题组", [mat, sub1, sub2, q({ id: "q-print007", type: "material", stem: "独立材料题", analysis: "独立材料文本" })]);
    // 同组材料只出现一次
    expect(html.split("病例：患者发热咳嗽三天。")).toHaveLength(2); // 1 次 = split 2 段
    expect(html).toContain("独立材料文本"); // 无组材料题保持材料框
    expect(html).toContain("最可能的诊断是？");
    expect(html).toContain("应立即抗肿瘤治疗？");
  });
});
