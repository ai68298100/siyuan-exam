import { describe, it, expect } from "vitest";
import {
  nextHintStep,
  buildHintMessages,
  findHintLeaks,
  HINT_LEVEL_LABEL,
} from "../src/ai/hint";
import type { Question } from "../src/core/types";

function q(partial: Partial<Question>): Question {
  return {
    id: "q-test01",
    type: "single",
    stem: "水的化学式是什么？",
    options: ["H2O", "CO2", "O2", "NaCl"],
    answer: "A",
    score: 1,
    origin: "manual",
    hash: "h",
    ...partial,
  };
}

describe("114-01 一次一层推进", () => {
  it("四选项：0→1→2→3，第 3 层后转正式揭示", () => {
    expect(nextHintStep(0, 4)).toEqual({ kind: "hint", level: 1 });
    expect(nextHintStep(1, 4)).toEqual({ kind: "hint", level: 2 });
    expect(nextHintStep(2, 4)).toEqual({ kind: "hint", level: 3 });
    expect(nextHintStep(3, 4)).toEqual({ kind: "reveal" });
  });

  it("判断题（2 选项）第 2 层后结构性必然锁定答案 → 直接转正式揭示", () => {
    expect(nextHintStep(2, 2)).toEqual({ kind: "reveal" });
    expect(nextHintStep(1, 2)).toEqual({ kind: "hint", level: 2 });
  });

  it("三层语义标签不重复且层层递进", () => {
    const labels = [1, 2, 3].map((n) => HINT_LEVEL_LABEL[n as 1 | 2 | 3]);
    expect(new Set(labels).size).toBe(3);
  });
});

describe("114-01 单层提示消息构造", () => {
  it("只申请当前层：system 含层级序号，不含其他层指令", () => {
    const msgs = buildHintMessages(q({}), null, 2, []);
    const sys = msgs[0].content;
    expect(sys).toContain("第 2 层");
    expect(sys).toContain(HINT_LEVEL_LABEL[2]);
    expect(sys).not.toContain(HINT_LEVEL_LABEL[1]);
    expect(sys).not.toContain(HINT_LEVEL_LABEL[3]);
  });

  it("user 携带题面、未提交作答口径与已展示层原文（去重依据）", () => {
    const msgs = buildHintMessages(q({}), "B", 3, ["考化学式记忆", "共价键极性"]);
    const user = msgs[1].content;
    expect(user).toContain("H2O");
    expect(user).toContain("我的作答：B");
    expect(user).toContain("提示1：考化学式记忆");
    expect(user).toContain("提示2：共价键极性");
  });

  it("system 声明泄露红线（答案字母/选项原文/排除至唯一）", () => {
    const sys = buildHintMessages(q({}), null, 1, [])[0].content;
    expect(sys).toContain("不得出现正确答案字母");
    expect(sys).toContain("排除到只剩一个");
  });
});

describe("114-01 泄露守卫", () => {
  it("答案字母披露：『答案是B』『选C』命中", () => {
    expect(findHintLeaks("这题答案是B，注意化学式。", q({})).map((l) => l.kind)).toContain("answer-letter");
    expect(findHintLeaks("先排杂，然后选C。", q({ answer: "C" })).map((l) => l.kind)).toContain("answer-letter");
  });

  it("正常层次提示不误报", () => {
    expect(findHintLeaks("提示：这题考化学式的记忆。", q({}))).toEqual([]);
    expect(findHintLeaks("提示：回忆共价键与离子键的区别，再看各选项组成元素。", q({}))).toEqual([]);
  });

  it("正确选项原文（≥6 字）出现 → 泄露", () => {
    const question = q({ options: ["二氧化碳是一种常见的温室气体", "氮气", "氧气", "氢气"], answer: "A" });
    expect(findHintLeaks("提示：注意「二氧化碳是一种常见的温室气体」这个说法本身。", question).map((l) => l.kind)).toContain("option-text");
    // 短选项不参与原文判定（防误伤）
    expect(findHintLeaks("提示：想想空气里含量最高的气体。", question)).toEqual([]);
  });

  it("简答/填空答案原文（≥4 字）出现 → 泄露；别名同样计入", () => {
    const fill = q({ type: "fill", options: [], answer: "akahdjf", alt: ["物态变化"] });
    expect(findHintLeaks("提示：这就是物态变化的过程。", fill).map((l) => l.kind)).toContain("answer-text");
    expect(findHintLeaks("提示：从能量角度想一想。", fill)).toEqual([]);
  });

  it("排除至唯一：四选项中排除 3 项 → 泄露；排除 2 项不判", () => {
    const uniq = findHintLeaks("提示：排除 A、B、C 后答案就明确了。", q({})).map((l) => l.kind);
    expect(uniq).toContain("eliminate-unique");
    expect(findHintLeaks("提示：先排除 A、B 这两个明显不符的。", q({}))).toEqual([]);
  });
});
