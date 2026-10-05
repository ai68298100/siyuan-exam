import { describe, it, expect } from "vitest";
import { questionFromBlock } from "../src/core/blockTemplate";
import { grade } from "../src/core/answer";

const SPEC = { v: 1 as const, kind: "numeric" as const, unit: "km", absTol: 0.01, altUnits: [{ unit: "m", factor: 0.001 }] };

function blockInput(answerSpecAttr?: string) {
  return {
    attrs: {
      "custom-exam-id": "q-aaa11111",
      "custom-exam-type": "fill",
      "custom-exam-answer": "1",
      ...(answerSpecAttr != null ? { "custom-exam-answer-spec": answerSpecAttr } : {}),
    },
    text: "求距离\n答案：42",
  };
}

describe("54-01 第二刀：spec 块属性读取（往返不丢）", () => {
  it("合法 JSON → answerSpec 还原（数值判分可用）", () => {
    const q = questionFromBlock(blockInput(JSON.stringify(SPEC)));
    expect(q?.answerSpec).toEqual(SPEC);
    // 判分走数值口径（m 换算）
    expect(q ? gradeCheck(q, "1000 m") : null).toBe(true);
  });

  it("损坏 JSON / 版本不符 / 缺失 → undefined（按旧口径判分，不误判）", () => {
    expect(questionFromBlock(blockInput("{broken"))?.answerSpec).toBeUndefined();
    expect(questionFromBlock(blockInput(JSON.stringify({ v: 2, kind: "numeric" })))?.answerSpec).toBeUndefined();
    expect(questionFromBlock(blockInput())?.answerSpec).toBeUndefined();
  });

  it("字符串答案不受影响（旧答案可读）", () => {
    const q = questionFromBlock(blockInput(JSON.stringify(SPEC)));
    expect(q?.answer).toBe("1");
  });
});

function gradeCheck(qv: NonNullable<ReturnType<typeof questionFromBlock>>, given: string): boolean {
  return grade(qv, given).verdict === "correct";
}
