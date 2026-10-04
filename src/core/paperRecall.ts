// ============================================================
// 纸笔回录（TODO 68-02 lite）：纸质作答按「题号=作答」回录为 practice 流水。
// 语义（验收口径）：append-only 不覆盖任何线上数据；mode="paper" 标记来源；
// 未回录题不计完成；短答题机器不判分（not_attempted 口径，对错由自评回路处理）。
// 纯函数无 IO：行解析（=/：/: 分隔、全角等号宽容）+ 对照题册判分。
// ============================================================
import type { Question } from "./types";
import { grade } from "./answer";

export interface PaperRow {
  no: number; // 题册序（1-based）
  given: string;
}

export function parsePaperAnswers(text: string): { rows: PaperRow[]; errors: { row: number; reason: string }[] } {
  const errors: { row: number; reason: string }[] = [];
  const rows: PaperRow[] = [];
  const seen = new Set<number>();
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line) return;
    const m = line.match(/^(\d{1,4})\s*[=＝:：]\s*(.+)$/);
    if (!m) {
      errors.push({ row: lineNo, reason: `格式应为「题号=作答」：${line.slice(0, 30)}` });
      return;
    }
    const no = Number(m[1]);
    const given = m[2].trim();
    if (!Number.isInteger(no) || no < 1) {
      errors.push({ row: lineNo, reason: `题号需为正整数：${m[1]}` });
      return;
    }
    if (!given) {
      errors.push({ row: lineNo, reason: `第 ${no} 题作答为空` });
      return;
    }
    if (seen.has(no)) {
      errors.push({ row: lineNo, reason: `第 ${no} 题重复回录（保留首条）` });
      return;
    }
    seen.add(no);
    rows.push({ no, given });
  });
  return { rows, errors };
}

export interface PaperGradeItem {
  no: number;
  q: Question;
  given: string;
  verdict: "correct" | "wrong" | "not_attempted";
}

/** 对照题册判分：no 为题册 1-based 序（与答题卡/题册打印同序）；越界题号单列不入判分 */
export function gradePaper(
  questions: readonly Question[],
  rows: readonly PaperRow[],
): { items: PaperGradeItem[]; outOfRange: number[] } {
  const items: PaperGradeItem[] = [];
  const outOfRange: number[] = [];
  for (const row of rows) {
    const q = questions[row.no - 1];
    if (!q) {
      outOfRange.push(row.no);
      continue;
    }
    items.push({ no: row.no, q, given: row.given, verdict: grade(q, row.given).verdict });
  }
  return { items, outOfRange };
}
