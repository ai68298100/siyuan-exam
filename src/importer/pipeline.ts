// ============================================================
// 导入管线：解析 → 规范化 → 逐题校验 → 去重 → 报告（绝不整批失败）
// 纯函数无 IO —— renderer 传文件内容，测试传 fixture
// ============================================================
import type { Question, QuestionType } from "../core/types";
import { normalizeAnswer, questionHash, foldText, OPTION_LETTERS } from "../core/answer";
import { newQuestionId, newBatchId } from "../core/ids";
import { newGroupId } from "../core/cbt";

export interface ImportOptions {
  kp?: string; // 整批兜底考点
  difficulty?: number;
  source?: string;
  sourceKind?: "real" | "mock";
  dedupe?: boolean; // 默认 true：批内 + 与已存在 hash 集合去重
  existingHashes?: Set<string>;
  /** 内部：材料组自动分组的进行中组 ID（parseExcelRows 维护） */
  _pendingGroup?: string;
}

export interface ImportError {
  row: number; // 1-based 数据行
  reason: string;
  raw: string;
}

export interface ImportReport {
  ok: Question[];
  errors: ImportError[];
  duplicates: number;
  batch: string;
  /** 已有题摘要回灌（TODO 2.3）：与题库/本批重复的行样本（上限 20；text 路径暂不收集） */
  dupeSamples?: { row: number; stem: string }[];
}

const TYPE_ALIASES: Record<string, QuestionType> = {
  单选: "single",
  单选题: "single",
  single: "single",
  单项选择题: "single",
  多选: "multiple",
  多选题: "multiple",
  multiple: "multiple",
  多项选择题: "multiple",
  判断: "judge",
  判断题: "judge",
  judge: "judge",
  truefalse: "judge",
  填空: "fill",
  填空题: "fill",
  fill: "fill",
  简答: "short",
  简答题: "short",
  short: "short",
  问答: "short",
  论述: "short",
  材料: "material",
  材料题: "material",
  material: "material",
  共用题干: "material",
  共用备选答案: "material",
};

export function parseType(raw: string): QuestionType | null {
  const s = foldText(raw).toLowerCase().replace(/\s/g, "");
  return TYPE_ALIASES[s] ?? null;
}

/** 逐题校验：题干非空、答案在选项范围内、题型↔答案格式一致 */
export function validate(q: Question): string | null {
  if (!foldText(q.stem)) return "题干为空";
  if (q.type === "single") {
    if (q.options.length < 2) return "单选题至少需要 2 个选项";
    const idx = q.answer.charCodeAt(0) - 65;
    if (!(idx >= 0 && idx < q.options.length))
      return `答案 ${q.answer} 超出选项范围（A-${OPTION_LETTERS[q.options.length - 1]}）`;
  }
  if (q.type === "multiple") {
    if (q.options.length < 2) return "多选题至少需要 2 个选项";
    if (q.answer.length < 2) return "多选题答案至少 2 个字母";
    for (const ch of q.answer) {
      const idx = ch.charCodeAt(0) - 65;
      if (!(idx >= 0 && idx < q.options.length)) return `答案含越界选项 ${ch}`;
    }
  }
  // 选项区分度（"答案命中选项"核验的可检测面，AI 生成与导入共用）：
  // ① 空选项 ② 折叠后内容重复 ③ 正确答案选项文本在题干中逐字出现（题干泄漏答案；仅单选且文本 ≥4 字符防误伤）
  if (q.type === "single" || q.type === "multiple") {
    const folded = q.options.map((o) => foldText(o));
    if (folded.some((o) => !o)) return "存在空选项";
    const dup = folded.find((o, i) => folded.indexOf(o) !== i);
    if (dup) return `选项内容重复：${dup.slice(0, 20)}`;
    if (q.type === "single") {
      const ansText = folded[q.answer.charCodeAt(0) - 65] ?? "";
      if (ansText.length >= 4 && foldText(q.stem).includes(ansText)) return "题干泄漏答案（正确选项文本在题干中出现）";
    }
  }
  if (q.type === "judge" && q.answer !== "对" && q.answer !== "错") return "判断题答案必须为 对/错";
  if (q.type === "fill" && !q.answer) return "填空题答案为空";
  return null;
}

function build(
  raw: Omit<Question, "id" | "hash" | "origin" | "score"> & { score?: number },
  opt: ImportOptions,
): Question {
  return {
    ...raw,
    id: newQuestionId(),
    score: raw.score ?? 1,
    origin: "imported",
    kp: raw.kp || opt.kp,
    difficulty: raw.difficulty ?? opt.difficulty,
    source: raw.source || opt.source,
    sourceKind: raw.sourceKind ?? opt.sourceKind,
    hash: questionHash(raw.stem, raw.options),
  };
}

