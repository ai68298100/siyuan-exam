// ============================================================
// 勘误回导（TODO 57 lite）：题库元数据按 qid 定向勘误——
// 导出勘误模板（qid+当前值）→ 线下修订 → CSV 回导 → dry-run 预览 → 批量应用（撤销基线共用）。
// 字段口径=批量编辑的 5 个属性字段（知识点/难度/来源/年份/分值，块属性写 setExamAttrs）；
// 答案/解析勘误走 38-03 更新式重导（内容字段，不在此范围）。
// 纯函数无 IO：行解析（引号感知 CSV）/ 计划生成（只含有差异项，500 上限）。
// ============================================================
import { BATCH_FIELD_ATTR, type BatchField } from "./batchEdit";
import type { Question } from "./types";

export const ERRATA_FIELDS: BatchField[] = ["kp", "difficulty", "source", "year", "score"];
const MAX_ROWS = 500;

const FIELD_HEADERS: Record<BatchField, string[]> = {
  kp: ["知识点", "考点", "kp"],
  difficulty: ["难度", "difficulty"],
  source: ["来源", "source"],
  year: ["年份", "year"],
  score: ["分值", "score"],
};
const QID_HEADERS = ["题目id", "qid", "id"];

export interface ErrataRow {
  qid: string;
  fields: Partial<Record<BatchField, string>>;
}

/** 引号感知的单行拆分（RFC4180 子集："" 转义；逗号/制表符自动判别） */
export function splitCsvLine(line: string, delimiter: "," | "\t"): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function detectDelimiter(headerLine: string): "," | "\t" {
  return (headerLine.match(/\t/g)?.length ?? 0) > (headerLine.match(/,/g)?.length ?? 0) ? "\t" : ",";
}

/** 勘误 CSV 解析：qid 必填列（题目ID/qid/ID），5 字段列可选；非法行进 errors 不中断 */
export function parseErrataCsv(text: string): { rows: ErrataRow[]; errors: { row: number; reason: string }[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const errors: { row: number; reason: string }[] = [];
  if (!lines.length) return { rows: [], errors: [{ row: 1, reason: "文件为空" }] };
  const delimiter = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delimiter).map((h) => h.trim().toLowerCase());
  const qidCol = headers.findIndex((h) => QID_HEADERS.includes(h));
  if (qidCol < 0) return { rows: [], errors: [{ row: 1, reason: "缺少题目ID 列（表头需含 题目ID/qid/ID）" }] };
  const fieldCols = new Map<BatchField, number>();
  for (const f of ERRATA_FIELDS) {
    const idx = headers.findIndex((h) => FIELD_HEADERS[f].includes(h));
    if (idx >= 0) fieldCols.set(f, idx);
  }
  if (!fieldCols.size) return { rows: [], errors: [{ row: 1, reason: "没有任何勘误字段列（知识点/难度/来源/年份/分值 至少一列）" }] };

  const rows: ErrataRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const cells = splitCsvLine(lines[i], delimiter);
    const qid = (cells[qidCol] ?? "").trim();
    if (!qid) { errors.push({ row: lineNo, reason: "缺少题目ID" }); continue; }
    if (!/^q-[0-9a-f]{8}$/.test(qid)) { errors.push({ row: lineNo, reason: `题目ID 格式不符（应为 q-xxxxxxxx）：${qid}` }); continue; }
    const fields: Partial<Record<BatchField, string>> = {};
    for (const [f, idx] of fieldCols) {
      const v = (cells[idx] ?? "").trim();
      if (v !== "") fields[f] = v;
    }
    if (!Object.keys(fields).length) { errors.push({ row: lineNo, reason: "没有任何字段值" }); continue; }
    rows.push({ qid, fields });
    if (rows.length >= MAX_ROWS) { errors.push({ row: lineNo + 1, reason: `超过单批上限 ${MAX_ROWS} 行，其余未读` }); break; }
  }
  return { rows, errors };
}

export interface ErrataPlan {
  /** 字段写计划（blockId 已解析；走 app.applyBatchEdit 同一写路径） */
  changes: { qid: string; blockId: string; field: BatchField; from: string; to: string }[];
  unknownQids: string[];
  unchanged: number;
  truncated: number;
}

function currentValue(q: Question, field: BatchField): string {
  switch (field) {
    case "kp": return q.kp ?? "";
    case "difficulty": return q.difficulty != null ? String(q.difficulty) : "";
    case "source": return q.source ?? "";
    case "year": return q.year ?? "";
    case "score": return q.score != null ? String(q.score) : "";
  }
}

/** 计划生成：qid 定位（含 blockId），只收与当前值有差异的字段；未定位 qid 单列不混入计划 */
export function planErrata(
  rows: readonly ErrataRow[],
  existing: readonly (Question & { blockId?: string })[],
): ErrataPlan {
  const byQid = new Map(existing.map((q) => [q.id, q]));
  const changes: ErrataPlan["changes"] = [];
  const unknownQids: string[] = [];
  let unchanged = 0;
  let truncated = 0;
  for (const row of rows) {
    const q = byQid.get(row.qid);
    if (!q || !q.blockId) { unknownQids.push(row.qid); continue; }
    let rowChanged = false;
    for (const f of ERRATA_FIELDS) {
      const to = row.fields[f];
      if (to == null) continue;
      const from = currentValue(q, f);
      if (from === to) continue;
      if (changes.length >= MAX_ROWS) { truncated++; continue; }
      changes.push({ qid: row.qid, blockId: q.blockId, field: f, from, to });
      rowChanged = true;
    }
    if (!rowChanged) unchanged++;
  }
  return { changes, unknownQids, unchanged, truncated };
}

/** 勘误模板（qid+当前值，BOM 由调用方拼）：作者直接在值列上修订后回导 */
export function errataTemplateCsv(existing: readonly Question[]): string {
  const header = ["题目ID", ...ERRATA_FIELDS.map((f) => BATCH_FIELD_ATTR[f] ? ({ kp: "知识点", difficulty: "难度", source: "来源", year: "年份", score: "分值" } as Record<BatchField, string>)[f] : f)];
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(",")];
  for (const q of existing) {
    lines.push([
      q.id,
      q.kp ?? "",
      q.difficulty ?? "",
      q.source ?? "",
      q.year ?? "",
      q.score ?? "",
    ].map(esc).join(","));
  }
  return lines.join("\n");
}
