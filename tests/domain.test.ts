import { describe, it, expect } from "vitest";
import { foldText, normalizeAnswer, normalizeJudge, grade, questionHash } from "../src/core/answer";
import { makeQuestion } from "../src/core/blockTemplate";

describe("答案规范化", () => {
  it("foldText：全角/空白折叠", () => {
    expect(foldText("ＡＢＣ　ＤＥ")).toBe("ABC DE");
    expect(foldText("  a   b  ")).toBe("a b");
  });
  it("判断题方言归一化", () => {
    expect(normalizeJudge("对")).toBe("对");
    expect(normalizeJudge("T")).toBe("对");
    expect(normalizeJudge("√")).toBe("对");
    expect(normalizeJudge("是")).toBe("对");
    expect(normalizeJudge("×")).toBe("错");
    expect(normalizeJudge("false")).toBe("错");
    expect(normalizeJudge("否")).toBe("错");
    expect(normalizeJudge("不知道")).toBeNull();
  });
  it("单选取首字母大写", () => {
    expect(normalizeAnswer("single", "b")).toBe("B");
    expect(normalizeAnswer("single", " Ｂ ")).toBe("B");
    expect(normalizeAnswer("single", "xy")).toBeNull();
  });
  it("多选去重排序", () => {
    expect(normalizeAnswer("multiple", "dba")).toBe("ABD");
    expect(normalizeAnswer("multiple", "A,A,c")).toBe("AC");
    expect(normalizeAnswer("multiple", "123")).toBeNull();
  });
});

describe("判分", () => {
  const single = makeQuestion({ type: "single", stem: "1+1=?", options: ["1", "2", "3"], answer: "b" });
  const multi = makeQuestion({ type: "multiple", stem: "偶数?", options: ["1", "2", "3", "4"], answer: "bd" });
  const judge = makeQuestion({ type: "judge", stem: "1>2?", answer: "错" });
  const fill = makeQuestion({ type: "fill", stem: "首都?", answer: "北京", alt: ["beijing"] });

  it("单选", () => {
    expect(grade(single, "B").verdict).toBe("correct");
    expect(grade(single, "a").verdict).toBe("wrong");
  });
  it("多选：集合相等、顺序无关；漏选/多选均错", () => {
    expect(grade(multi, "DB").verdict).toBe("correct");
    expect(grade(multi, "B").verdict).toBe("wrong");
    expect(grade(multi, "BDE").verdict).toBe("wrong");
  });
  it("判断：方言归一化对用户输入同样生效（F=错 判对）", () => {
    expect(grade(judge, "错").verdict).toBe("correct");
    expect(grade(judge, "F").verdict).toBe("correct");
    expect(grade(judge, "对").verdict).toBe("wrong");
    expect(grade(judge, "√").verdict).toBe("wrong"); // judge 答案为"错"，√=对
  });
  it("填空：别名", () => {
    expect(grade(fill, " 北京 ").verdict).toBe("correct");
    expect(grade(fill, "Beijing").verdict).toBe("correct");
    expect(grade(fill, "上海").verdict).toBe("wrong");
  });
  it("空作答 → not_attempted", () => {
    expect(grade(single, "").verdict).toBe("not_attempted");
    expect(grade(single, null).verdict).toBe("not_attempted");
  });
  it("简答不机器判分", () => {
    const s = makeQuestion({ type: "short", stem: "论述", answer: "略" });
    expect(grade(s, "任何作答").verdict).toBe("not_attempted");
  });
});

describe("去重指纹", () => {
  it("同题同指纹；空白全角差异同指纹；不同题不同", () => {
    const a = questionHash("1+1等于几？", ["1", "2"]);
    const b = questionHash("１+１等于几？  ", ["１", "２"]);
    const c = questionHash("1+2等于几？", ["2", "3"]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
