// ============================================================
// 52-09 思源正文挖空出题引擎（Cloze Question Generator）
// 1) 识别思源正文原生高亮 `==关键概念==` 与 Anki/RemNote 双花括号 `{{c1::概念::提示}}`。
// 2) 自动将挖空词替换为规范下划线横线 `____`，提取答案并生成标准 fill 题型。
// 3) 单空生成标准答案；多空（≥2 空）自动用 `;;` 分隔并挂载 MultiBlankSpec 结构化规格。
// ============================================================

import type { Question } from "./types";
import type { MultiBlankSpec } from "./structuredAnswer";
import { makeQuestion } from "./blockTemplate";

export interface ParsedClozeItem {
  raw: string; // 原始文本行/段落
  stem: string; // 替换后的题干（如 "我国的内核是用____语言编写的。"）
  answers: string[]; // 提取的所有填空词
  combinedAnswer: string; // 答案串（单空为词，多空为 "词1;;词2"）
  blankCount: number;
  spec?: MultiBlankSpec; // 多空填空题结构化规格
}

export interface ClozeParseOptions {
  /** 允许识别的语法模式：highlight (==高亮==), curly ({{花括号}}), bracket (（括号）) */
  modes?: ("highlight" | "curly" | "bracket")[];
  /** 填空题干占位符，默认 "____" */
  placeholder?: string;
  defaultKp?: string;
  defaultSource?: string;
}

/** 单行/单个段落挖空解析核心纯函数 */
export function parseSingleClozeSentence(
  sentence: string,
  opts?: ClozeParseOptions,
): ParsedClozeItem | null {
  const text = sentence.trim();
  if (!text) return null;

  const placeholder = opts?.placeholder ?? "____";
  const modes = opts?.modes ?? ["highlight", "curly"];
  const answers: string[] = [];

  // 1. 匹配替换逻辑
  // 模式 1: 双花括号 {{c1::答案::提示}} 或 {{答案}}
  // 模式 2: 思源高亮 ==答案==
  // 模式 3: 括号 （答案）
  let processed = text;

  if (modes.includes("curly")) {
    const curlyRegex = /\{\{(?:c\d+::)?([^}:]+?)(?:::([^}]+?))?\}\}/g;
    processed = processed.replace(curlyRegex, (_match, ans, hint) => {
      const cleanAns = String(ans ?? "").trim();
      if (!cleanAns) return _match;
      answers.push(cleanAns);
      return hint ? `${placeholder}（${hint.trim()}）` : placeholder;
    });
  }

  if (modes.includes("highlight")) {
    const highlightRegex = /==([^=\n\r]+?)==/g;
    processed = processed.replace(highlightRegex, (_match, ans) => {
      const cleanAns = String(ans ?? "").trim();
      if (!cleanAns) return _match;
      answers.push(cleanAns);
      return placeholder;
    });
  }

  if (modes.includes("bracket")) {
    const bracketRegex = /[（(]([^）)\n\r]{1,40})[）)]/g;
    processed = processed.replace(bracketRegex, (_match, ans) => {
      const cleanAns = String(ans ?? "").trim();
      if (!cleanAns) return _match;
      answers.push(cleanAns);
      return placeholder;
    });
  }

  if (answers.length === 0) return null;

  const combinedAnswer = answers.join(";;");
  let spec: MultiBlankSpec | undefined;
  if (answers.length > 1) {
    spec = {
      v: 1,
      kind: "multiBlank",
      blanks: answers.map((ans) => ({
        answers: [ans],
        caseSensitive: false,
      })),
    };
  }

  return {
    raw: text,
    stem: processed,
    answers,
    combinedAnswer,
    blankCount: answers.length,
    spec,
  };
}

/** 批量解析文本内容，逐段/逐行识别并提取填空题 */
export function parseClozeText(
  rawText: string,
  opts?: ClozeParseOptions,
): ParsedClozeItem[] {
  if (!rawText.trim()) return [];

  // 按行或双换行段落拆分
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items: ParsedClozeItem[] = [];

  for (const line of lines) {
    const item = parseSingleClozeSentence(line, opts);
    if (item) {
      items.push(item);
    }
  }

  return items;
}

/** 52-09 将解析出的挖空项批量转化为标准的 fill 填空题对象 */
export function clozeItemsToQuestions(
  items: readonly ParsedClozeItem[],
  meta?: { kp?: string; source?: string },
): Question[] {
  return items.map((it) => {
    return makeQuestion({
      type: "fill",
      stem: it.stem,
      options: [],
      answer: it.combinedAnswer,
      kp: meta?.kp,
      source: meta?.source,
      answerSpec: it.spec,
    });
  });
}
