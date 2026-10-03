// ============================================================
// TSV/Anki 导出解析（TODO 2.3 / 42-04）：纯函数；走 parseExcelRows 同一校验/去重漏斗
// 契约：
//   1. `#` 开头行为 Anki 文件头（#separator:tab/comma/semicolon、#html:true/false、#notetype 等均跳过）
//   2. 首个数据行若含 ≥2 个已识别表头名（题型/题干/答案/选项A…）→ 表头模式，autoMapExcel 列映射
//   3. 否则每行恰好 2 列 → Anki 问答卡：front=题干、back=答案，按填空题入库（#html:true 或检测到标签时剥 HTML）
//   4. 其余 → 报错并给出可行动提示（需要表头行或两列问答格式）
// ============================================================
import type { ImportOptions, ImportReport, ImportError } from "./pipeline";
import { parseExcelRows, autoMapExcel, validate, type ExcelColumnMap } from "./pipeline";
import { newQuestionId, newBatchId } from "../core/ids";
import { foldText, questionHash } from "../core/answer";
import type { Question } from "../core/types";

const HEADER_NAMES = [
  "题型", "题干", "答案", "解析", "难度", "知识点", "考点", "分值", "来源",
  "type", "stem", "question", "answer", "analysis", "difficulty", "kp", "score", "source",
  "选项a", "选项b", "选项c", "选项d", "选项e", "选项f",
];

const stripHtml = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

function detectSeparator(headerLines: string[]): string {
  for (const l of headerLines) {
    const m = l.match(/^#separator:\s*(\S+)/i);
    if (m) {
      const s = foldText(m[1]).toLowerCase();
      if (s.startsWith("comma") || s === ",") return ",";
      if (s.startsWith("semicolon") || s === ";") return ";";
      return "\t";
    }
  }
  return "\t";
}

function looksLikeHeader(cells: string[]): boolean {
  const hits = cells.filter((c) => HEADER_NAMES.includes(foldText(c).toLowerCase())).length;
  return hits >= 2;
}

/** 无表头两列（Anki front/back）→ 填空题；返回与 parseExcelRows 同构的报告 */
function parseTwoColumn(
  rows: string[][],
  html: boolean,
  opt: ImportOptions,
): ImportReport {
  const errors: ImportError[] = [];
  const ok: Question[] = [];
  const seenHash = new Set(opt.existingHashes);
  const dedupe = opt.dedupe !== false;
  let duplicates = 0;
  const dupeSamples: { row: number; stem: string }[] = [];
  const batch = newBatchId();
  rows.forEach((row, i) => {
    const rowNo = i + 1;
    try {
      const stem = html ? stripHtml(row[0] ?? "") : (row[0] ?? "").trim();
      const answer = html ? stripHtml(row[1] ?? "") : (row[1] ?? "").trim();
      if (!stem) throw new Error("题干为空");
      if (!answer) throw new Error("答案列为空（Anki 问答卡第 2 列）");
      const q: Question = {
        id: newQuestionId(),
        type: "fill",
        stem,
        options: [],
        answer,
        score: 1,
        source: "TSV 导入",
        sourceKind: "mock",
        kp: opt.kp,
        origin: "imported",
        batch,
        hash: questionHash(stem, []),
      };
      const bad = validate(q);
      if (bad) throw new Error(bad);
      if (dedupe && seenHash.has(q.hash)) {
        duplicates++;
        if (dupeSamples.length < 20) dupeSamples.push({ row: rowNo, stem: stem.slice(0, 40) });
      } else {
        seenHash.add(q.hash);
        ok.push(q);
      }
    } catch (e) {
      errors.push({ row: rowNo, reason: (e as Error).message, raw: row.filter(Boolean).join(" | ").slice(0, 120) });
    }
  });
  return { ok, errors, duplicates, batch, dupeSamples };
}

/** TSV/Anki 导出 → ImportReport */
export function parseTsv(text: string, opt: ImportOptions = {}): ImportReport {
  const lines = text.split(/\r?\n/);
  const headerLines = lines.filter((l) => l.trim().startsWith("#"));
  const html = /#html:\s*true/i.test(headerLines.join("\n"));
  const sep = detectSeparator(headerLines);
  const dataLines = lines.filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (!dataLines.length) {
    return { ok: [], errors: [{ row: 1, reason: "TSV 内容为空（# 注释行之外没有数据行）", raw: "" }], duplicates: 0, batch: newBatchId() };
  }
  const rows = dataLines.map((l) => l.split(sep).map((c) => c.trim()));
  // 表头模式：首行含 ≥2 个已识别表头名 → 复用 Excel 列映射与解析漏斗
  if (looksLikeHeader(rows[0])) {
    const { map, missing } = autoMapExcel(rows[0]);
    if (missing.length) {
      return {
        ok: [],
        errors: [{ row: 1, reason: `TSV 表头缺少必要列：${missing.join("、")}`, raw: rows[0].join(sep).slice(0, 120) }],
        duplicates: 0,
        batch: newBatchId(),
      };
    }
    return parseExcelRows(rows.slice(1), map as ExcelColumnMap, opt);
  }
  // Anki 问答两列模式 → 填空题；首行若是 front/back 表头对则跳过
  if (rows.every((r) => r.length === 2)) {
    const isHeaderPair = /^(front|frontside)$/i.test(rows[0][0] ?? "") && /^(back|backside)$/i.test(rows[0][1] ?? "");
    return parseTwoColumn(isHeaderPair ? rows.slice(1) : rows, html, opt);
  }
  return {
    ok: [],
    errors: [
      {
        row: 1,
        reason: "TSV 格式未识别：需要表头行（题干/选项A/答案…）或 Anki 两列问答（front/back）",
        raw: rows[0].join(sep).slice(0, 120),
      },
    ],
    duplicates: 0,
    batch: newBatchId(),
  };
}
