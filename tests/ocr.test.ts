import { describe, it, expect } from "vitest";
import {
  parseOcrQuestionText,
  ocrResultToQuestion,
  buildVisionOcrPrompt,
} from "../src/core/ocr";

describe("试题 OCR 识别与结构化提取 (ocr)", () => {
  it("解析标准单选题（包含题号、选项、答案与解析）", () => {
    const rawText = `
      【内部资料 严禁外传】第 1 页（共 4 页）
      1. 下列关于光的波粒二象性说法正确的是（ ）
      A. 光电效应证明了光的波动性
      B. 康普顿效应证明了光的粒子性
      C. 电子衍射证明了微观粒子的宏观性
      D. 德布罗意波即为经典机械波
      【答案】 B
      【解析】康普顿效应证实了光子具有动量，有力支持了光的粒子性。
      【考点】近代物理 / 波粒二象性
    `;

    const parsed = parseOcrQuestionText(rawText);
    expect(parsed.type).toBe("single");
    expect(parsed.stem).toBe("下列关于光的波粒二象性说法正确的是（ ）");
    expect(parsed.options).toHaveLength(4);
    expect(parsed.options[0]).toBe("光电效应证明了光的波动性");
    expect(parsed.options[1]).toBe("康普顿效应证明了光的粒子性");
    expect(parsed.answer).toBe("B");
    expect(parsed.analysis).toContain("康普顿效应证实了光子具有动量");
    expect(parsed.kp).toBe("近代物理 / 波粒二象性");
    expect(parsed.confidence).toBeGreaterThanOrEqual(80);
  });

  it("智能切分同一行内的多选项（A. ... B. ... C. ... D. ...）", () => {
    const rawText = `
      12. 若集合 M={1, 2}, N={2, 3}，则 M ∩ N 等于（ ）
      A. {1}    B. {2}    C. {3}    D. {1, 2, 3}
      参考答案：B
    `;

    const parsed = parseOcrQuestionText(rawText);
    expect(parsed.type).toBe("single");
    expect(parsed.options).toHaveLength(4);
    expect(parsed.options[0]).toBe("{1}");
    expect(parsed.options[1]).toBe("{2}");
    expect(parsed.options[2]).toBe("{3}");
    expect(parsed.options[3]).toBe("{1, 2, 3}");
    expect(parsed.answer).toBe("B");
  });

  it("识别判断题（√/× 或 对/错）", () => {
    const rawText = `
      【判断题】3. 质点做匀速圆周运动时，向心加速度保持不变。
      【答案】错误
      【解析】向心加速度方向始终指向圆心，方向时刻改变，不是恒定加速度。
    `;

    const parsed = parseOcrQuestionText(rawText);
    expect(parsed.type).toBe("judge");
    expect(parsed.stem).toBe("质点做匀速圆周运动时，向心加速度保持不变。");
    expect(parsed.answer).toBe("错");
  });

  it("识别多选题与多字母答案", () => {
    const rawText = `
      5. 下列属于物权客体的是（ ）
      A. 土地
      B. 房屋
      C. 智力成果
      D. 货币
      【答案】 ABD
    `;

    const parsed = parseOcrQuestionText(rawText);
    expect(parsed.type).toBe("multiple");
    expect(parsed.answer).toBe("ABD");
    expect(parsed.options).toHaveLength(4);
  });

  it("识别带数学公式的题目并自动语法规范化", () => {
    const rawText = `
      8. 求函数 \\( f(x) = \\ frac { 1 } { x } \\) 在区间 [1, 2] 上的定积分。
      A. \\( \\ln 2 \\)   B. \\( 2 \\ln 2 \\)   C. 1   D. 0.5
      【答案】A
    `;

    const parsed = parseOcrQuestionText(rawText);
    expect(parsed.stem).toContain("$f(x) = \\frac{1}{x}$");
    expect(parsed.options[0]).toBe("$\\ln 2$");
    expect(parsed.answer).toBe("A");
  });

  it("ocrResultToQuestion 成功转换为 Question 实体", () => {
    const parsed = parseOcrQuestionText("1. 测试题干\nA. 选项1\nB. 选项2\n【答案】A");
    const q = ocrResultToQuestion(parsed, { source: "2026年真题试卷第1页.png" });

    expect(q.id.startsWith("ocr-")).toBe(true);
    expect(q.stem).toBe("测试题干");
    expect(q.options).toHaveLength(2);
    expect(q.answer).toBe("A");
    expect(q.source).toBe("2026年真题试卷第1页.png");
  });

  it("buildVisionOcrPrompt 生成多模态提题规范提示词", () => {
    const prompt = buildVisionOcrPrompt();
    expect(prompt).toContain("LaTeX");
    expect(prompt).toContain("JSON");
    expect(prompt).toContain('"type":');
  });
});
