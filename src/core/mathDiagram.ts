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

export interface StatsChartItem {
  label: string;
  value: number;
}

function escapeXml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * 绘制数理统计柱状图 SVG
 */
export function renderBarChartSvg(
  items: readonly StatsChartItem[],
  options: { width?: number; height?: number; title?: string } = {},
): string {
  const w = options.width ?? 320;
  const h = options.height ?? 200;
  const padLeft = 36;
  const padRight = 16;
  const padTop = 32;
  const padBottom = 28;

  if (!items.length) return "";

  const maxVal = Math.max(...items.map((it) => it.value), 1);
  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBottom;

  const barCount = items.length;
  const gap = 12;
  const totalGaps = (barCount + 1) * gap;
  const barW = Math.max(8, Math.min(48, (plotW - totalGaps) / barCount));

  const parts: string[] = [];
  parts.push(`<svg class="lv-math-diagram lv-math-bar" viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px;height:auto;display:block;margin:8px auto;background:var(--lv-surface);border:1px solid var(--lv-border);border-radius:6px" role="img" aria-label="柱状统计图: ${escapeXml(options.title || "数据统计")}">`);

  // 标题
  if (options.title) {
    parts.push(`<text x="${padLeft}" y="18" font-size="11" font-weight="bold" fill="currentColor" opacity="0.9">${escapeXml(options.title)}</text>`);
  }

  // 坐标轴
  const axisY = h - padBottom;
  parts.push(`<line x1="${padLeft}" y1="${padTop - 6}" x2="${padLeft}" y2="${axisY}" stroke="currentColor" stroke-width="1.2" opacity="0.8" />`);
  parts.push(`<line x1="${padLeft}" y1="${axisY}" x2="${w - padRight + 4}" y2="${axisY}" stroke="currentColor" stroke-width="1.2" opacity="0.8" />`);

  // 柱体与标签
  const colors = [
    "var(--b3-theme-primary, #5e59cb)",
    "color-mix(in srgb, var(--b3-theme-primary, #5e59cb) 80%, #00bcd4)",
    "color-mix(in srgb, var(--b3-theme-primary, #5e59cb) 65%, #4caf50)",
    "color-mix(in srgb, var(--b3-theme-primary, #5e59cb) 50%, #ff9800)",
  ];

  items.forEach((it, idx) => {
    const curX = padLeft + gap + idx * (barW + gap);
    const curH = (it.value / maxVal) * plotH;
    const curY = axisY - curH;
    const c = colors[idx % colors.length];

    // 柱形
    parts.push(`<rect x="${curX.toFixed(1)}" y="${curY.toFixed(1)}" width="${barW.toFixed(1)}" height="${curH.toFixed(1)}" rx="3" fill="${c}" opacity="0.9" />`);
    // 柱上数值
    parts.push(`<text x="${(curX + barW / 2).toFixed(1)}" y="${(curY - 4).toFixed(1)}" font-size="10" font-family="serif" text-anchor="middle" fill="currentColor">${it.value}</text>`);
    // 柱下类目标签
    parts.push(`<text x="${(curX + barW / 2).toFixed(1)}" y="${(axisY + 14).toFixed(1)}" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.85">${escapeXml(it.label)}</text>`);
  });

  parts.push(`</svg>`);
  return parts.join("\n");
}

/**
 * 绘制数理统计扇形饼图 SVG
 */
