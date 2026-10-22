/**
 * 数学公式（LaTeX / KaTeX）处理引擎
 * 职责：
 * 1. LaTeX 公式语法清洗与格式归一化（normalizeLatexFormula）；
 * 2. 多环境双模渲染（优先探测宿主 window.katex，无环境时优雅降级为语义 HTML / MathML）；
 * 3. A4 双栏排版打印专用的出版级公式排版 CSS。
 */

const ESC_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ESC_MAP[ch]);
}

/** 常用希腊字母与常用数学符号映射表（供纯语义 HTML 降级渲染） */
const LATEX_SYMBOLS_MAP: Record<string, string> = {
  // 希腊字母
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",

  // 关系与运算符号
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  equiv: "≡",
  pm: "±",
  mp: "∓",
  times: "×",
  div: "÷",
  cdot: "·",
  ast: "*",
  circ: "∘",
  infty: "∞",
  partial: "∂",
  nabla: "∇",

  // 逻辑与集合
  forall: "∀",
  exists: "∃",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cap: "∩",
  cup: "∪",
  emptyset: "∅",

  // 箭头与大型算子
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  sum: "∑",
  prod: "∏",
  int: "∫",
  oint: "∮",
};

/**
 * 规范化 LaTeX 公式语法（支持消除 OCR 常见空格分裂、括号转换）
 */
export function normalizeLatexFormula(raw: string): string {
  if (!raw) return "";

  let s = raw;

  // 1. 将 LaTeX 括号 \( ... \) 转换为 $ ... $（自动 trim 括号内两端空格）
  s = s.replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, "$$$1$$");

  // 2. 将 LaTeX 块级括号 \[ ... \] 转换为 $$ ... $$
  s = s.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, "$$$$$1$$$$");

  // 3. 修复 OCR 扫描识别中常见的空格断裂（如 \ frac { a } { b }）
  s = s.replace(/\\\s*frac\s*\{\s*([^{}]+?)\s*\}\s*\{\s*([^{}]+?)\s*\}/gi, "\\frac{$1}{$2}");
  s = s.replace(/\\\s*sqrt\s*\{\s*([^{}]+?)\s*\}/gi, "\\sqrt{$1}");
  s = s.replace(/\\\s*sqrt\s*\[\s*([^[]]+?)\s*\]\s*\{\s*([^{}]+?)\s*\}/gi, "\\sqrt[$1]{$2}");

  // 4. 修复常见符号的 OCR 错符
  s = s.replace(/\\\s*le\b/g, "\\le");
  s = s.replace(/\\\s*ge\b/g, "\\ge");
  s = s.replace(/\\\s*pm\b/g, "\\pm");
  s = s.replace(/\\\s*times\b/g, "\\times");

  return s;
}

/**
 * 降级纯语义 HTML 公式渲染（无外部 JS 依赖，纯 CSS + Unicode）
 */
export function renderSemanticLatex(latex: string, displayMode = false): string {
  const trimmed = latex.trim();
  if (!trimmed) return "";

  let s = escapeHtml(trimmed);

  // 1. 解析分式 \frac{A}{B}
  s = s.replace(
    /\\frac\{([^{}]+)\}\{([^{}]+)\}/g,
    '<span class="lv-math-frac"><span class="lv-math-num">$1</span><span class="lv-math-denom">$2</span></span>',
  );

  // 2. 解析根号 \sqrt{X} 与 \sqrt[n]{X}
  s = s.replace(
    /\\sqrt\[([^[\]]+)\]\{([^{}]+)\}/g,
    '<span class="lv-math-sqrt"><sup class="lv-math-root">$1</sup><span class="lv-math-radical">√</span><span class="lv-math-radicand">$2</span></span>',
  );
  s = s.replace(
    /\\sqrt\{([^{}]+)\}/g,
    '<span class="lv-math-sqrt"><span class="lv-math-radical">√</span><span class="lv-math-radicand">$1</span></span>',
  );

  // 3. 替换常见 LaTeX 符号与希腊字母
  s = s.replace(/\\([a-zA-Z]+)/g, (match, sym: string) => {
    return LATEX_SYMBOLS_MAP[sym] ?? match;
  });

  // 4. 解析上标与下标：^{...} 或 ^x，_{...} 或 _x
  s = s.replace(/\^{([^{}]+)}/g, '<sup class="lv-math-sup">$1</sup>');
  s = s.replace(/\^([0-9a-zA-Z+-]+)/g, '<sup class="lv-math-sup">$1</sup>');
  s = s.replace(/_{([^{}]+)}/g, '<sub class="lv-math-sub">$1</sub>');
  s = s.replace(/_([0-9a-zA-Z+-]+)/g, '<sub class="lv-math-sub">$1</sub>');

  // 5. 移除多余的花括号与斜杠残留
  s = s.replace(/[{}]/g, "");

  const modeClass = displayMode ? "lv-math-block" : "lv-math-inline";
  return `<span class="lv-math-expr ${modeClass}" data-latex="${escapeHtml(trimmed)}">${s}</span>`;
}

