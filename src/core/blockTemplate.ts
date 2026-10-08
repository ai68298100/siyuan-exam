// ============================================================
// 题块模板：Question ↔ 思源超级块 markdown + exam-* IAL（双向编解码）
// 红线（docs/02 §2.2）：题干/选项/解析永远在块内容里，属性只存元数据
// 注意：思源 3.8.5 实测——IAL 与 setBlockAttrs 都必须写 custom-exam-* 全名，
//       attributes 表只索引 custom- 前缀属性（裸 exam-id 不入表 → listQuestions 查不到）。
//       读侧 stripCustom 归一后按 exam-* 取值。
// ============================================================
import type { Question, QuestionType } from "./types";
import { OPTION_LETTERS, normalizeAnswer, questionHash } from "./answer";
import { inferAnswerSpec } from "./structuredAnswer";
import { newQuestionId, newBatchId } from "./ids";

export const QUESTION_TYPES: QuestionType[] = ["single", "multiple", "judge", "fill", "short", "material"];

/** Question → 超级块 markdown（写入 createDocWithMd / appendBlock） */
export function questionToMarkdown(q: Question): string {
  let md = `{{{row\n${q.stem}\n`;
  if (q.options.length) {
    md += q.options.map((o, i) => `- ${OPTION_LETTERS[i]}. ${o}`).join("\n") + "\n";
  }
  if (q.analysis) md += `{{{row\n> ${q.analysis.replace(/\n/g, "\n> ")}\n}}}\n`;
  // IAL 必须闭合（{: ...}）：缺右花括号时 kramdown 不解析为块属性而是落成纯文本段落，
  // 真机 3.8.6 实测所有写入题目因此在 attributes 表不可见、练习台永远空库
  md += `}}}\n{: ${ialOf(q)}}`;
  return md;
}

/** Question → IAL 属性串（不含花括号） */
export function ialOf(q: Question): string {
  const attrs: Record<string, string> = {
    "exam-id": q.id,
    "exam-type": q.type,
    "exam-answer": q.answer,
    "exam-origin": q.origin,
    "exam-score": String(q.score),
  };
  if (q.difficulty) attrs["exam-difficulty"] = String(q.difficulty);
  if (q.source) attrs["exam-source"] = q.source;
  if (q.sourceKind) attrs["exam-source-kind"] = q.sourceKind;
  if (q.year) attrs["exam-year"] = q.year;
  if (q.kp) attrs["exam-kp"] = q.kp;
  if (q.batch) attrs["exam-batch"] = q.batch;
  if (q.group) attrs["exam-group"] = q.group;
  if (q.review) attrs["exam-review"] = q.review;
  if (q.analysis) attrs["exam-analysis"] = q.analysis;
  if (q.alt?.length) attrs["exam-alt"] = q.alt.join("|");
  if (typeof q.confidence === "number") attrs["exam-confidence"] = q.confidence.toFixed(2);
  return Object.entries(attrs)
    .map(([k, v]) => `custom-${k}="${escapeAttr(v)}"`)
    .join(" ");
}

// IAL 必须保持在一行；多行解析转为 `\n`，读回时再还原，避免续行被当成题干。
const escapeAttr = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");
const unescapeAttr = (s: string) => {
  let out = "";
  let escaped = false;
  for (const ch of s) {
    if (!escaped) {
      if (ch === "\\") escaped = true;
      else out += ch;
      continue;
    }
    if (ch === "n") out += "\n";
    else if (ch === '"' || ch === "\\") out += ch;
    else out += `\\${ch}`;
    escaped = false;
  }
  return escaped ? `${out}\\` : out;
};

/** 解析 IAL 串 → Record（容错：引号缺失/中文/转义） */
export function parseIal(ial: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z][\w-]*)="((?:[^"\\]|\\.)*)"/g;
  for (const m of ial.matchAll(re)) out[m[1]] = unescapeAttr(m[2]);
  return out;
}

export interface FromBlockInput {
  /** custom-exam-* 属性表（来自 SQL attributes 或 getBlockAttrs） */
  attrs: Record<string, string>;
  /** 超级块内文本行（题干 + "- X. 选项" 列表） */
  text: string;
}

const stripCustom = (k: string) => (k.startsWith("custom-") ? k.slice(7) : k);

