import { describe, it, expect } from "vitest";
import { parseNumeric, gradeNumeric, gradeWithSpec } from "../src/core/structuredAnswer";
import { grade } from "../src/core/answer";
import type { Question } from "../src/core/types";

const spec = {
  v: 1 as const,
  kind: "numeric" as const,
  unit: "km",
  absTol: 0.01,
  altUnits: [{ unit: "m", factor: 0.001 }],
};

function numQ(answer: string): Question {
  return {
    id: "q-num0001",
    type: "fill",
    stem: "求距离（km）",
    options: [],
    answer,
    score: 1,
    origin: "manual",
    hash: "h",
    answerSpec: spec,
  };
}

describe("54-02 数值解析", () => {
  it("半角/全角小数点、千分位、负号、科学计数法（含 ×10^）", () => {
    expect(parseNumeric("1.5")).toBe(1.5);
    expect(parseNumeric("1．5")).toBe(1.5);
    expect(parseNumeric("1,234.5")).toBe(1234.5);
    expect(parseNumeric("-2.5")).toBe(-2.5);
    expect(parseNumeric("1e-3")).toBe(0.001);
    expect(parseNumeric("3×10^8")).toBe(3e8);
    expect(parseNumeric("abc")).toBeNull();
  });
});

describe("54-02 数值判分（54-02 验收 fixtures：边界/负数/小数分隔/等价单位）", () => {
  it("精确命中 exact；绝对容差边界含入", () => {
    expect(gradeNumeric(spec, "42.0", "42").reason).toBe("exact");
    expect(gradeNumeric(spec, "1.00", "1.01").correct).toBe(true); // |0.01| ≤ absTol
    expect(gradeNumeric(spec, "1.00", "1.02").correct).toBe(false);
  });

  it("相对容差：未配 absTol 时按百分比", () => {
    const rel = { v: 1 as const, kind: "numeric" as const, relTolerance: 5 };
    expect(gradeNumeric(rel, "100", "103").reason).toBe("relative-tolerance");
    expect(gradeNumeric(rel, "100", "106").correct).toBe(false);
    // 零期望值：相对容差无定义 → 不命中（不以浮点直接相等的口径兜底 absTol 缺省）
    expect(gradeNumeric(rel, "0", "0.0001").correct).toBe(false);
  });

  it("等价单位换算：m→km 因子换算后判分；单位后缀剥离", () => {
    expect(gradeNumeric(spec, "1", "1000 m").reason).toBe("unit-converted");
    expect(gradeNumeric(spec, "1", "1000m").correct).toBe(true);
    expect(gradeNumeric(spec, "1", "999 m").correct).toBe(true); // 999m=0.999km，在 absTol 0.01km 内
    expect(gradeNumeric(spec, "1", "900 m").correct).toBe(false); // 0.9km 超容差
  });

  it("负数与小数分隔：-2.5＝-2.5 exact；不可解析如实 unparseable", () => {
    expect(gradeNumeric(spec, "-2.5", "-2.5").reason).toBe("exact");
    expect(gradeNumeric(spec, "-2.5", "abc").reason).toBe("unparseable");
  });
});

describe("54-01 grade 接线与向后兼容", () => {
  it("带 spec 的题走数值判分（含单位换算）；无 spec 完全走旧口径", () => {
    const withSpec = numQ("1");
    expect(grade(withSpec, "1000 m").verdict).toBe("correct");
    expect(grade(withSpec, "0.5").verdict).toBe("wrong");
    const plain: Question = { ...numQ("1"), answerSpec: undefined };
    expect(grade(plain, "1").verdict).toBe("correct"); // 字符串口径
    expect(grade(plain, "1000 m").verdict).toBe("wrong"); // 不做数值巧合
  });

  it("版本不符或未知 kind → null 按旧口径（不误判）", () => {
    const future = { ...numQ("1"), answerSpec: { v: 2, kind: "numeric", absTol: 0.01 } as unknown as Question["answerSpec"] };
    expect(gradeWithSpec(future, "1")).toBeNull();
    expect(grade(future, "1").verdict).toBe("correct");
  });
});
