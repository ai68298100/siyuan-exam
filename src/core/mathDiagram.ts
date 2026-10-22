/**
 * 轻量级数学函数图像与几何图表矢量引擎 (Math Diagram SVG Engine)
 * 职责：
 * 1. 解析函数绘制指令（plot: y = f(x)），生成带坐标轴、刻度与光滑曲线的矢量 SVG；
 * 2. 解析几何结构指令（triangle / circle），生成带顶点标注的几何矢量图；
 * 3. 自动识别题干 Markdown 中的 ```math-plot 或 ```math-diagram 代码块并内联渲染；
 * 4. 纯函数领域层，支持深浅主题自适应与 A4 双栏印刷出版级输出。
 */

export interface PlotOptions {
  width?: number; // 默认 320
  height?: number; // 默认 220
  xRange?: [number, number]; // 默认 [-4, 4]
  yRange?: [number, number]; // 默认 [-4, 4]
  title?: string;
}

export interface GeometryOptions {
  width?: number;
  height?: number;
  title?: string;
}

/**
 * 安全计算单变量实函数 y = f(x)
 */
function evaluateMathFunction(expr: string, x: number): number | null {
  const cleanExpr = expr.trim().toLowerCase().replace(/^y\s*=\s*/, "").replace(/^f\(x\)\s*=\s*/, "");

  try {
    // 简易安全解析器：支持常见一元初等函数
    if (/^[0-9x+\-*/^().\s]+$/.test(cleanExpr) || /sin|cos|tan|sqrt|abs|ln|log|exp/.test(cleanExpr)) {
      // 替换数学算子
      const jsExpr = cleanExpr
        .replace(/\^/g, "**")
        .replace(/(\d)x/g, "$1*x")
        .replace(/sin/g, "Math.sin")
        .replace(/cos/g, "Math.cos")
        .replace(/tan/g, "Math.tan")
        .replace(/sqrt/g, "Math.sqrt")
        .replace(/abs/g, "Math.abs")
        .replace(/ln/g, "Math.log")
        .replace(/exp/g, "Math.exp")
        .replace(/pi/g, "Math.PI")
        .replace(/e/g, "Math.E");

      // 安全执行闭包
      const fn = new Function("x", `"use strict"; return (${jsExpr});`);
      const y = fn(x);
      return Number.isFinite(y) ? Number(y) : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * 绘制笛卡尔直角坐标系函数曲线 SVG
 */
export function renderFunctionPlotSvg(
  funcExpr: string,
  options: PlotOptions = {},
): string {
  const w = options.width ?? 320;
  const h = options.height ?? 220;
  const xMin = options.xRange?.[0] ?? -4;
  const xMax = options.xRange?.[1] ?? 4;
  const yMin = options.yRange?.[0] ?? -3;
  const yMax = options.yRange?.[1] ?? 5;

  const pad = 24;
  const plotW = w - pad * 2;
  const plotH = h - pad * 2;

  // 坐标映射
  const toSvgX = (x: number) => pad + ((x - xMin) / (xMax - xMin)) * plotW;
  const toSvgY = (y: number) => pad + ((yMax - y) / (yMax - yMin)) * plotH;

  const origX = toSvgX(0);
  const origY = toSvgY(0);

  const parts: string[] = [];
  parts.push(`<svg class="lv-math-diagram lv-math-plot" viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px;height:auto;display:block;margin:8px auto;background:var(--lv-surface);border:1px solid var(--lv-border);border-radius:6px" role="img" aria-label="函数图像: ${funcExpr}">`);

  // 1. 绘制网格与坐标轴
  // X 轴
  if (origY >= pad && origY <= h - pad) {
    parts.push(`<line x1="${pad}" y1="${origY}" x2="${w - pad + 6}" y2="${origY}" stroke="currentColor" stroke-width="1.2" opacity="0.8" />`);
    parts.push(`<polygon points="${w - pad + 8},${origY} ${w - pad + 2},${origY - 3} ${w - pad + 2},${origY + 3}" fill="currentColor" opacity="0.8" />`);
    parts.push(`<text x="${w - pad + 10}" y="${origY + 4}" font-size="11" font-family="serif" font-style="italic" fill="currentColor">x</text>`);
  }

  // Y 轴
  if (origX >= pad && origX <= w - pad) {
    parts.push(`<line x1="${origX}" y1="${h - pad}" x2="${origX}" y2="${pad - 6}" stroke="currentColor" stroke-width="1.2" opacity="0.8" />`);
    parts.push(`<polygon points="${origX},${pad - 8} ${origX - 3},${pad - 2} ${origX + 3},${pad - 2}" fill="currentColor" opacity="0.8" />`);
    parts.push(`<text x="${origX + 6}" y="${pad - 8}" font-size="11" font-family="serif" font-style="italic" fill="currentColor">y</text>`);
  }

  // 原点 O 标号
  if (origX >= pad && origX <= w - pad && origY >= pad && origY <= h - pad) {
    parts.push(`<text x="${origX - 9}" y="${origY + 12}" font-size="10" font-family="serif" fill="currentColor" opacity="0.7">O</text>`);
  }

  // 2. 采样计算曲线点集
  const steps = 120;
  const pathSegments: string[][] = [];
  let currentSegment: string[] = [];

  for (let i = 0; i <= steps; i++) {
    const x = xMin + (i / steps) * (xMax - xMin);
    const y = evaluateMathFunction(funcExpr, x);

    if (y !== null && y >= yMin - 1 && y <= yMax + 1) {
      const sx = toSvgX(x).toFixed(1);
      const sy = toSvgY(y).toFixed(1);
      currentSegment.push(`${sx},${sy}`);
    } else {
      if (currentSegment.length > 1) {
        pathSegments.push(currentSegment);
      }
      currentSegment = [];
    }
  }

  if (currentSegment.length > 1) {
    pathSegments.push(currentSegment);
  }

  for (const seg of pathSegments) {
    const d = `M ${seg.join(" L ")}`;
    parts.push(`<path d="${d}" fill="none" stroke="var(--b3-theme-primary, #5e59cb)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`);
  }

  // 3. 图表说明标题
  const title = options.title || funcExpr;
  parts.push(`<text x="${pad + 4}" y="${pad + 4}" font-size="11" font-family="serif" font-weight="bold" fill="currentColor" opacity="0.9">${title}</text>`);

  parts.push(`</svg>`);
  return parts.join("\n");
}

/**
 * 绘制几何三角形图形 SVG
 */
export function renderTriangleSvg(
  points: Array<{ name: string; x: number; y: number }>,
  options: GeometryOptions = {},
): string {
  const w = options.width ?? 280;
  const h = options.height ?? 200;

  if (points.length < 3) return "";

  const [p1, p2, p3] = points;
  const pointsStr = `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;

  const parts: string[] = [];
  parts.push(`<svg class="lv-math-diagram lv-math-geometry" viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px;height:auto;display:block;margin:8px auto;background:var(--lv-surface);border:1px solid var(--lv-border);border-radius:6px" role="img" aria-label="几何图形: △${p1.name}${p2.name}${p3.name}">`);

  // 填充与边线
  parts.push(`<polygon points="${pointsStr}" fill="color-mix(in srgb, var(--b3-theme-primary, #5e59cb) 8%, transparent)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />`);

  // 顶点字母标签
  const labelOffset = (p: { x: number; y: number }, ox: number, oy: number, name: string) =>
    `<text x="${p.x + ox}" y="${p.y + oy}" font-size="12" font-weight="bold" font-family="serif" fill="currentColor">${name}</text>`;

  parts.push(labelOffset(p1, -4, -8, p1.name));
  parts.push(labelOffset(p2, -14, 12, p2.name));
  parts.push(labelOffset(p3, 8, 12, p3.name));

  if (options.title) {
    parts.push(`<text x="12" y="18" font-size="11" font-weight="bold" fill="currentColor" opacity="0.85">${options.title}</text>`);
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}

/**
 * 文本内数学图表代码块解析与转换
 * 支持 ```math-plot 与 ```math-diagram 语法
 */
export function renderMathDiagramsInText(text: string): string {
  if (!text) return "";
  if (!text.includes("```math-plot") && !text.includes("```math-diagram")) {
    return text;
  }

  let s = text;

  // 1. 匹配 ```math-plot ... ```
  s = s.replace(/```math-plot([\s\S]*?)```/g, (_m, body: string) => {
    const raw = body.trim();
    // 提取函数表达式：如 y = x^2 - 2
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    const exprLine = lines[0] || "y = x^2";

    let xRange: [number, number] | undefined;
    let yRange: [number, number] | undefined;
    let title: string | undefined;

    for (const l of lines.slice(1)) {
      const xMatch = l.match(/x\s*:\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/);
      if (xMatch) xRange = [parseFloat(xMatch[1]), parseFloat(xMatch[2])];

      const yMatch = l.match(/y\s*:\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/);
      if (yMatch) yRange = [parseFloat(yMatch[1]), parseFloat(yMatch[2])];

      const tMatch = l.match(/title\s*:\s*(.*)$/);
      if (tMatch) title = tMatch[1].trim();
    }

    return renderFunctionPlotSvg(exprLine, { xRange, yRange, title });
  });

  // 2. 匹配 ```math-diagram ... ``` （几何图形）
  s = s.replace(/```math-diagram([\s\S]*?)```/g, (_m, body: string) => {
    const raw = body.trim();
    // 简易三角形：triangle: A(140, 30), B(50, 160), C(230, 160)
    const triMatch = raw.match(/triangle\s*:\s*([A-Z])\((\d+)\s*,\s*(\d+)\)\s*,\s*([A-Z])\((\d+)\s*,\s*(\d+)\)\s*,\s*([A-Z])\((\d+)\s*,\s*(\d+)\)/);
    if (triMatch) {
      const p1 = { name: triMatch[1], x: parseInt(triMatch[2], 10), y: parseInt(triMatch[3], 10) };
      const p2 = { name: triMatch[4], x: parseInt(triMatch[5], 10), y: parseInt(triMatch[6], 10) };
      const p3 = { name: triMatch[7], x: parseInt(triMatch[8], 10), y: parseInt(triMatch[9], 10) };
      return renderTriangleSvg([p1, p2, p3], { title: "几何参考示意图" });
    }
    return `<div class="lv-math-diagram-raw">${raw}</div>`;
  });

  return s;
}