/** 块属性+文本 → Question（读取路径；hash 重算） */
export function questionFromBlock(input: FromBlockInput): Question | null {
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.attrs)) attrs[stripCustom(k)] = v;
  const id = attrs["exam-id"];
  const type = attrs["exam-type"] as QuestionType;
  if (!id || !QUESTION_TYPES.includes(type)) return null;

  // 完整 markdown fixture 可能把多行 IAL 属性带进来；IAL 从 `{: ` 开始，
  // 后续换行属于属性值，不应再参与题干/选项解析。
  const allLines = input.text.split("\n");
  const ialLine = allLines.findIndex((line) => line.trimStart().startsWith("{: "));
  const rawLines = ialLine >= 0 ? allLines.slice(0, ialLine) : allLines;
  // 题块内容有两种来源：SQL content 通常只有外层 row 的文本，
  // 而 kramdown/fixture 可能包含完整的嵌套 row。只有明确进入第二层 row
  // 时才把引用行当解析，避免把题干中的 Markdown blockquote 误吞掉。
  const hasNestedRow = rawLines.filter((l) => l.trim() === "{{{row").length > 1;
  let rowDepth = 0;
  const analysisLines: string[] = [];
  const options: string[] = [];
  const stemLines: string[] = [];
  for (const raw of rawLines) {
    const l = raw.trim();
    if (!l || l.startsWith("{: ")) continue;
    if (l === "{{{row") {
      rowDepth += 1;
      continue;
    }
    if (l === "}}}") {
      rowDepth = Math.max(0, rowDepth - 1);
      continue;
    }
    if (hasNestedRow && rowDepth >= 2 && l.startsWith(">")) {
      analysisLines.push(l.replace(/^>\s?/, ""));
      continue;
    }
    const m = l.match(/^[-*]\s*([A-J])[.)]\s*(.+)$/);
    if (m) options[letterIdx(m[1])] = m[2];
    else stemLines.push(l);
  }
  // 压缩稀疏数组
  const denseOptions: string[] = [];
  for (let i = 0; i < options.length; i++) denseOptions.push(options[i] ?? "");

  const stem = stemLines.join("\n");
  return {
    id,
    type,
    stem,
    options: denseOptions,
    answer: attrs["exam-answer"] ?? "",
    analysis: attrs["exam-analysis"] ?? (analysisLines.length ? analysisLines.join("\n") : undefined),
    difficulty: attrs["exam-difficulty"] ? parseInt(attrs["exam-difficulty"], 10) : undefined,
    score: attrs["exam-score"] ? parseFloat(attrs["exam-score"]) : 1,
    source: attrs["exam-source"],
    sourceKind: attrs["exam-source-kind"] as Question["sourceKind"],
    year: attrs["exam-year"],
    kp: attrs["exam-kp"],
    group: attrs["exam-group"],
    origin: (attrs["exam-origin"] as Question["origin"]) ?? "imported",
    batch: attrs["exam-batch"],
    review: attrs["exam-review"] as Question["review"],
    alt: attrs["exam-alt"] ? attrs["exam-alt"].split("|") : undefined,
    fav: attrs["exam-fav"] === "1",
    /** 54-01：结构化作答规则（custom-exam-answer-spec JSON）；损坏/版本不符忽略，按旧口径判分 */
    answerSpec: parseAnswerSpecAttr(attrs["exam-answer-spec"]),
    hash: questionHash(stem, denseOptions),
  };
}

/** 54-01/03：块属性 JSON → answerSpec（宽容解析：非对象/缺 v/kind/形状不符 → undefined）。
 *  numeric：{v,kind,unit?…}；multiBlank：blanks=非空数组（逐项含 answers 非空数组）。 */
function parseAnswerSpecAttr(raw: string | undefined): Question["answerSpec"] {
  if (!raw) return undefined;
  try {
    const obj = JSON.parse(raw) as {
      v?: number;
      kind?: string;
      blanks?: { answers?: unknown }[];
    };
    if (!obj || obj.v !== 1) return undefined;
    if (obj.kind === "numeric") return obj as unknown as Question["answerSpec"];
    if (obj.kind === "multiBlank") {
      const blanks = Array.isArray(obj.blanks)
        ? obj.blanks.filter((b) => b && Array.isArray(b.answers) && b.answers.length > 0)
        : [];
      if (!blanks.length) return undefined;
      return { v: 1, kind: "multiBlank", blanks: blanks.map((b) => ({ answers: (b.answers as string[]).map(String) })) };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

const letterIdx = (L: string) => L.charCodeAt(0) - 65;

/** 便捷构造（手工录题/测试）：规范化答案后生成 Question */
export function makeQuestion(p: {
  type: QuestionType;
  stem: string;
  options?: string[];
  answer: string;
  analysis?: string;
  kp?: string;
  source?: string;
  difficulty?: number;
  alt?: string[];
  group?: string;
  /** 54 第三刀：显式指定结构化作答规则（缺省时填空题按答案自动识别：;;多空 / 纯数值±单位） */
  answerSpec?: Question["answerSpec"];
}): Question {
  const options = p.options ?? [];
  const answer = p.type === "material" ? "" : (normalizeAnswer(p.type, p.answer) ?? p.answer);
  const answerSpec =
    p.answerSpec ?? (p.type === "fill" ? inferAnswerSpec("fill", answer) : undefined);
  return {
    id: newQuestionId(),
    type: p.type,
    stem: p.stem,
    options,
    answer,
    analysis: p.analysis,
    difficulty: p.difficulty,
    score: 1,
    source: p.source,
    kp: p.kp,
    origin: "manual",
    group: p.group || undefined,
    batch: newBatchId(),
    review: "verified",
    alt: p.alt,
    ...(answerSpec ? { answerSpec } : {}),
    hash: questionHash(p.stem, options),
  };
}
