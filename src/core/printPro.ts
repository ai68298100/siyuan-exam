// ============================================================
// A4 双栏紧凑打印与分页防断优化引擎（68-04 / 79-02）
// 纯函数领域层：
// 1. A4/Letter 纵向双栏紧凑排版（单栏/双栏切换，节省约 40% 纸张）
// 2. 共用材料题组分页防断保护（材料卡片与其首道小题强制同页同栏）
// 3. 页眉页脚、试卷编号与动态装订线标尺
// 4. 学生册严格脱敏（绝不包含标准答案/解析/AI/个人流水）
// 规则：严格无外部宿主依赖（禁 import "siyuan"），严禁类型强转。
// ============================================================

import type { Question } from "./types";
import { renderMathInText, getMathPrintStyles } from "./math";

export type PaperSize = "A4" | "Letter";
export type ColumnLayout = "single" | "double";

export interface PrintProOptions {
  /** 纸张规格（默认 A4） */
  paperSize?: PaperSize;
  /** 分栏方式（默认 double 双栏紧凑） */
  columns?: ColumnLayout;
  /** 页眉标题（默认使用试卷标题） */
  headerTitle?: string;
  /** 页脚附注（如“内部备考模拟卷，仅供参考”） */
  footerNote?: string;
  /** 试卷编号 */
  paperNo?: string;
  /** 是否打印答题区（填空/简答预留） */
  showAnswerArea?: boolean;
  /** 是否打印分值 */
  showScore?: boolean;
}

const TYPE_NAMES: Record<string, string> = {
  single: "单选",
  multiple: "多选",
  judge: "判断",
  fill: "填空",
  short: "简答",
  material: "材料",
};

