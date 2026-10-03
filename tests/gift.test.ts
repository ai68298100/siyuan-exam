import { describe, it, expect } from "vitest";
import { parseGift } from "../src/importer/gift";

const SINGLE = `::基础::思源笔记的内核是什么语言编写的？{
=Rust#思源 3.x 起内核为 Go→Rust 演进
~JavaScript
~Python}`;

const MULTI = `下列哪些是思源的特性？{
~云绑定强制
=本地优先
=块引用
~订阅制}`;

const JUDGE = `思源笔记是本地优先的笔记软件。{TRUE}`;

const SHORT = `1 + 1 等于几？{=2#两单位相加}`;

describe("GIFT 解析器（TODO 5 组）", () => {
  it("单选：= 正确 + ~ 干扰，::标题 → kp", () => {
    const r = parseGift(SINGLE);
    expect(r.ok).toHaveLength(1);
    const q = r.ok[0];
    expect(q.type).toBe("single");
    expect(q.stem).toContain("内核");
    expect(q.options).toEqual(["Rust", "JavaScript", "Python"]);
    expect(q.answer).toBe("A");
    expect(q.kp).toBe("基础");
    expect(q.analysis).toContain("Rust");
  });

  it("多选：多个 = → 字母序答案", () => {
    const r = parseGift(MULTI);
    expect(r.ok[0].type).toBe("multiple");
    expect(r.ok[0].answer).toBe("BC");
  });

  it("判断题：TRUE → 对", () => {
    const r = parseGift(JUDGE);
    expect(r.ok[0].type).toBe("judge");
    expect(r.ok[0].answer).toBe("对");
  });

  it("短答：= 文本 # 反馈", () => {
    const r = parseGift(SHORT);
    expect(r.ok[0].type).toBe("short");
    expect(r.ok[0].answer).toBe("2");
  });

  it("格式错误 → 错误清单（含行号）", () => {
    const r = parseGift("没有大括号的行");
    expect(r.ok).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].reason).toContain("GIFT");
  });

  it("空输入 → 空报告", () => {
    const r = parseGift("");
    expect(r.ok).toHaveLength(0);
    expect(r.errors).toHaveLength(0);
  });
});
