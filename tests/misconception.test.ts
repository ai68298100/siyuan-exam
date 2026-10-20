import { describe, it, expect } from "vitest";
import type { AttemptEvent, Question } from "../src/core/types";
import {
  diagnoseMisconceptions,
  exportMisconceptionMarkdown,
  type OptionMisconception,
} from "../src/core/misconception";

function mkQ(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    type: "single",
    stem: `题目 ${id}`,
    options: ["选项A", "选项B", "选项C", "选项D"],
    answer: "A",
    score: 1,
    origin: "manual",
    hash: `hash-${id}`,
    ...overrides,
  };
}

function mkEvent(qid: string, myAnswer: string, ts: number): AttemptEvent {
  return {
    v: 1,
    eid: `e-${qid}-${ts}`,
    ts,
    qid,
    kind: "practice",
    mode: "single",
    verdict: "wrong",
    myAnswer,
    queue: "normal",
    device: "d1",
    seq: ts,
    sessionId: "s1",
  };
}

const sampleMisconceptions: OptionMisconception[] = [
  {
    letter: "B",
    concept: "现期比重 vs 基期比重",
    trapDescription: "直接用现期部分量与总量相除，忽略了二者的增长率不同",
    counterRule: "基期比重 = (A/B) × ((1+b)/(1+a))，需逆推基期增长率",
  },
  {
    letter: "C",
    concept: "同比与环比混淆",
    trapDescription: "把与上月对比的数据当成了与去年同期对比",
  },
];

describe("Misconception 选项干扰项误概念对照引擎 (52-05 / 43-02)", () => {
  it("无错误作答时返回空诊断，不盲目生成认知推断", () => {
    const q = mkQ("q1");
    const res = diagnoseMisconceptions({
      question: q,
      events: [],
      misconceptions: sampleMisconceptions,
    });

    expect(res.hasDiagnosis).toBe(false);
    expect(res.repeatedErrorFound).toBe(false);
    expect(res.items).toHaveLength(0);
  });

  it("单次选错干扰项：给出温和提示，不标记为高频重复错误 (52-05 诚实边界)", () => {
    const q = mkQ("q1");
    const events = [mkEvent("q1", "B", 100)];

    const res = diagnoseMisconceptions({
      question: q,
      events,
      misconceptions: sampleMisconceptions,
    });

    expect(res.hasDiagnosis).toBe(true);
    expect(res.repeatedErrorFound).toBe(false);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].isRepeatedError).toBe(false);
    expect(res.items[0].advisoryText).toContain("曾选选项 B（1次）");
    expect(res.boundaryDisclaimer).toContain("单次选错仅作启发式提示");
  });

  it("多次重复选错同一干扰项 (≥2次)：触发高频认知陷阱警报与深度辨析准则", () => {
    const q = mkQ("q1");
    const events = [
      mkEvent("q1", "B", 100),
      mkEvent("q1", "B", 200),
      mkEvent("q1", "C", 300),
    ];

    const res = diagnoseMisconceptions({
      question: q,
      events,
      misconceptions: sampleMisconceptions,
      minRepeatCount: 2,
    });

    expect(res.repeatedErrorFound).toBe(true);
    expect(res.items).toHaveLength(2);

    // 选项 B 选了 2 次，属于高频重复错误
    const itemB = res.items.find((i) => i.letter === "B");
    expect(itemB?.isRepeatedError).toBe(true);
    expect(itemB?.pickCount).toBe(2);
    expect(itemB?.advisoryText).toContain("检测到重复选择选项 B");
    expect(itemB?.advisoryText).toContain("现期比重 vs 基期比重");
    expect(itemB?.advisoryText).toContain("辨析准则");

    // 选项 C 只选了 1 次，不构成高频
    const itemC = res.items.find((i) => i.letter === "C");
    expect(itemC?.isRepeatedError).toBe(false);
  });

  it("题面发生版本修订时，检出陈旧态 (isStale)", () => {
    const q = mkQ("q1", { hash: "new-hash-v2" });
    const events = [mkEvent("q1", "B", 100)];

    const res = diagnoseMisconceptions({
      question: q,
      events,
      misconceptions: sampleMisconceptions,
      currentQuestionHash: "old-hash-v1", // 模拟题库中题目已更新
    });

    expect(res.isStale).toBe(true);

    const md = exportMisconceptionMarkdown(res);
    expect(md).toContain("题目内容已发生修订，对照建议基于历史题面生成");
  });

  it("exportMisconceptionMarkdown 导出结构化排版卡片", () => {
    const q = mkQ("q1");
    const events = [mkEvent("q1", "B", 100), mkEvent("q1", "B", 200)];

    const res = diagnoseMisconceptions({
      question: q,
      events,
      misconceptions: sampleMisconceptions,
    });

    const md = exportMisconceptionMarkdown(res);
    expect(md).toContain("【干扰项易错概念与认知对照】");
    expect(md).toContain("【高频重复错因】");
    expect(md).toContain("选项 B");
    expect(md).toContain("现期比重 vs 基期比重");
  });
});
