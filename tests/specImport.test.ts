// 54 第三刀：填空答案的结构化识别（inferAnswerSpec）+ 作答框辅助函数 + 手工录题入口
import { describe, expect, it } from "vitest";
import { grade } from "../src/core/answer";
import { inferAnswerSpec, splitBlanks, joinBlanks, gradeWithSpec } from "../src/core/structuredAnswer";
import { makeQuestion } from "../src/core/blockTemplate";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import { questionDraftFromRevision, type QuestionRevision } from "../src/core/revision";
import type { KernelApiClient } from "../src/kernel/client";

describe("inferAnswerSpec（导入识别）", () => {
  it('多空：";;" ≥2 段 → multiBlank，逐段为主答案', () => {
    const spec = inferAnswerSpec("fill", "光年;;天文单位");
    expect(spec?.kind).toBe("multiBlank");
    expect(spec?.kind === "multiBlank" && spec.blanks).toHaveLength(2);
    expect(spec?.kind === "multiBlank" && spec.blanks[1].answers).toEqual(["天文单位"]);
  });

  it("数值：纯数值±单位 → numeric（单位入 spec）", () => {
    expect(inferAnswerSpec("fill", "340 m/s")).toEqual({ v: 1, kind: "numeric", unit: "m/s" });
    expect(inferAnswerSpec("fill", "-1,234.5")).toEqual({ v: 1, kind: "numeric" });
  });

  it("非数值/单段文本 → undefined（旧口径）；非填空题型不识别", () => {
    expect(inferAnswerSpec("fill", "保留")).toBeUndefined();
    expect(inferAnswerSpec("fill", "光年;;")).toBeUndefined(); // 单段（分号后为空）
    expect(inferAnswerSpec("single", "1.5 m")).toBeUndefined();
  });
});

describe("编辑修订 JSON 持久化与完整恢复", () => {
  function setup() {
    let lastMd = "";
    let clock = 1;
    const attrs: Record<string, unknown>[] = [];
    const client = {
      updateBlock: async (_block: string, markdown: string) => { lastMd = markdown; },
      getBlockKramdown: async () => lastMd,
      setExamAttrs: async (_block: string, values: Record<string, unknown>) => { attrs.push(values); },
    } as unknown as KernelApiClient;
    const app = new ExamApp({ client, storage: new MemoryStorage(), now: () => clock++ });
    app.kernelOnline = true;
    return { app, attrs };
  }

  it("清空值经过 JSON 落盘仍可恢复，恢复后不会留下后来新增的字段", async () => {
    const { app, attrs } = setup();
    const initial = {
      ...makeQuestion({ type: "fill", stem: "数值？", options: [], answer: "3.14" }),
      analysis: "原解析", kp: "原考点", difficulty: 2, blockId: "b-clear",
    };
    const cleared = await app.updateQuestionContent(initial, {
      stem: initial.stem, options: [], answer: initial.answer, analysis: "", kp: "", answerSpec: null,
    });
    const snapshot = JSON.parse(JSON.stringify((await app.questionRevisions(initial.id))[0])) as QuestionRevision;
    expect(snapshot).toMatchObject({ analysis: "", kp: "", difficulty: null, answerSpec: null });
    const later = await app.updateQuestionContent({ ...cleared, blockId: initial.blockId }, {
      stem: initial.stem, options: [], answer: initial.answer, analysis: "后来解析", kp: "后来考点", difficulty: 5,
      answerSpec: { v: 1, kind: "numeric", absTol: 0.1 },
    });
    const restored = await app.updateQuestionContent({ ...later, blockId: initial.blockId }, questionDraftFromRevision(later, snapshot));
    expect(restored.analysis).toBeUndefined();
    expect(restored.kp).toBeUndefined();
    expect(restored.difficulty).toBeUndefined();
    expect(restored.answerSpec).toBeUndefined();
    expect(attrs.at(-1)?.["exam-answer-spec"]).toBe("");
  });

  it("连续只修改数值容差会记录两版，恢复后判分与历史规格一致", async () => {
    const { app, attrs } = setup();
    const initial = { ...makeQuestion({ type: "fill", stem: "圆周率？", options: [], answer: "3.14" }), blockId: "b-numeric" };
    const draft = { stem: initial.stem, options: [], answer: initial.answer, analysis: "", kp: "" };
    const strict = await app.updateQuestionContent(initial, { ...draft, answerSpec: { v: 1, kind: "numeric", absTol: 0.01 } });
    const wide = await app.updateQuestionContent({ ...strict, blockId: initial.blockId }, { ...draft, answerSpec: { v: 1, kind: "numeric", absTol: 0.05 } });
    const history = JSON.parse(JSON.stringify(await app.questionRevisions(initial.id))) as QuestionRevision[];
    expect(history).toHaveLength(2);
    expect(grade(wide, "3.17").verdict).toBe("correct");
    const restored = await app.updateQuestionContent({ ...wide, blockId: initial.blockId }, questionDraftFromRevision(wide, history[0]));
    expect(restored.answerSpec).toEqual({ v: 1, kind: "numeric", absTol: 0.01 });
    expect(grade(restored, "3.17").verdict).toBe("wrong");
    expect(attrs.at(-1)?.["exam-answer-spec"]).toBe(JSON.stringify(history[0].answerSpec));
  });

  it("多空嵌套别名和大小写规则完整冻结与恢复", async () => {
    const { app } = setup();
    const initial = { ...makeQuestion({ type: "fill", stem: "单位？", options: [], answer: "光年;;天文单位" }), blockId: "b-multi" };
    const spec = { v: 1 as const, kind: "multiBlank" as const, blanks: [{ answers: ["光年", "ly"], caseSensitive: true }, { answers: ["天文单位", "AU"], caseSensitive: false }] };
    const first = await app.updateQuestionContent(initial, {
      stem: initial.stem, options: [], answer: initial.answer, analysis: "", kp: "", answerSpec: spec,
    });
    spec.blanks[0].answers.push("不应污染历史");
    const history = JSON.parse(JSON.stringify(await app.questionRevisions(initial.id))) as QuestionRevision[];
    expect(history[0].answerSpec).not.toEqual(spec);
    const later = { ...first, answerSpec: undefined };
    const restored = await app.updateQuestionContent({ ...later, blockId: initial.blockId }, questionDraftFromRevision(later, history[0]));
    expect(restored.answerSpec).toEqual(history[0].answerSpec);
    expect(grade(restored, "ly;;au").verdict).toBe("correct");
    expect(grade(restored, "LY;;au").verdict).toBe("wrong");
  });
});

