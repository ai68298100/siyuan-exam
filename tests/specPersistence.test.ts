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

// ---------- 55-05：主观采分点块属性往返 ----------

const RUBRIC = {
  v: 1 as const,
  kind: "rubric" as const,
  fullScore: 10,
  revision: 2,
  criteria: [
    { id: "c1", label: "核心观点", weight: 0.4 },
    { id: "c2", label: "论证结构", weight: 0.3 },
    { id: "c3", label: "语言表达", weight: 0.3 },
  ],
};

function shortBlockInput(rubricAttr?: string) {
  return {
    attrs: {
      "custom-exam-id": "q-sho11111",
      "custom-exam-type": "short",
      "custom-exam-answer": "参考答案要点",
      ...(rubricAttr != null ? { "custom-exam-rubric": rubricAttr } : {}),
    },
    text: "论述三方关系\n答案：参考答案要点",
  };
}

describe("55-05：rubric 块属性（往返不丢 + 诚实降级）", () => {
  it("合法 JSON → rubric 还原（权重与修订号保留）", () => {
    const q = questionFromBlock(shortBlockInput(JSON.stringify(RUBRIC)));
    expect(q?.rubric?.criteria.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(q?.rubric?.criteria[0].weight).toBeCloseTo(0.4, 6);
    expect(q?.rubric?.revision).toBe(2);
    expect(q?.rubric?.fullScore).toBe(10);
  });

  it("损坏 JSON / 版本不符 / kind 不符 / 缺失 → undefined（按无 rubric 处理，不误报）", () => {
    expect(questionFromBlock(shortBlockInput("{broken"))?.rubric).toBeUndefined();
    expect(questionFromBlock(shortBlockInput(JSON.stringify({ v: 2, kind: "rubric", criteria: [{ label: "x" }] })))?.rubric).toBeUndefined();
    expect(questionFromBlock(shortBlockInput(JSON.stringify({ v: 1, kind: "other", criteria: [{ label: "x" }] })))?.rubric).toBeUndefined();
    expect(questionFromBlock(shortBlockInput())?.rubric).toBeUndefined();
  });

  it("采分点权重写入前归一到合计 1（避免手填小数导致满分漂移）", () => {
    const q = questionFromBlock(
      shortBlockInput(JSON.stringify({
        v: 1,
        kind: "rubric",
        fullScore: 10,
        criteria: [
          { id: "a", label: "甲", weight: 6 },
          { id: "b", label: "乙", weight: 4 },
        ],
      })),
    );
    const total = (q?.rubric?.criteria ?? []).reduce((s, c) => s + c.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("简答题答案不受 rubric 影响（旧答案可读）", () => {
    const q = questionFromBlock(shortBlockInput(JSON.stringify(RUBRIC)));
    expect(q?.answer).toBe("参考答案要点");
  });
});
