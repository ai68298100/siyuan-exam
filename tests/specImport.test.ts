// 54 第三刀：填空答案的结构化识别（inferAnswerSpec）+ 作答框辅助函数
import { describe, expect, it } from "vitest";
import { grade } from "../src/core/answer";
import { inferAnswerSpec, splitBlanks, joinBlanks, gradeWithSpec } from "../src/core/structuredAnswer";

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
