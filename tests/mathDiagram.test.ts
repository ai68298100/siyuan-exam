import { describe, it, expect } from "vitest";
import {
  renderFunctionPlotSvg,
  renderTriangleSvg,
  renderBarChartSvg,
  renderPieChartSvg,
  renderNumberLineSvg,
  renderMathDiagramsInText,
} from "../src/core/mathDiagram";
import { renderSemanticLatex } from "../src/core/math";

describe("数学矢量图表与高阶公式引擎 (mathDiagram & math)", () => {
  describe("1. 函数图像直角坐标系绘制 (renderFunctionPlotSvg)", () => {
    it("绘制一元二次函数 y = x^2 - 2 曲线与坐标轴", () => {
      const svg = renderFunctionPlotSvg("y = x^2 - 2", {
        xRange: [-3, 3],
        yRange: [-3, 5],
        title: "二次函数",
      });

      expect(svg).toContain("<svg");
      expect(svg).toContain('class="lv-math-diagram lv-math-plot"');
      expect(svg).toContain('<path d="M'); // 光滑采样曲线
      expect(svg).toContain(">x</text>"); // X 轴标号
      expect(svg).toContain(">y</text>"); // Y 轴标号
      expect(svg).toContain(">O</text>"); // 原点标号
      expect(svg).toContain("二次函数");
    });

    it("绘制正弦曲线 y = sin(x)", () => {
      const svg = renderFunctionPlotSvg("y = sin(x)");
      expect(svg).toContain("<svg");
      expect(svg).toContain('<path d="M');
    });
  });

  describe("2. 几何与统计矢量图形直接绘制 (renderTriangleSvg / renderBarChartSvg / renderPieChartSvg / renderNumberLineSvg)", () => {
    it("绘制几何三角形并标注顶点字母", () => {
      const svg = renderTriangleSvg([
        { name: "A", x: 140, y: 30 },
        { name: "B", x: 40, y: 160 },
        { name: "C", x: 240, y: 160 },
      ], { title: "参考几何图" });

      expect(svg).toContain("<svg");
      expect(svg).toContain("<polygon points=");
      expect(svg).toContain(">A</text>");
      expect(svg).toContain(">B</text>");
      expect(svg).toContain(">C</text>");
      expect(svg).toContain("参考几何图");
    });

    it("直接调用 renderBarChartSvg 绘制柱状图", () => {
      const svg = renderBarChartSvg([
        { label: "A", value: 10 },
        { label: "B", value: 20 },
      ], { title: "直接柱图" });
      expect(svg).toContain("lv-math-bar");
      expect(svg).toContain("直接柱图");
      expect(svg).toContain("10");
    });

    it("直接调用 renderPieChartSvg 绘制扇形饼图", () => {
      const svg = renderPieChartSvg([
        { label: "及格", value: 80 },
        { label: "不及格", value: 20 },
      ], { title: "直接饼图" });
      expect(svg).toContain("lv-math-pie");
      expect(svg).toContain("及格: 80%");
    });

    it("直接调用 renderNumberLineSvg 绘制数轴", () => {
      const svg = renderNumberLineSvg({
        range: [-3, 3],
        interval: [-1, 2],
        intervalOpen: [true, false],
        title: "直接数轴",
      });
      expect(svg).toContain("lv-math-numberline");
      expect(svg).toContain("直接数轴");
    });
  });

  describe("3. 题干 Markdown 代码块自动内联渲染 (renderMathDiagramsInText)", () => {
    it("自动识别 ```math-plot 代码块并替换为矢量 SVG", () => {
      const md = `
如图所示，已知函数图像满足：
\`\`\`math-plot
y = x^2 - 2
x: [-3, 3]
title: 函数图像
\`\`\`
求其与 X 轴的交点坐标。
      `;

      const rendered = renderMathDiagramsInText(md);
      expect(rendered).not.toContain("```math-plot");
      expect(rendered).toContain("<svg");
      expect(rendered).toContain("lv-math-plot");
      expect(rendered).toContain("求其与 X 轴的交点坐标。");
    });

    it("自动识别 ```math-diagram 几何代码块并替换为矢量 SVG", () => {
      const md = `
在平面直角坐标系中，给定三角形：
\`\`\`math-diagram
triangle: A(140, 20), B(40, 160), C(240, 160)
\`\`\`
若角 A 为钝角，求面积。
      `;

      const rendered = renderMathDiagramsInText(md);
      expect(rendered).not.toContain("```math-diagram");
      expect(rendered).toContain("<svg");
      expect(rendered).toContain("lv-math-geometry");
    });

    it("自动识别 ```math-bar 统计柱状图代码块并替换为矢量 SVG", () => {
      const md = `
下表为近四年营业收入情况：
\`\`\`math-bar
title: 四年营收统计
"2021": 45
"2022": 68
"2023": 92
"2024": 120
\`\`\`
问复合增长率是多少？
      `;

      const rendered = renderMathDiagramsInText(md);
      expect(rendered).not.toContain("```math-bar");
      expect(rendered).toContain("<svg");
      expect(rendered).toContain("lv-math-bar");
      expect(rendered).toContain("四年营收统计");
      expect(rendered).toContain("2024");
    });

    it("自动识别 ```math-pie 扇形占比图代码块并替换为矢量 SVG", () => {
      const md = `
某次统考成绩分档占比统计如下：
\`\`\`math-pie
title: 成绩分布
"优秀": 30
"良好": 40
"及格": 20
"待提高": 10
\`\`\`
      `;

      const rendered = renderMathDiagramsInText(md);
      expect(rendered).not.toContain("```math-pie");
      expect(rendered).toContain("<svg");
      expect(rendered).toContain("lv-math-pie");
      expect(rendered).toContain("成绩分布");
      expect(rendered).toContain("优秀");
    });

    it("自动识别 ```math-numberline 数轴区间代码块并替换为矢量 SVG", () => {
      const md = `
已知不等式组的解集为：
\`\`\`math-numberline
title: 解集数轴示意
range: [-4, 6]
interval: [-1, 3)
\`\`\`
      `;

      const rendered = renderMathDiagramsInText(md);
      expect(rendered).not.toContain("```math-numberline");
      expect(rendered).toContain("<svg");
      expect(rendered).toContain("lv-math-numberline");
      expect(rendered).toContain("解集数轴示意");
    });
  });

  describe("4. 高阶 LaTeX 语法强化 (矩阵 pmatrix、分段 cases、向量与化学方程式)", () => {
    it("渲染圆括号矩阵 \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", () => {
      const latex = "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}";
      const html = renderSemanticLatex(latex);
      expect(html).toContain('class="lv-math-matrix lv-math-pmatrix"');
      expect(html).toContain('<td class="lv-math-cell">a</td>');
      expect(html).toContain('<td class="lv-math-cell">d</td>');
    });

    it("渲染分段函数 \\begin{cases} x + y = 1 \\\\ x - y = 0 \\end{cases}", () => {
      const latex = "\\begin{cases} x + y = 1 \\\\ x - y = 0 \\end{cases}";
      const html = renderSemanticLatex(latex);
      expect(html).toContain('class="lv-math-cases"');
      expect(html).toContain("x + y = 1");
      expect(html).toContain("x - y = 0");
    });

    it("渲染向量 \\vec{x}", () => {
      const latex = "\\vec{a} + \\vec{b}";
      const html = renderSemanticLatex(latex);
      expect(html).toContain('class="lv-math-vec"');
      expect(html).toContain("→");
    });

    it("渲染化学方程式 \\ce{2H2 + O2 -> 2H2O}", () => {
      const latex = "\\ce{2H2 + O2 -> 2H2O}";
      const html = renderSemanticLatex(latex);
      expect(html).toContain('class="lv-math-chem"');
      expect(html).toContain("2H<sub");
      expect(html).toContain("→");
    });

    it("渲染微积分极限 \\lim_{x \\to 0}", () => {
      const latex = "\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1";
      const html = renderSemanticLatex(latex);
      expect(html).toContain('class="lv-math-lim"');
      expect(html).toContain("lim");
      expect(html).toContain("lv-math-lim-sub");
    });
  });
});