/** Aiken 解析：题干（可多行）；`A. `/`A) `选项；`ANSWER: X`；空行分题；`// ` 注释；`KP: ` 考点 */
export function parseAiken(text: string, opt: ImportOptions = {}): ImportReport {
  const errors: ImportError[] = [];
  const ok: Question[] = [];
  const seenHash = new Set(opt.existingHashes);
  const dedupe = opt.dedupe !== false;
  let duplicates = 0;
  const batch = newBatchId();

  const lines = text.split(/\r?\n/);
  const blocks: { rows: string[]; start: number }[] = [];
  let cur: { rows: string[]; start: number } | null = null;
  lines.forEach((line, i) => {
    if (!line.trim()) {
      if (cur) {
        blocks.push(cur);
        cur = null;
      }
      return;
    }
    if (!cur) cur = { rows: [], start: i + 1 };
    cur.rows.push(line);
  });
  if (cur) blocks.push(cur);

  for (const block of blocks) {
    const body = block.rows.filter((l) => !/^\s*\/\//.test(l));
    const kpLine = body.find((l) => /^KP\s*:/i.test(l));
    const ansLine = [...body].reverse().find((l) => /^ANSWER\s*:/i.test(l));
    const optLines = body.filter((l) => /^[A-J][.)]\s/.test(l));
    const stemLines = body.filter((l) => l !== ansLine && !/^[A-J][.)]\s/.test(l) && !/^KP\s*:/i.test(l) && l.trim());
    try {
      if (!stemLines.length) throw new Error("题干为空");
      if (!ansLine) throw new Error("缺少 ANSWER 行");
      if (optLines.length < 2) throw new Error("选项不足 2 个");
      const answer = normalizeAnswer("single", ansLine.replace(/^ANSWER\s*:\s*/i, ""));
      if (!answer) throw new Error("答案格式无法识别");
      const options = optLines.map((l) => l.replace(/^[A-J][.)]\s*/, ""));
      const idx = answer.charCodeAt(0) - 65;
      if (idx >= options.length) throw new Error(`答案 ${answer} 超出选项范围`);
      const q = build(
        {
          type: "single",
          stem: stemLines.join("\n"),
          options,
          answer,
          analysis: "",
          kp: kpLine ? kpLine.replace(/^KP\s*:\s*/i, "").trim() : "",
        },
        opt,
      );
      const bad = validate(q);
      if (bad) throw new Error(bad);
      if (dedupe && seenHash.has(q.hash)) duplicates++;
      else {
        seenHash.add(q.hash);
        ok.push(q);
      }
    } catch (e) {
      errors.push({ row: block.start, reason: (e as Error).message, raw: block.rows.join(" / ").slice(0, 120) });
    }
  }
  return { ok, errors, duplicates, batch };
}

/** Excel 列契约映射：题号(忽略)|题型|题干|选项A-F|答案|解析|难度|知识点|分值|来源 */
export interface ExcelColumnMap {
  type: number;
  stem: number;
  answer: number;
  options: number[]; // 2-6 个列下标
  analysis?: number;
  difficulty?: number;
  kp?: number;
  score?: number;
  source?: number;
}

