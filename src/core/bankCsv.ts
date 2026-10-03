// ============================================================
// 题库 CSV 导出（TODO 8 组 lite）：官方导入模板同表头 → CSV 文本
// 往返保证：表头与 docs/15 模板一致，autoMapExcel 可直接识别；
// 材料组 group 字段不导出（重导入按模板邻近规则重组，属声明内损失）。
// 纯函数；BOM 头保证 Excel 中文不乱码（与 errorsToCsv 同口径）。
// ============================================================
import type { Question } from "./types";

export const BANK_CSV_HEADERS = ["题号", "题型", "题干", "选项A", "选项B", "选项C", "选项D", "选项E", "选项F", "答案", "解析", "难度", "知识点", "分值", "来源"];

const TYPE_NAMES: Record<Question["type"], string> = {
  single: "单选", multiple: "多选", judge: "判断", fill: "填空", short: "简答", material: "材料",
};

function csvField(v: unknown): string {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function questionToCsvRow(q: Question, idx: number): string[] {
  const cells: unknown[] = [
    idx + 1, TYPE_NAMES[q.type], q.stem,
    ...[0, 1, 2, 3, 4, 5].map((i) => q.options[i] ?? ""),
    q.answer, q.analysis ?? "", q.difficulty ?? "", q.kp ?? "", q.score, q.source ?? "",
  ];
  return cells.map(csvField);
}

/** 题库 → CSV 文本（BOM 头；逐行 CRLF） */
export function questionsToCsv(qs: Question[]): string {
  const lines = [BANK_CSV_HEADERS.join(","), ...qs.map((q, i) => questionToCsvRow(q, i).join(","))];
  return "\uFEFF" + lines.join("\r\n");
}