describe("splitBlanks/joinBlanks（作答框草稿辅助）", () => {
  it("切分不足补空串，多余段保留", () => {
    expect(splitBlanks("a;;b", 3)).toEqual(["a", "b", ""]);
    expect(splitBlanks("a;;b;;c", 2)).toEqual(["a", "b", "c"]);
    expect(joinBlanks(["a", "", "c"])).toBe("a;;;;c");
  });
});

describe("数值/多空题端到端判分口径（导入识别 → grade）", () => {
  const numericQ = {
    id: "q-n", type: "fill", stem: "速度？", options: [], answer: "340 m/s",
    answerSpec: inferAnswerSpec("fill", "340 m/s")!,
  } as never;
  const multiQ = {
    id: "q-m", type: "fill", stem: "单位？", options: [], answer: "光年;;天文单位",
    answerSpec: inferAnswerSpec("fill", "光年;;天文单位")!,
  } as never;

  it("数值：主单位精确/宽容解析判对、异单位无换算表判错、数值不符判错", () => {
    expect(gradeWithSpec(numericQ, "340 m/s")?.verdict).toBe("correct");
    expect(gradeWithSpec(numericQ, "340")?.reason).toBe("exact"); // 无后缀视为主单位
    // 导入识别不带 altUnits（换算表需题作者后续补充）——异单位如实判错
    expect(gradeWithSpec(numericQ, "0.34 km/s")?.verdict).toBe("wrong");
    expect(gradeWithSpec(numericQ, "350 m/s")?.verdict).toBe("wrong");
  });

  it("多空：逐空按位置判分", () => {
    expect(gradeWithSpec(multiQ, "天文单位;;光年")?.verdict).toBe("wrong"); // 顺序对应：第 1 空填了第 2 空的答案
    expect(gradeWithSpec(multiQ, "光年;;天文单位")?.verdict).toBe("correct");
  });

  it("answer.ts grade 接线：带 spec 题型走结构化口径", () => {
    expect(grade(numericQ, "340").verdict).toBe("correct");
    expect(grade(numericQ, "340 m/s").verdict).toBe("correct");
    expect(grade(numericQ, "999").verdict).toBe("wrong");
  });
});