export function parseExcelRows(rows: string[][], map: ExcelColumnMap, opt: ImportOptions = {}): ImportReport {
  const errors: ImportError[] = [];
  const ok: Question[] = [];
  const seenHash = new Set(opt.existingHashes);
  const dedupe = opt.dedupe !== false;
  let duplicates = 0;
  const dupeSamples: { row: number; stem: string }[] = [];
  const batch = newBatchId();
  let lastKp = ""; // 材料组内子题沿用材料的考点

  rows.forEach((row, i) => {
    const rowNo = i + 2; // 首行表头
    // Alt+Enter 净化：Excel 单元格内 \r\n 换行 → 空格（选项/答案不含换行符）
    const cell = (n?: number) => (n == null ? "" : String(row[n] ?? "").replace(/\r\n?/g, " ").replace(/\n/g, " ").trim());
    try {
      const type = parseType(cell(map.type));
      if (!type) throw new Error(`题型无法识别："${cell(map.type)}"`);
      const stem = cell(map.stem);
      const options = map.options.map((n) => cell(n)).filter((s) => s !== "");
      // 共用题干（医考材料组范式）：材料行开启新组；其后子题自动携带组 ID 与材料考点；
      // 子题带「不同」考点时结束该组（考点相同/为空 → 仍在组内）
      let group: string | undefined;
      if (type === "material") {
        group = newGroupId();
        opt._pendingGroup = group;
        lastKp = cell(map.kp);
      } else if (opt._pendingGroup != null) {
        group = opt._pendingGroup;
        if (cell(map.kp) && cell(map.kp) !== lastKp) {
          opt._pendingGroup = undefined; // 考点变化 → 出组（且本题不带组）
          group = undefined;
        }
      }
      const answer = type === "material" ? "" : normalizeAnswer(type, cell(map.answer));
      if (type !== "material" && !answer) throw new Error(`答案无法识别："${cell(map.answer)}"`);
      const diffRaw = parseInt(cell(map.difficulty) || "", 10);
      const scoreRaw = parseFloat(cell(map.score) || "0");
      const q = build(
        {
          type,
          stem,
          options,
          answer,
          analysis: cell(map.analysis),
          difficulty: Number.isFinite(diffRaw) ? Math.min(5, Math.max(1, diffRaw)) : undefined,
          kp: cell(map.kp) || (group ? lastKp : ""),
          score: Number.isFinite(scoreRaw) && scoreRaw > 0 ? scoreRaw : undefined,
          source: cell(map.source),
          group,
        },
        opt,
      );
      if (type === "material") lastKp = q.kp;
      const bad = type === "material" ? (foldText(stem) ? null : "材料题干为空") : validate(q);
      if (bad) throw new Error(bad);
      if (dedupe && seenHash.has(q.hash)) {
        duplicates++;
        // 已有题摘要回灌（TODO 2.3）：预览显示与题库重复的行，便于取消导入或删旧再导
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

/** 官方 Excel 模板：自动列映射（按表头名识别，找不到的列报给上层） */
export function autoMapExcel(header: string[]): { map: ExcelColumnMap; missing: string[] } {
  const find = (...names: string[]) => header.findIndex((h) => names.includes(foldText(h).toLowerCase()));
  const options: number[] = [];
  for (const L of OPTION_LETTERS.split("")) {
    const idx = find(`选项${L.toLowerCase()}`, `选项${L}`, L.toLowerCase());
    if (idx >= 0) options.push(idx);
  }
  const map: ExcelColumnMap = {
    type: find("题型", "type"),
    stem: find("题干", "stem", "题目"),
    answer: find("答案", "answer"),
    options,
    analysis: find("解析", "analysis"),
    difficulty: find("难度", "difficulty"),
    kp: find("知识点", "考点", "kp"),
    score: find("分值", "score"),
    source: find("来源", "source"),
  };
  const missing: string[] = [];
  if (map.type < 0) missing.push("题型");
  if (map.stem < 0) missing.push("题干");
  if (map.answer < 0) missing.push("答案");
  if (options.length < 2) missing.push("选项A/B（至少两列）");
  return { map, missing };
}

/** 粘贴文本按内容特征分流：GIFT（::题::/答案区）→ TSV（#头/制表符/两列问答）→ Aiken（默认）。
 *  gift/tsv 动态加载：二者复用本模块的 parseExcelRows/validate，静态依赖会成环 */
export async function parseText(text: string, opt: ImportOptions = {}): Promise<ImportReport> {
  if (isGiftText(text)) {
    const { parseGift } = await import("./gift");
    return parseGift(text, opt);
  }
  if (isTsvText(text)) {
    const { parseTsv } = await import("./tsv");
    return parseTsv(text, opt);
  }
  return parseAiken(text, opt);
}

/** GIFT 特征：::标题:: 前缀，或 {…} 答案区配 =/~ 正误标记 */
function isGiftText(text: string): boolean {
  if (/^\s*::[^:]+::/m.test(text)) return true;
  const zone = text.match(/\{([^}]*)\}/);
  return !!zone && (zone[1].includes("=") || zone[1].includes("~"));
}

/** TSV 特征：Anki # 文件头，或 ≥半数非空行含制表符（单行多列≥3 列也认） */
function isTsvText(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return false;
  if (lines.some((l) => /^#\w+:/.test(l.trim()))) return true;
  const withTab = lines.filter((l) => l.includes("\t")).length;
  if (withTab / lines.length >= 0.5) return true;
  return withTab > 0 && lines.some((l) => l.split("\t").length >= 3);
}

/** 错误清单导出 CSV（BOM 头保证 Excel 中文不乱码） */
export function errorsToCsv(errors: ImportError[]): string {
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const head = "行号,原因,原值";
  const body = errors.map((e) => [e.row, esc(e.reason), esc(e.raw)].join(","));
  return "\uFEFF" + [head, ...body].join("\r\n");
}
