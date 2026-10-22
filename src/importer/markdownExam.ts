/**
 * Markdown 试卷与文档批量试题解析器
 * 职责：
 * 将用户笔记文档或复制的整份 Markdown 试卷（含多道单选、多选、判断、填空、简答）
 * 自动切分为多道题目，提取题型、题干、选项列表、答案、解析与考点，
 * 输出统一的 ImportReport。
 */

import type { Question } from "../core/types";
import { newBatchId, newQuestionId } from "../core/ids";
import { questionHash } from "../core/answer";
import type { ImportOptions, ImportReport, ImportError } from "./pipeline";
import { validate } from "./pipeline";
import { parseOcrQuestionText } from "../core/ocr";

/**
 * 探测文本是否符合 Markdown 试卷/笔记试题特征
 */
export function isMarkdownExamText(text: string): boolean {
  if (!text || text.length < 10) return false;
  // 包含典型的答案标签：【答案】或 答案：或 参考答案
  const hasAnswerTag = /(?:【(?:参考)?答案】|^(?:参考)?答案\s*[:：])/m.test(text);
  // 包含题号开头：如 "1." 或 "1、" 或 "第1题" 或 "### 1."
  const hasQuestionNumber = /^\s*(?:###?\s*)?(?:第?\s*\d+\s*[.、题:：])/m.test(text);
  // 包含选项标号
  const hasOptions = /^[A-D][.、\s]/m.test(text);

  return (hasAnswerTag && (hasQuestionNumber || hasOptions)) || (hasQuestionNumber && hasOptions);
}

/**
 * 试卷文本分切为单题原始文本块
 */
export function splitMarkdownExamBlocks(text: string): Array<{ blockText: string; startLine: number; sectionKp?: string }> {
  const lines = text.split(/\r?\n/);
  const blocks: Array<{ blockText: string; startLine: number; sectionKp?: string }> = [];

  let currentLines: string[] = [];
  let blockStartLine = 1;
  let currentSectionKp = "";

  // 匹配题号开始标记：如 "1."、"2、"、"第3题"、"【1】"、"### 1."
  const QUESTION_START_REGEX = /^\s*(?:###?\s*)?(?:第?\s*\d+\s*[.、题:：]|【\d+】)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineNo = i + 1;

    // 检查是否为 Markdown 标题行：如 "# 2026年综合能力模拟试卷"、"## 一、单项选择题"
    const headingMatch = line.match(/^\s*#+\s*(.*)$/);
    if (headingMatch) {
      // 如果前面已经有一道完整题目，先将前一题存入 blocks（使用修改前的 currentSectionKp）
      const hasQContent = currentLines.some((l) => /^[A-D][.、\s]|(?:【(?:参考)?答案】|^(?:参考)?答案\s*[:：])/m.test(l.trim()));
      if (hasQContent && currentLines.length > 0) {
        blocks.push({
          blockText: currentLines.join("\n").trim(),
          startLine: blockStartLine,
          sectionKp: currentSectionKp || undefined,
        });
      }
      currentLines = [];

      const headingText = headingMatch[1].trim();
      const cleanKp = headingText.replace(/^[一二三四五六七八九十\d]+[、. ]\s*/, "").trim();
      if (cleanKp && !cleanKp.includes("试卷") && !cleanKp.includes("模拟") && !cleanKp.includes("真题")) {
        currentSectionKp = cleanKp;
      }
      continue;
    }

    const isQStart = QUESTION_START_REGEX.test(trimmed);

    if (isQStart && currentLines.length > 0) {
      // 遇到下一题题号，保存前一题块
      blocks.push({
        blockText: currentLines.join("\n").trim(),
        startLine: blockStartLine,
        sectionKp: currentSectionKp || undefined,
      });
      currentLines = [line];
      blockStartLine = lineNo;
    } else {
      if (currentLines.length === 0 && !trimmed) {
        // 跳过题目前面的空行
        continue;
      }
      if (currentLines.length === 0) {
        blockStartLine = lineNo;
      }
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0 && currentLines.join("\n").trim()) {
    blocks.push({
      blockText: currentLines.join("\n").trim(),
      startLine: blockStartLine,
      sectionKp: currentSectionKp || undefined,
    });
  }

  // 兜底：如果没按题号切出来（可能只有一道题或按双换行分隔）
  if (blocks.length <= 1) {
    const rawBlankBlocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    if (rawBlankBlocks.length > 1) {
      return rawBlankBlocks.map((b, idx) => ({
        blockText: b,
        startLine: idx * 5 + 1,
        sectionKp: currentSectionKp || undefined,
      }));
    }
  }

  return blocks;
}

/**
 * Markdown 试卷批量解析入口（与 parseAiken/parseGift 同输出 ImportReport）
 */
export function parseMarkdownExam(text: string, opt: ImportOptions = {}): ImportReport {
  const errors: ImportError[] = [];
  const ok: Question[] = [];
  const seenHash = new Set(opt.existingHashes);
  const dedupe = opt.dedupe !== false;
  let duplicates = 0;
  const dupeSamples: { row: number; stem: string }[] = [];
  const batch = newBatchId();

  const blocks = splitMarkdownExamBlocks(text);

  if (!blocks.length) {
    return {
      ok: [],
      errors: [{ row: 1, reason: "未检测到有效的试题内容", raw: text.slice(0, 100) }],
      duplicates: 0,
      batch,
      dupeSamples: [],
    };
  }

  for (let bi = 0; bi < blocks.length; bi++) {
    const { blockText, startLine, sectionKp } = blocks[bi];
    try {
      const parsed = parseOcrQuestionText(blockText, {
        fallbackKp: sectionKp,
        normalizeFormulas: true,
      });

      if (!parsed.stem) {
        throw new Error("未能解析出有效题干");
      }

      if (!parsed.answer && parsed.type !== "short") {
        throw new Error("缺少正确答案");
      }

      const q: Question = {
        id: newQuestionId(),
        type: parsed.type,
        stem: parsed.stem,
        options: parsed.options,
        answer: parsed.answer,
        analysis: parsed.analysis || undefined,
        kp: parsed.kp || sectionKp || undefined,
        source: opt.source || "Markdown文档导入",
        difficulty: parsed.difficulty ?? (parsed.type === "multiple" ? 4 : parsed.type === "short" ? 4 : 3),
        score: 1,
        batch,
        origin: "imported",
        hash: questionHash(parsed.stem, parsed.options),
      };

      const bad = validate(q);
      if (bad) throw new Error(bad);

      if (dedupe && seenHash.has(q.hash)) {
        duplicates++;
        if (dupeSamples.length < 5) {
          dupeSamples.push({ row: startLine, stem: q.stem });
        }
        continue;
      }

      seenHash.add(q.hash);
      ok.push(q);
    } catch (e) {
      errors.push({
        row: startLine,
        reason: (e as Error).message,
        raw: blockText.slice(0, 120),
      });
    }
  }

  return { ok, errors, duplicates, batch, dupeSamples };
}