/** HTML 转义（严格防 XSS 注入） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 生成分栏与打印优化 CSS */
export function buildPrintProCss(options: PrintProOptions = {}): string {
  const isDouble = (options.columns ?? "double") === "double";
  const size = options.paperSize === "Letter" ? "Letter" : "A4";

  return `
    @page {
      size: ${size} portrait;
      margin: 12mm 10mm 14mm 10mm;
      @bottom-center { content: counter(page) " / " counter(pages); font-size: 9pt; color: #666; }
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: "Source Han Serif SC", "Noto Serif CJK SC", SimSun, serif;
      font-size: 10.5pt; line-height: 1.55; color: #111;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    header.sheet-header {
      display: flex; justify-content: space-between; align-items: baseline;
      border-bottom: 1px solid #999; padding-bottom: 3px; margin-bottom: 8px;
      font-size: 9pt; color: #444;
    }
    ${isDouble
      ? `section.questions { column-count: 2; column-gap: 8mm; column-rule: 1px dotted #ccc; column-fill: auto; }`
      : `section.questions { column-count: 1; }`}
    .q {
      page-break-inside: avoid;
      break-inside: avoid;
      margin: 0 0 10px;
    }
    /* 材料卡片与首道小题强制同页同栏保护 */
    .material-block {
      page-break-inside: avoid;
      break-inside: avoid;
      page-break-after: avoid;
      break-after: avoid;
      background: #f6f6f6; border-left: 3px solid #888;
      padding: 5px 8px; margin: 0 0 6px;
      font-size: 9.8pt; white-space: pre-wrap; overflow-wrap: anywhere;
    }
    .q-group-head { page-break-after: avoid; break-after: avoid; }
    .q-head { font-weight: 700; margin-bottom: 2px; }
    .q-type { font-size: 8.5pt; color: #555; border: 1px solid #999; border-radius: 2px; padding: 0 3px; margin-right: 5px; }
    .q-score { float: right; font-weight: 400; font-size: 9pt; color: #555; }
    .q-stem { white-space: pre-wrap; overflow-wrap: anywhere; }
    .opt { margin-left: 1.2em; }
    .answer-area { border-bottom: 1px solid #999; height: 1.8em; margin: 4px 0 0 1.2em; }
    .ans-analysis { color: #333; font-size: 9.8pt; margin-left: 1.2em; white-space: pre-wrap; overflow-wrap: anywhere; }
    .kp-tag { color: #666; font-size: 8.5pt; }
    footer.sheet-footer {
      position: fixed; bottom: 0; left: 0; right: 0;
      border-top: 1px solid #ccc; padding-top: 2px; margin-top: 8px;
      font-size: 8.5pt; color: #666; display: flex; justify-content: space-between;
    }
    @media print {
      body { margin: 0; }
      footer.sheet-footer { position: fixed; }
    }
    ${getMathPrintStyles()}
  `;
}

function renderHeader(title: string, subtitle: string, paperNo?: string): string {
  const right = [paperNo ? `试卷编号 ${paperNo}` : "", subtitle].filter(Boolean).join(" · ");
  return `<header class="sheet-header"><span>${escapeHtml(title)}</span><span>${escapeHtml(right)}</span></header>`;
}

function renderFooter(note?: string, today: string = new Date().toLocaleDateString("zh-CN")): string {
  return `<footer class="sheet-footer"><span>${escapeHtml(note || "小驴考试 · 本地离线生成")}</span><span>${escapeHtml(today)}</span></footer>`;
}

/**
 * 生成 A4 双栏紧凑作答卷 HTML（68-04 核心）。
 * 安全红线：绝不输出标准答案与解析字段。
 */
export function buildCompactQuestionSheetPro(
  title: string,
  questions: readonly Question[],
  options: PrintProOptions = {},
): string {
  const showArea = options.showAnswerArea !== false;
  const showScore = options.showScore === true;
  const parts: string[] = [
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${buildPrintProCss(options)}</style></head><body>`,
    renderHeader(options.headerTitle || title, `共 ${questions.length} 题`, options.paperNo),
    `<section class="questions">`,
  ];

  const printedGroups = new Set<string>();

  questions.forEach((q, i) => {
    const no = i + 1;
    // 材料组：组首打印材料卡片，组内后续子题不再重复
    let materialHtml = "";
    if (q.group && !printedGroups.has(q.group)) {
      const carrier = questions.find((m) => m.group === q.group && m.type === "material" && m.analysis);
      if (carrier?.analysis) {
        materialHtml = `<div class="material-block q-group-head">${renderMathInText(carrier.analysis)}</div>`;
        printedGroups.add(q.group);
      }
    }

    if (q.type === "material") {
      // 组材料题：保留已渲染的材料卡片（避免被遗失），自身不参与作答题号
      if (q.group) {
        if (materialHtml) parts.push(`<div class="q">${materialHtml}</div>`);
        return;
      }
      // 无组材料题：解析字段承载材料，属题面
      if (q.analysis) {
        parts.push(`<div class="q">${materialHtml}<div class="material-block">${renderMathInText(q.analysis)}</div></div>`);
      }
      return;
    }

    parts.push(`<div class="q">`);
    if (materialHtml) parts.push(materialHtml);
    const scoreHtml = showScore ? `<span class="q-score">${q.score} 分</span>` : "";
    parts.push(`<div class="q-head"><span class="q-type">${escapeHtml(TYPE_NAMES[q.type] ?? q.type)}</span>${no}.${scoreHtml}</div>`);
    parts.push(`<div class="q-stem">${renderMathInText(q.stem)}</div>`);
    q.options.forEach((o, oi) => {
      parts.push(`<div class="opt">${String.fromCharCode(65 + oi)}. ${renderMathInText(o)}</div>`);
    });
    if (showArea && (q.type === "fill" || q.type === "short")) {
      parts.push(`<div class="answer-area"></div>`);
      if (q.type === "short") parts.push(`<div class="answer-area"></div><div class="answer-area"></div>`);
    }
    parts.push(`</div>`);
  });

  parts.push(`</section>`, renderFooter(options.footerNote), `</body></html>`);
  return parts.join("\n");
}

/**
 * 生成 A4 双栏紧凑详解答案册 HTML。
 */
export function buildCompactAnswerSheetPro(
  title: string,
  questions: readonly Question[],
  options: PrintProOptions = {},
): string {
  const parts: string[] = [
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)} · 答案册</title><style>${buildPrintProCss(options)}</style></head><body>`,
    renderHeader(`${title} · 答案册`, `共 ${questions.length} 题（与题册同序）`, options.paperNo),
    `<section class="questions">`,
  ];

  let no = 0;
  for (const q of questions) {
    if (q.type === "material") continue;
    no++;
    parts.push(`<div class="q">`);
    parts.push(`<div class="q-head">${no}. <strong>${escapeHtml(q.answer)}</strong>${q.kp ? ` <span class="kp-tag">${escapeHtml(q.kp)}</span>` : ""}</div>`);
    if (q.type === "short" && q.rubric?.criteria?.length) {
      const rubricText = q.rubric.criteria.map((c) => `${c.label}(${Math.round(c.weight * 100)}%)`).join(" · ");
      parts.push(`<div class="ans-analysis">采分点：${escapeHtml(rubricText)}</div>`);
    }
    if (q.analysis) parts.push(`<div class="ans-analysis">${renderMathInText(q.analysis)}</div>`);
    parts.push(`</div>`);
  }

  parts.push(`</section>`, renderFooter(options.footerNote), `</body></html>`);
  return parts.join("\n");
}

export interface PrintSafetyReport {
  safe: boolean;
  violations: string[];
}

/** 安全审计：确认学生作答卷中绝不包含答案与解析（79-02 验收） */
export function auditQuestionSheetSafety(
  html: string,
  questions: readonly Question[],
): PrintSafetyReport {
  const violations: string[] = [];
  for (const q of questions) {
    if (q.type === "material") continue;
    // 答案文本（长度 ≥2 且非选项字母单字符）不应出现
    const answer = (q.answer ?? "").trim();
    if (answer.length >= 2 && html.includes(escapeHtml(answer))) {
      violations.push(`题 ${q.id} 的标准答案出现在作答卷中`);
    }
    if (q.analysis && q.analysis.trim().length >= 8 && q.group == null && q.type !== "short") {
      if (html.includes(escapeHtml(q.analysis.trim().slice(0, 20)))) {
        violations.push(`题 ${q.id} 的解析内容出现在作答卷中`);
      }
    }
  }
  return { safe: violations.length === 0, violations };
}