describe("makeQuestion 推断 + 手工录题入口（B1 编辑入口）", () => {
  it("数值填空自动附 numeric spec；多空附 multiBlank；文本/选择题不附", () => {
    expect(makeQuestion({ type: "fill", stem: "v?", options: [], answer: "340 m/s" }).answerSpec).toEqual({
      v: 1, kind: "numeric", unit: "m/s",
    });
    expect(makeQuestion({ type: "fill", stem: "u?", options: [], answer: "光年;;天文单位" }).answerSpec?.kind).toBe("multiBlank");
    expect(makeQuestion({ type: "fill", stem: "x?", options: [], answer: "保留" }).answerSpec).toBeUndefined();
    expect(makeQuestion({ type: "single", stem: "s?", options: ["1", "2"], answer: "A" }).answerSpec).toBeUndefined();
  });

  it("writeManualQuestion：带 spec 的手录题写入 exam-answer-spec 块属性", async () => {
    const setCalls: Record<string, unknown>[] = [];
    const client = {
      createDocWithMd: async () => "doc-1",
      appendQuestions: async (_doc: string, qs: { id: string }[]) => qs.map((q) => ({ qid: q.id, blockId: "b-" + q.id })),
      setExamAttrs: async (_block: string, attrs: Record<string, unknown>) => {
        setCalls.push(attrs);
      },
      sql: async () => [],
    } as unknown as KernelApiClient;
    const app = new ExamApp({ client, storage: new MemoryStorage() });
    const q = makeQuestion({ type: "fill", stem: "速度？", options: [], answer: "340 m/s" });
    expect(q.answerSpec).toBeDefined();
    await app.writeManualQuestion("nb-1", q);
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]["exam-answer-spec"]).toBe(JSON.stringify(q.answerSpec));
  });

  it("updateQuestionContent：答案变更 → spec 重推断同步；改为文本 → 属性清空", async () => {
    const setCalls: { block: string; attrs: Record<string, unknown> }[] = [];
    let lastMd = "";
    const client = {
      updateBlock: async (_b: string, md: string) => {
        lastMd = md;
        return "ok";
      },
      getBlockKramdown: async () => lastMd, // 读回=写入的 markdown（含生成的 exam-id）
      setExamAttrs: async (block: string, attrs: Record<string, unknown>) => {
        setCalls.push({ block, attrs });
      },
    } as unknown as KernelApiClient;
    const app = new ExamApp({ client, storage: new MemoryStorage() });
    app.kernelOnline = true;
    const q = {
      ...makeQuestion({ type: "fill", stem: "速度？", options: [], answer: "340 m/s" }),
      blockId: "b-1",
    } as never as Parameters<ExamApp["updateQuestionContent"]>[0];
    // 改为另一个数值+单位 → 重推断出新 spec（unit 变更）
    const r1 = await app.updateQuestionContent(q, {
      stem: "速度？", options: [], answer: "0.34 km/s", analysis: "", kp: "", difficulty: undefined,
    });
    expect(r1.answerSpec).toEqual({ v: 1, kind: "numeric", unit: "km/s" });
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].attrs["exam-answer-spec"]).toBe(JSON.stringify({ v: 1, kind: "numeric", unit: "km/s" }));
    // 改为不可识别文本 → 属性清空（回旧字符串口径），避免陈旧数值 spec 全判错
    const r2 = await app.updateQuestionContent({ ...r1, blockId: "b-1" }, {
      stem: "速度？", options: [], answer: "三百四十米每秒", analysis: "", kp: "", difficulty: undefined,
    });
    expect(r2.answerSpec).toBeUndefined();
    expect(setCalls).toHaveLength(2);
    expect(setCalls[1].attrs["exam-answer-spec"]).toBe("");
  });

  it("updateQuestionContent：答案未变（只改题干）→ 不触碰 spec", async () => {
    const setCalls: unknown[] = [];
    let lastMd = "";
    const client = {
      updateBlock: async (_b: string, md: string) => {
        lastMd = md;
        return "ok";
      },
      getBlockKramdown: async () => lastMd,
      setExamAttrs: async (_b: string, attrs: Record<string, unknown>) => {
        setCalls.push(attrs);
      },
    } as unknown as KernelApiClient;
    const app = new ExamApp({ client, storage: new MemoryStorage() });
    app.kernelOnline = true;
    const q = {
      ...makeQuestion({ type: "fill", stem: "速度？", options: [], answer: "340 m/s" }),
      blockId: "b-1",
    } as never as Parameters<ExamApp["updateQuestionContent"]>[0];
    await app.updateQuestionContent(q, {
      stem: "声音在 15℃ 空气中的传播速度（填数值与单位）？", options: [], answer: "340 m/s", analysis: "", kp: "", difficulty: undefined,
    });
    expect(setCalls).toHaveLength(0);
  });
});
