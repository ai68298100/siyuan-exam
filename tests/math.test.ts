// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  normalizeLatexFormula,
  renderLatex,
  renderSemanticLatex,
  renderMathInText,
  getMathPrintStyles,
} from "../src/core/math";
import { renderInlineText, sanitizeRichHtml } from "../src/libs/sanitize";
import { buildCompactQuestionSheetPro, buildCompactAnswerSheetPro } from "../src/core/printPro";
import type { Question } from "../src/core/types";

describe("数学公式处理引擎 (math)", () => {
  describe("1. 公式语法清洗与格式归一化 (normalizeLatexFormula)", () => {
    it("将 \\( ... \\) 转换为 $ ... $，将 \\[ ... \\] 转换为 $$ ... $$", () => {
      const input = "已知函数 \\(f(x) = x^2\\)，其积分表达式为：\\[\\int_0^1 f(x) dx = \\frac{1}{3}\\]";
      const normalized = normalizeLatexFormula(input);
      expect(normalized).toContain("$f(x) = x^2$");
      expect(normalized).toContain("$$\\int_0^1 f(x) dx = \\frac{1}{3}$$");
    });

    it("修复 OCR 扫描中常见的空格断裂与错符", () => {
      const ocrFlawed = "计算：\\ frac { a + 1 } { b - 1 } + \\ sqrt { x } \\ le 0";
      const cleaned = normalizeLatexFormula(ocrFlawed);
      expect(cleaned).toContain("\\frac{a + 1}{b - 1}");
      expect(cleaned).toContain("\\sqrt{x}");
      expect(cleaned).toContain("\\le");
    });
  });

  describe("2. 单公式渲染与语义降级 (renderSemanticLatex & renderLatex)", () => {
    it("降级渲染分式 \\frac{A}{B}", () => {
      const html = renderSemanticLatex("\\frac{1}{2}");
      expect(html).toContain('class="lv-math-frac"');
      expect(html).toContain('<span class="lv-math-num">1</span>');
      expect(html).toContain('<span class="lv-math-denom">2</span>');

      // 验证 renderLatex 降级行为一致
      const generalHtml = renderLatex("\\frac{1}{2}");
      expect(generalHtml).toContain('class="lv-math-frac"');
    });

    it("降级渲染根号 \\sqrt{x}", () => {
      const html = renderSemanticLatex("\\sqrt{x + 1}");
      expect(html).toContain('class="lv-math-sqrt"');
      expect(html).toContain('<span class="lv-math-radical">√</span>');
      expect(html).toContain('<span class="lv-math-radicand">x + 1</span>');
    });

    it("降级渲染三次根号 \\sqrt[3]{8}", () => {
      const html = renderSemanticLatex("\\sqrt[3]{8}");
      expect(html).toContain('<sup class="lv-math-root">3</sup>');
      expect(html).toContain('<span class="lv-math-radical">√</span>');
      expect(html).toContain('<span class="lv-math-radicand">8</span>');
    });

    it("转换希腊字母与常用数学算子", () => {
      const html = renderSemanticLatex("\\alpha + \\beta \\le \\pi \\times \\infty");
      expect(html).toContain("α");
      expect(html).toContain("β");
      expect(html).toContain("≤");
      expect(html).toContain("π");
      expect(html).toContain("×");
      expect(html).toContain("∞");
    });

    it("转换上下标", () => {
      const html = renderSemanticLatex("x^2 + a_1");
      expect(html).toContain('<sup class="lv-math-sup">2</sup>');
      expect(html).toContain('<sub class="lv-math-sub">1</sub>');
    });
  });

  describe("3. 文本混合公式渲染 (renderMathInText)", () => {
    it("解析行内与块级混合公式", () => {
      const text = "求极限 $$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$$，由此可知当 $x$ 极小时成立。";
      const html = renderMathInText(text);
      expect(html).toContain('class="lv-math-block-wrap"');
      expect(html).toContain('class="lv-math-expr lv-math-block"');
      expect(html).toContain('class="lv-math-expr lv-math-inline"');
      expect(html).toContain("由此可知当");
    });

    it("防范 XSS 注入：公式外部文本自动转义", () => {
      const text = "若 <script>alert(1)</script> 满足 $x > 0$";
      const html = renderMathInText(text);
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain('class="lv-math-expr lv-math-inline"');
    });
  });

  describe("4. 选项渲染集成 (renderInlineText) 与样式净化", () => {
    it("renderInlineText 能够渲染包含数学公式的选项", () => {
      const option = "$\\frac{1}{2}$ 且 **大于零**";
      const html = renderInlineText(option);
      expect(html).toContain('class="lv-math-frac"');
      expect(html).toContain("<strong>大于零</strong>");
    });

    it("DOMPurify 放行 lv-math 相关类名和 data-latex", () => {
      const mathHtml = '<span class="lv-math-expr lv-math-inline" data-latex="\\alpha">α</span>';
      const clean = sanitizeRichHtml(mathHtml);
      expect(clean).toContain('class="lv-math-expr lv-math-inline"');
      expect(clean).toContain('data-latex="\\alpha"');
    });
  });

  describe("5. A4 双栏试卷打印排版 (printPro)", () => {
    it("打印样式表包含出版级数学排版规范", () => {
      const css = getMathPrintStyles();
      expect(css).toContain(".lv-math-expr");
      expect(css).toContain(".lv-math-frac");
      expect(css).toContain("white-space: nowrap");
    });

    it("A4 双栏作答卷输出中，题干与选项公式被优雅格式化", () => {
      const q: Question = {
        id: "q-math-1",
        type: "single",
        stem: "设方程 $x^2 - 4 = 0$ 的根为 $x$",
        options: ["$x = 2$", "$x = -2$", "$x = \\pm 2$", "$x = 0$"],
        answer: "C",
        analysis: "由平方差公式得 $(x-2)(x+2)=0$，故 $x = \\pm 2$。",
      };

      const html = buildCompactQuestionSheetPro("2026 高等数学全真模拟卷", [q]);
      expect(html).toContain(".lv-math-expr");
      expect(html).toContain('data-latex="x^2 - 4 = 0"');
      expect(html).toContain('data-latex="x = \\pm 2"');

      const ansHtml = buildCompactAnswerSheetPro("2026 高等数学全真模拟卷", [q]);
      expect(ansHtml).toContain('data-latex="(x-2)(x+2)=0"');
    });
  });
});