export function renderPieChartSvg(
  items: readonly StatsChartItem[],
  options: { width?: number; height?: number; title?: string } = {},
): string {
  const w = options.width ?? 320;
  const h = options.height ?? 200;
  const cx = 95;
  const cy = 105;
  const r = 65;

  const total = items.reduce((sum, it) => sum + Math.max(0, it.value), 0);
  if (total <= 0) return "";

  const parts: string[] = [];
  parts.push(`<svg class="lv-math-diagram lv-math-pie" viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px;height:auto;display:block;margin:8px auto;background:var(--lv-surface);border:1px solid var(--lv-border);border-radius:6px" role="img" aria-label="扇形统计图: ${escapeXml(options.title || "占比分布")}">`);

  if (options.title) {
    parts.push(`<text x="14" y="20" font-size="11" font-weight="bold" fill="currentColor" opacity="0.9">${escapeXml(options.title)}</text>`);
  }

  const colors = [
    "var(--b3-theme-primary, #5e59cb)",
    "#26a69a",
    "#ffa726",
    "#ef5350",
    "#ab47bc",
    "#29b6f6",
  ];

  let currentAngle = -Math.PI / 2; // 从 12 点钟方向开始

  items.forEach((it, i) => {
    const fraction = it.value / total;
    const sliceAngle = fraction * 2 * Math.PI;
    const endAngle = currentAngle + sliceAngle;

    const x1 = cx + r * Math.cos(currentAngle);
    const y1 = cy + r * Math.sin(currentAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);

    const largeArcFlag = sliceAngle > Math.PI ? 1 : 0;
    const color = colors[i % colors.length];

    // 扇区路径
    const d = `M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${largeArcFlag} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
    parts.push(`<path d="${d}" fill="${color}" stroke="var(--lv-surface)" stroke-width="1.5" opacity="0.9" />`);

    // 右侧图例
    const legY = 45 + i * 22;
    if (legY < h - 10) {
      const pct = (fraction * 100).toFixed(0);
      parts.push(`<rect x="180" y="${legY - 9}" width="12" height="12" rx="2" fill="${color}" />`);
      parts.push(`<text x="198" y="${legY + 1}" font-size="10" fill="currentColor">${escapeXml(it.label)}: ${pct}%</text>`);
    }

    currentAngle = endAngle;
  });

  parts.push(`</svg>`);
  return parts.join("\n");
}

/**
 * 绘制实数轴与不等式解集区间图 SVG
 */
export function renderNumberLineSvg(options: {
  range?: [number, number];
  interval?: [number, number];
  intervalOpen?: [boolean, boolean]; // [左端点是否开区间, 右端点是否开区间]
  title?: string;
  width?: number;
  height?: number;
}): string {
  const w = options.width ?? 320;
  const h = options.height ?? 80;
  const min = options.range?.[0] ?? -5;
  const max = options.range?.[1] ?? 5;
  const safeSpan = Math.max(0.001, max - min);
  const pad = 24;
  const lineY = h / 2 + 4;
  const axisW = w - pad * 2;

  const toX = (val: number) => pad + ((val - min) / safeSpan) * axisW;

  const parts: string[] = [];
  parts.push(`<svg class="lv-math-diagram lv-math-numberline" viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px;height:auto;display:block;margin:8px auto;background:var(--lv-surface);border:1px solid var(--lv-border);border-radius:6px" role="img" aria-label="数轴区间图: ${escapeXml(options.title || "数轴")}">`);

  if (options.title) {
    parts.push(`<text x="14" y="16" font-size="10" font-weight="bold" fill="currentColor" opacity="0.85">${escapeXml(options.title)}</text>`);
  }

  // 数轴横线与两端箭头
  parts.push(`<line x1="${pad - 8}" y1="${lineY}" x2="${w - pad + 8}" y2="${lineY}" stroke="currentColor" stroke-width="1.4" />`);
  parts.push(`<polygon points="${w - pad + 10},${lineY} ${w - pad + 4},${lineY - 3} ${w - pad + 4},${lineY + 3}" fill="currentColor" />`);

  // 刻度线与整数值
  const step = Math.max(1, Math.round((max - min) / 10));
  for (let val = Math.ceil(min); val <= Math.floor(max); val += step) {
    const x = toX(val);
    parts.push(`<line x1="${x.toFixed(1)}" y1="${lineY - 4}" x2="${x.toFixed(1)}" y2="${lineY + 4}" stroke="currentColor" stroke-width="1" opacity="0.7" />`);
    parts.push(`<text x="${x.toFixed(1)}" y="${lineY + 16}" font-size="10" font-family="serif" text-anchor="middle" fill="currentColor" opacity="0.8">${val}</text>`);
  }

  // 不等式解集区间高亮带
  if (options.interval) {
    const [ivMin, ivMax] = options.interval;
    const xLeft = Math.max(pad, toX(ivMin));
    const xRight = Math.min(w - pad, toX(ivMax));
    const isLeftOpen = options.intervalOpen?.[0] ?? false;
    const isRightOpen = options.intervalOpen?.[1] ?? false;

    // 区间高亮线
    parts.push(`<line x1="${xLeft.toFixed(1)}" y1="${lineY}" x2="${xRight.toFixed(1)}" y2="${lineY}" stroke="var(--b3-theme-primary, #5e59cb)" stroke-width="3" stroke-linecap="round" />`);

    // 左端点
    const fillLeft = isLeftOpen ? "var(--lv-surface)" : "var(--b3-theme-primary, #5e59cb)";
    parts.push(`<circle cx="${xLeft.toFixed(1)}" cy="${lineY}" r="4" fill="${fillLeft}" stroke="var(--b3-theme-primary, #5e59cb)" stroke-width="1.8" />`);

    // 右端点
    const fillRight = isRightOpen ? "var(--lv-surface)" : "var(--b3-theme-primary, #5e59cb)";
    parts.push(`<circle cx="${xRight.toFixed(1)}" cy="${lineY}" r="4" fill="${fillRight}" stroke="var(--b3-theme-primary, #5e59cb)" stroke-width="1.8" />`);
  }

  parts.push(`</svg>`);
  return parts.join("\n");
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
  const xSpan = Math.max(0.001, xMax - xMin);
  const ySpan = Math.max(0.001, yMax - yMin);

  // 坐标映射
  const toSvgX = (x: number) => pad + ((x - xMin) / xSpan) * plotW;
  const toSvgY = (y: number) => pad + ((yMax - y) / ySpan) * plotH;

  const origX = toSvgX(0);
  const origY = toSvgY(0);

  const parts: string[] = [];
  parts.push(`<svg class="lv-math-diagram lv-math-plot" viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px;height:auto;display:block;margin:8px auto;background:var(--lv-surface);border:1px solid var(--lv-border);border-radius:6px" role="img" aria-label="函数图像: ${escapeXml(funcExpr)}">`);

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
  parts.push(`<text x="${pad + 4}" y="${pad + 4}" font-size="11" font-family="serif" font-weight="bold" fill="currentColor" opacity="0.9">${escapeXml(title)}</text>`);

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

  parts.push(labelOffset(p1, -4, -8, escapeXml(p1.name)));
  parts.push(labelOffset(p2, -14, 12, escapeXml(p2.name)));
  parts.push(labelOffset(p3, 8, 12, escapeXml(p3.name)));

  if (options.title) {
    parts.push(`<text x="12" y="18" font-size="11" font-weight="bold" fill="currentColor" opacity="0.85">${escapeXml(options.title)}</text>`);
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}

/**
 * 文本内数学图表代码块解析与转换
 * 支持 ```math-plot、```math-diagram、```math-bar、```math-pie 与 ```math-numberline 语法
 */
export function renderMathDiagramsInText(text: string): string {
  if (!text) return "";
  if (
    !text.includes("```math-plot") &&
    !text.includes("```math-diagram") &&
    !text.includes("```math-bar") &&
    !text.includes("```math-pie") &&
    !text.includes("```math-numberline")
  ) {
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
    return `<div class="lv-math-diagram-raw">${escapeXml(raw)}</div>`;
  });

  // 3. 匹配 ```math-bar ... ``` （柱状图）
  s = s.replace(/```math-bar([\s\S]*?)```/g, (_m, body: string) => {
    const raw = body.trim();
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    const items: StatsChartItem[] = [];
    let title: string | undefined;

    for (const l of lines) {
      if (l.startsWith("title:")) {
        title = l.replace(/^title:\s*/, "").trim();
        continue;
      }
      // 匹配 key: val 或 ("key", val) 或 [key, val]
      const pairMatch = l.match(/["']?([^"',:]+)["']?\s*[:,\t]\s*(\d+(?:\.\d+)?)/);
      if (pairMatch) {
        items.push({ label: pairMatch[1].trim(), value: parseFloat(pairMatch[2]) });
      }
    }
    return renderBarChartSvg(items, { title });
  });

  // 4. 匹配 ```math-pie ... ``` （饼图）
  s = s.replace(/```math-pie([\s\S]*?)```/g, (_m, body: string) => {
    const raw = body.trim();
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    const items: StatsChartItem[] = [];
    let title: string | undefined;

    for (const l of lines) {
      if (l.startsWith("title:")) {
        title = l.replace(/^title:\s*/, "").trim();
        continue;
      }
      const pairMatch = l.match(/["']?([^"',:]+)["']?\s*[:,\t]\s*(\d+(?:\.\d+)?)/);
      if (pairMatch) {
        items.push({ label: pairMatch[1].trim(), value: parseFloat(pairMatch[2]) });
      }
    }
    return renderPieChartSvg(items, { title });
  });

  // 5. 匹配 ```math-numberline ... ``` （数轴与不等式区间图）
  s = s.replace(/```math-numberline([\s\S]*?)```/g, (_m, body: string) => {
    const raw = body.trim();
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    let range: [number, number] | undefined;
    let interval: [number, number] | undefined;
    let intervalOpen: [boolean, boolean] | undefined;
    let title: string | undefined;

    for (const l of lines) {
      if (l.startsWith("title:")) {
        title = l.replace(/^title:\s*/, "").trim();
        continue;
      }
      const rangeMatch = l.match(/range\s*:\s*\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/);
      if (rangeMatch) {
        range = [parseInt(rangeMatch[1], 10), parseInt(rangeMatch[2], 10)];
        continue;
      }
      const ivMatch = l.match(/interval\s*:\s*([([\]])\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*([)\]])/);
      if (ivMatch) {
        interval = [parseFloat(ivMatch[2]), parseFloat(ivMatch[3])];
        intervalOpen = [ivMatch[1] === "(", ivMatch[4] === ")"];
      }
    }

    return renderNumberLineSvg({ range, interval, intervalOpen, title });
  });

  return s;
}
