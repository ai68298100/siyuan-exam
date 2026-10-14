import { describe, expect, it } from "vitest";
import { removeChoiceOption } from "../src/core/answerChoices";
import { makeQuestion } from "../src/core/blockTemplate";
import { grade } from "../src/core/answer";

describe("删除选项时迁移正确答案", () => {
  const options = ["甲", "乙", "丙", "丁"];

  it("单选删除前方选项，答案字母前移但仍指向原正确内容", () => {
    const next = removeChoiceOption("single", options, "C", 0);
    expect(next).toEqual({ options: ["乙", "丙", "丁"], answer: "B" });
    const q = makeQuestion({ type: "single", stem: "选择丙", ...next });
    expect(q.options[q.answer.charCodeAt(0) - 65]).toBe("丙");
    expect(grade(q, "B").verdict).toBe("correct");
    expect(grade(q, "C").verdict).toBe("wrong");
    expect(options).toEqual(["甲", "乙", "丙", "丁"]);
  });

  it("单选删除正确项清空答案，删除后方选项保留答案", () => {
    expect(removeChoiceOption("single", options, "B", 1).answer).toBe("");
    expect(removeChoiceOption("single", options, "B", 3).answer).toBe("B");
    expect(removeChoiceOption("single", options, "", 0).answer).toBe("");
  });

  it("多选删掉正确项时仅移除该项，同时前移后面的正确字母", () => {
    const next = removeChoiceOption("multiple", options, "ACD", 2);
    expect(next).toEqual({ options: ["甲", "乙", "丁"], answer: "AC" });
    const q = makeQuestion({ type: "multiple", stem: "选择甲和丁", ...next });
    expect([...q.answer].map((letter) => q.options[letter.charCodeAt(0) - 65])).toEqual(["甲", "丁"]);
    expect(grade(q, "AC").verdict).toBe("correct");
  });

  it("多选删除干扰项时保持正确内容，全删正确项后答案为空", () => {
    const next = removeChoiceOption("multiple", options, "BD", 0);
    expect(next.answer).toBe("AC");
    const one = removeChoiceOption("multiple", next.options, next.answer, 0);
    expect(one.answer).toBe("B");
    expect(removeChoiceOption("multiple", one.options, one.answer, 1).answer).toBe("");
  });

  it("处理手工输入的答案大小写与全角字母；非法删除索引不更改数据", () => {
    expect(removeChoiceOption("multiple", options, "ｄｂ", 0).answer).toBe("AC");
    for (const index of [-1, 4, 0.5, NaN]) {
      expect(removeChoiceOption("single", options, "C", index)).toEqual({ options, answer: "C" });
    }
    expect(removeChoiceOption("judge", options, "对", 0).answer).toBe("对");
  });
});
