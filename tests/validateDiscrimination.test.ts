import { describe, it, expect } from "vitest";
import { validate } from "../src/importer/pipeline";
import { makeQuestion } from "../src/core/blockTemplate";
import type { Question } from "../src/core/types";

const q = (over: Partial<Question>): Question =>
  makeQuestion({
    type: "single",
    stem: "下列说法正确的是哪一项？",
    options: ["甲", "乙", "丙"],
    answer: "A",
    ...over,
  } as Parameters<typeof makeQuestion>[0]);

describe("选项区分度与题干泄漏校验（5 组对账：答案命中选项专项）", () => {
  it("既有校验不回归：字母越界/选项不足仍拦截", () => {
    expect(validate(q({ answer: "D" }))).toContain("超出选项范围");
    expect(validate(q({ options: ["甲"], answer: "A" }))).toContain("至少需要 2 个选项");
  });

  it("空选项拦截（AI 生成 JSON 常见空串选项）", () => {
    expect(validate(q({ options: ["甲", "", "丙"], answer: "A" }))).toContain("空选项");
  });

  it("选项内容重复拦截（折叠空白/全角后比对）", () => {
    expect(validate(q({ options: ["甲", "乙", "甲"], answer: "A" }))).toContain("选项内容重复");
    expect(validate(q({ options: ["ＡＢＣ", "ＡＢＣ"], answer: "A" }))).toContain("选项内容重复"); // 全角折叠后相同
    expect(validate(q({ options: ["甲", "乙", "丙"], answer: "A" }))).toBeNull();
  });

  it("题干泄漏答案拦截：正确选项文本逐字出现在题干中（≥4 字符）", () => {
    const leak = makeQuestion({
      type: "single",
      stem: "我们都知道光合作用制造氧气，那么下列说法正确的是哪一项？",
      options: ["光合作用制造氧气", "呼吸作用放热", "蒸腾作用吸水"],
      answer: "A",
    });
    expect(validate(leak)).toContain("题干泄漏答案");
  });

  it("不误伤：短选项/题干正常引用不触发泄漏判定", () => {
    // 选项 3 字符（<4）不判泄漏
    const short = makeQuestion({
      type: "single",
      stem: "下列哪个是氧气？空气中含有什么？",
      options: ["氧气", "氮气", "氢气"],
      answer: "A",
    });
    expect(validate(short)).toBeNull();
  });
});