/**
 * 单个 LaTeX 公式渲染（优先探测宿主全局 KaTeX，无环境时降级为语义 HTML）
 */
export function renderLatex(latex: string, displayMode = false): string {
  const cleaned = latex.trim();
  if (!cleaned) return "";

  // 优先探测宿主全局 window.katex
  if (typeof window !== "undefined") {
    const globalKatex = (window as unknown as { katex?: { renderToString?: (tex: string, opts?: unknown) => string } }).katex;
    if (globalKatex && typeof globalKatex.renderToString === "function") {
      try {
        return globalKatex.renderToString(cleaned, {
          displayMode,
          throwOnError: false,
        });
      } catch {
        // 捕获异常并降级
      }
    }
  }

  return renderSemanticLatex(cleaned, displayMode);
}

/**
 * 文本内数学公式全量解析与渲染（自动识别 $$...$$ 与 $...$ 并安全替换）
 */
export function renderMathInText(text: string): string {
  if (!text) return "";

  // 若不含 $ 或 \( 或 \[，直接纯文本转义返回
  if (!text.includes("$") && !text.includes("\\(") && !text.includes("\\[")) {
    return escapeHtml(text);
  }

  // 先统一归一化语法
  const normalized = normalizeLatexFormula(text);

  // 分块解析：优先提取块级公式 $$...$$，再提取行内公式 $...$
  const chunks: Array<{ type: "text" | "blockMath" | "inlineMath"; content: string }> = [];

  // 正则：非贪婪匹配 $$...$$ 与 $...$
  // 注意：需要避免匹配空 $ 或转义的 \$
  const MATH_PATTERN = /(\$\$[\s\S]*?\$\$|\$(?!\$)[\s\S]*?\$)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = MATH_PATTERN.exec(normalized)) !== null) {
    const matchStart = match.index;
    const matchStr = match[0];

    if (matchStart > lastIndex) {
      chunks.push({
        type: "text",
        content: normalized.slice(lastIndex, matchStart),
      });
    }

    if (matchStr.startsWith("$$") && matchStr.endsWith("$$") && matchStr.length >= 4) {
      chunks.push({
        type: "blockMath",
        content: matchStr.slice(2, -2),
      });
    } else if (matchStr.startsWith("$") && matchStr.endsWith("$") && matchStr.length >= 2) {
      chunks.push({
        type: "inlineMath",
        content: matchStr.slice(1, -1),
      });
    } else {
      chunks.push({
        type: "text",
        content: matchStr,
      });
    }

    lastIndex = matchStart + matchStr.length;
  }

  if (lastIndex < normalized.length) {
    chunks.push({
      type: "text",
      content: normalized.slice(lastIndex),
    });
  }

  return chunks
    .map((chunk) => {
      if (chunk.type === "blockMath") {
        return `<div class="lv-math-block-wrap">${renderLatex(chunk.content, true)}</div>`;
      }
      if (chunk.type === "inlineMath") {
        return renderLatex(chunk.content, false);
      }
      return escapeHtml(chunk.content);
    })
    .join("");
}

/**
 * 针对 A4 双栏试卷打印与导出的标准数学公式 CSS 样式
 */
export function getMathPrintStyles(): string {
  return `
/* === 出版级数学公式排版样式（双栏防折行与高精微调） === */
.lv-math-expr {
  font-family: KaTeX_Main, "Times New Roman", "Cambria Math", serif;
  font-style: normal;
  display: inline-block;
  white-space: nowrap;
  vertical-align: middle;
  line-height: 1.2;
}
.lv-math-inline {
  margin: 0 2px;
}
.lv-math-block-wrap {
  text-align: center;
  margin: 6px 0;
  overflow-x: auto;
  white-space: nowrap;
}
.lv-math-block {
  display: inline-block;
}
.lv-math-frac {
  display: inline-flex;
  flex-direction: column;
  vertical-align: middle;
  text-align: center;
  font-size: 0.9em;
  padding: 0 1px;
}
.lv-math-num {
  border-bottom: 1px solid currentColor;
  padding: 0 2px 1px;
  line-height: 1.1;
}
.lv-math-denom {
  padding: 1px 2px 0;
  line-height: 1.1;
}
.lv-math-sqrt {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
}
.lv-math-root {
  font-size: 0.65em;
  vertical-align: super;
  margin-right: -2px;
}
.lv-math-radical {
  font-size: 1.1em;
  line-height: 1;
}
.lv-math-radicand {
  border-top: 1px solid currentColor;
  padding: 0 2px;
  margin-left: -1px;
}
.lv-math-sup {
  font-size: 0.75em;
  vertical-align: super;
  line-height: 0;
}
.lv-math-sub {
  font-size: 0.75em;
  vertical-align: sub;
  line-height: 0;
}
`;
}
