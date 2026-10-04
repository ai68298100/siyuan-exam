// ============================================================
// 打印视图（TODO 68-01 lite）：题册/答案册分离的打印 HTML——
// 题册=题号/题型/题干/选项/材料+答题区（绝不包含答案与解析——验收红线）；
// 答案册=题号/答案/解析（单独打开打印）。A4 友好：题块防跨页断开。
// 纯函数：输入题目列表，输出自包含 HTML 字符串（escape 本地实现，core 无外部依赖）。
// ============================================================
import type { Question } from "./types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const TYPE_NAMES: Record<string, string> = {
  single: "单选",
  multiple: "多选",
  judge: "判断",
  fill: "填空",
  short: "简答",
  material: "材料",
};

const BASE_CSS = `
  * { box-sizing: border-box; }
  body { font-family: "Source Han Serif SC", "Noto Serif CJK SC", SimSun, serif; font-size: 12pt; line-height: 1.6; color: #111; margin: 1.5cm 1.8cm; }
  h1 { font-size: 15pt; text-align: center; margin: 0 0 4px; }
  .meta { text-align: center; color: #555; font-size: 10pt; margin-bottom: 14px; }
  .q { page-break-inside: avoid; margin-bottom: 14px; }
  .q-head { font-weight: 700; }
  .q-type { font-size: 9pt; color: #555; border: 1px solid #999; border-radius: 3px; padding: 0 4px; margin-right: 6px; }
  .q-stem { white-space: pre-wrap; overflow-wrap: anywhere; }
  .opt { margin-left: 1.5em; }
  .material { background: #f5f5f5; padding: 6px 10px; border-left: 3px solid #999; margin: 4px 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11pt; }
  .answer-area { border-bottom: 1px solid #999; height: 2.2em; margin: 6px 0 2px 1.5em; }
  .ans-line { margin-left: 1.5em; }
  .ans-analysis { color: #444; font-size: 10.5pt; margin-left: 1.5em; white-space: pre-wrap; overflow-wrap: anywhere; }
  .kp { color: #666; font-size: 9pt; }
  @media print { body { margin: 1.2cm 1.5cm; } }
`;

function head(title: string, note: string): string {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${BASE_CSS}</style></head><body><h1>${esc(title)}</h1><div class="meta">${esc(note)} · 小驴考试导出 · ${new Date().toLocaleDateString("zh-CN")}</div>`;
}

/** 题册：题干/选项/材料 + 答题区——不含答案与解析（68-01 验收：打印不泄露隐藏答案）。
 *  68-03 lite 题组连续性：连续同组（共用材料）题的材料框只印一次，组内后续题不再重复；断页由 .q 防跨页兜底。 */
export function buildQuestionSheet(title: string, questions: readonly Question[]): string {
  const parts = [head(title, `共 ${questions.length} 题`)];
  const materialPrinted = new Set<string>();
  questions.forEach((q, i) => {
    const no = i + 1;
    let materialBox: string | null = null;
    if (q.group && !materialPrinted.has(q.group)) {
      // 组首：材料题（或组内首个带解析的材料题）承载共用材料，只印一次
      const carrier = questions.slice(i).find((m) => m.group === q.group && m.type === "material" && m.analysis);
      if (carrier?.analysis) {
        materialBox = carrier.analysis;
        materialPrinted.add(q.group);
      }
    }
    parts.push(`<div class="q">`);
    if (materialBox) parts.push(`<div class="material">${esc(materialBox)}</div>`);
    parts.push(`<div class="q-head"><span class="q-type">${esc(TYPE_NAMES[q.type] ?? q.type)}</span>${no}. ${q.kp ? `<span class="kp">${esc(q.kp)}</span>` : ""}</div>`);
    if (!q.group && q.analysis && q.type === "material") {
      // 无组材料题：解析字段承载材料，按材料框展示（属题面）
      parts.push(`<div class="material">${esc(q.analysis)}</div>`);
    }
    parts.push(`<div class="q-stem">${esc(q.stem)}</div>`);
    q.options.forEach((o, oi) => {
      parts.push(`<div class="opt">${String.fromCharCode(65 + oi)}. ${esc(o)}</div>`);
    });
    if (q.type === "fill" || q.type === "short") {
      parts.push(`<div class="answer-area"></div>`);
    }
    parts.push(`</div>`);
  });
  parts.push("</body></html>");
  return parts.join("\n");
}

/** 答案册：题号/答案/解析（与题册同题序，便于对照） */
export function buildAnswerSheet(title: string, questions: readonly Question[]): string {
  const parts = [head(`${title} · 答案册`, `共 ${questions.length} 题（与题册同序）`)];
  questions.forEach((q, i) => {
    parts.push(`<div class="q">`);
    parts.push(`<div class="q-head">${i + 1}. <span class="ans-line">${esc(q.answer)}</span>${q.kp ? ` <span class="kp">${esc(q.kp)}</span>` : ""}</div>`);
    if (q.analysis) parts.push(`<div class="ans-analysis">${esc(q.analysis)}</div>`);
    parts.push(`</div>`);
  });
  parts.push("</body></html>");
  return parts.join("\n");
}
