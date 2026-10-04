import { describe, it, expect } from "vitest";
import { buildAnswerCardSheet } from "../src/core/printSheet";
import { parsePaperAnswers, gradePaper } from "../src/core/paperRecall";
import type { Question } from "../src/core/types";

function q(partial: Partial<Question>): Question {
  return {
    id: "q-paper001",
    type: "single",
    stem: "S",
    options: ["H2O", "CO2", "O2"],
    answer: "A",
    score: 1,
    origin: "manual",
    hash: "h",
    ...partial,
  };
}

const LIST = [
  q({}),
  q({ id: "q-paper002", type: "judge", stem: "水是化合物。", options: [], answer: "对" }),
  q({ id: "q-paper003", type: "fill", stem: "水的化学式是____。", options: [], answer: "H2O" }),
  q({ id: "q-paper004", type: "short", stem: "简述水的性质。", options: [], answer: "参考要点" }),
];

describe("68-02 答题卡打印", () => {
  it("不含题干与答案；选择给字母格、判断给圈选、填空给横线", () => {
    const html = buildAnswerCardSheet("练习", LIST);
    expect(html).not.toContain("水的化学式是？");
    expect(html).not.toContain("H2O</div>"); // 答案不出现（填空题干除外——此处题干被隐去）
    expect(html).toContain("作答：A  B  C");
    expect(html).toContain("对 / 错");
    expect(html).toContain("answer-area");
    expect(html).toContain("1=A");
  });
});

describe("68-02 纸笔回录", () => {
  it("解析：=/＝/：/: 分隔宽容；重复保留首条；格式错误逐行可行动", () => {
    const r = parsePaperAnswers("1=A\n2＝对\n3: H2O\n\n4=要点\n2=错");
    expect(r.rows).toEqual([
      { no: 1, given: "A" },
      { no: 2, given: "对" },
      { no: 3, given: "H2O" },
      { no: 4, given: "要点" },
    ]);
    expect(r.errors.map((e) => e.reason)).toEqual([expect.stringContaining("重复")]);
    const bad = parsePaperAnswers("第1题A\n0=B\n5=");
    expect(bad.errors.map((e) => e.reason).join("；")).toContain("格式应为");
  });

  it("判分：对照题册序；越界单列；简答按 not_attempted 口径", () => {
    const rows = parsePaperAnswers("1=A\n2=错\n3=H2O\n4=无色透明液体\n9=Z").rows;
    const { items, outOfRange } = gradePaper(LIST, rows);
    expect(items).toHaveLength(4);
    expect(items[0].verdict).toBe("correct");
    expect(items[1].verdict).toBe("wrong");
    expect(items[2].verdict).toBe("correct");
    expect(items[3].verdict).toBe("not_attempted"); // 简答不自判
    expect(outOfRange).toEqual([9]);
  });
});
