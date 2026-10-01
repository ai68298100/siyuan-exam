// ============================================================
// 题块模板：Question ↔ 思源超级块 markdown + exam-* IAL（双向编解码）
// 红线（docs/02 §2.2）：题干/选项/解析永远在块内容里，属性只存元数据
// 注意：思源自定义属性存储带 custom- 前缀（2026-10-02 实测），
//       kramdown IAL 写 exam-id，读回时按 custom-exam-id 匹配。
// ============================================================
import type { Question, QuestionType } from "./types";
import { OPTION_LETTERS, normalizeAnswer, questionHash } from "./answer";
import { newQuestionId, newBatchId } from "./ids";

export const QUESTION_TYPES: QuestionType[] = ["single", "multiple", "judge", "fill", "short", "material"];

/** Question → 超级块 markdown（写入 createDocWithMd / appendBlock） */
export function questionToMarkdown(q: Question): string {
  let md = `{{{row\n${q.stem}\n`;
  if (q.options.length) {
    md += q.options.map((o, i) => `- ${OPTION_LETTERS[i]}. ${o}`).join("\n") + "\n";
  }
  if (q.analysis) md += `{{{row\n> ${q.analysis.replace(/\n/g, "\n> ")}\n}}}\n`;
  md += `}}}\n{: ${ialOf(q)}`;
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
  if (q.alt?.length) attrs["exam-alt"] = q.alt.join("|");
  if (typeof q.confidence === "number") attrs["exam-confidence"] = q.confidence.toFixed(2);
  return Object.entries(attrs).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(" ");
}

const escapeAttr = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const unescapeAttr = (s: string) => s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");

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

  const lines = input.text.split("\n").map((l) => l.trim()).filter(Boolean);
  const options: string[] = [];
  const stemLines: string[] = [];
  for (const l of lines) {
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
    analysis: "",
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
    hash: questionHash(stem, denseOptions),
  };
}

const letterIdx = (L: string) => L.charCodeAt(0) - 65;

/** 便捷构造（手工录题/测试）：规范化答案后生成 Question */
export function makeQuestion(p: {
  type: QuestionType; stem: string; options?: string[]; answer: string;
  analysis?: string; kp?: string; source?: string; difficulty?: number;
  alt?: string[];
}): Question {
  const options = p.options ?? [];
  const answer = p.type === "material" ? "" : (normalizeAnswer(p.type, p.answer) ?? p.answer);
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
    batch: newBatchId(),
    review: "verified",
    alt: p.alt,
    hash: questionHash(p.stem, options),
  };
}
