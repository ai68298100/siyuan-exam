/**
 * 教师多平台试题格式转换与导出引擎 (Format Exporter)
 * 职责：
 * 1. 导出为 Moodle / 学习通通用的标准 GIFT 试题格式；
 * 2. 导出为 Anki / FSRS 闪卡卡包兼容的 TSV 格式；
 * 3. 导出为排版优雅、带答案解析的 Markdown 标准试卷/题册文档。
 */

import type { Question } from "./types";
import { normalizeLatexFormula } from "./math";

/**
 * 导出为 Moodle/学习通标准 GIFT 格式
 */
export function exportQuestionsToGift(questions: readonly Question[]): string {
  const blocks: string[] = [];

  for (const q of questions) {
    if (q.type === "material") continue;

    const titlePrefix = q.kp ? `::${q.kp.replace(/[/: ]/g, "_")}::` : "";
    const stem = q.stem.replace(/[{}]/g, "\\$&").trim();
    const feedback = q.analysis ? `#${q.analysis.replace(/[{}]/g, "\\$&").trim()}` : "";

    if (q.type === "judge") {
      const isTrue = /^[Tt]|对|正确|√/.test(q.answer.trim());
      blocks.push(`${titlePrefix}${stem} {${isTrue ? "TRUE" : "FALSE"}${feedback}}`);
      continue;
    }

    if (q.type === "single") {
      const ansLetter = q.answer.trim().toUpperCase();
      const ansIdx = ansLetter.charCodeAt(0) - 65;

      const optParts: string[] = [];
      q.options.forEach((opt, i) => {
        const cleanedOpt = opt.replace(/[{}]/g, "\\$&").trim();
        if (i === ansIdx) {
          optParts.push(`=${cleanedOpt}${feedback}`);
        } else {
          optParts.push(`~${cleanedOpt}`);
        }
      });

      blocks.push(`${titlePrefix}${stem} {\n  ${optParts.join("\n  ")}\n}`);
      continue;
    }

    if (q.type === "multiple") {
      const ansLetters: string[] = q.answer.trim().toUpperCase().match(/[A-J]/g) || [];
      const weight = ansLetters.length > 0 ? (100 / ansLetters.length).toFixed(2) : "50";

      const optParts: string[] = [];
      q.options.forEach((opt, i) => {
        const letter = String.fromCharCode(65 + i);
        const cleanedOpt = opt.replace(/[{}]/g, "\\$&").trim();
        if (ansLetters.includes(letter)) {
          optParts.push(`~%${weight}%${cleanedOpt}`);
        } else {
          optParts.push(`~%-100%${cleanedOpt}`);
        }
      });

      blocks.push(`${titlePrefix}${stem} {\n  ${optParts.join("\n  ")}\n}`);
      continue;
    }

    if (q.type === "fill" || q.type === "short") {
      const cleanAns = q.answer.replace(/[{}]/g, "\\$&").trim();
      blocks.push(`${titlePrefix}${stem} {=${cleanAns}${feedback}}`);
      continue;
    }
  }

  return blocks.join("\n\n") + "\n";
}

/**
 * 导出为 Anki / 闪卡平台兼容的 TSV 问答卡格式（带正反面、标签）
 */
export function exportQuestionsToAnkiTsv(questions: readonly Question[]): string {
  const rows: string[] = [];
  rows.push("#separator:tab");
  rows.push("#html:true");
  rows.push("#tags column:3");

  for (const q of questions) {
    if (q.type === "material") continue;

    // 正面：题干 + 格式化选项
    let front = `<div><b>【${q.type === "single" ? "单选题" : q.type === "multiple" ? "多选题" : q.type === "judge" ? "判断题" : q.type === "fill" ? "填空题" : "简答题"}】</b> ${normalizeLatexFormula(q.stem)}</div>`;
    if (q.options.length) {
      front += "<ul style='margin-top:6px;padding-left:20px'>";
      q.options.forEach((opt, oi) => {
        front += `<li>${String.fromCharCode(65 + oi)}. ${normalizeLatexFormula(opt)}</li>`;
      });
      front += "</ul>";
    }

    // 反面：正确答案 + 解析 + 采分点
    let back = `<div><b>✔ 正确答案</b>：<span style='color:#2e7d32;font-weight:bold'>${normalizeLatexFormula(q.answer)}</span></div>`;
    if (q.analysis) {
      back += `<div style='margin-top:6px;color:#555'><b>💡 详解</b>：${normalizeLatexFormula(q.analysis)}</div>`;
    }
    if (q.rubric?.criteria?.length) {
      const rubricText = q.rubric.criteria.map((c) => `${c.label}(${Math.round(c.weight * 100)}%)`).join(" · ");
      back += `<div style='margin-top:4px;color:#0277bd'><b>📋 采分点</b>：${rubricText}</div>`;
    }

    // 标签：考点路径转换为 tag
    const tags = (q.kp ? q.kp.replace(/[/\s]/g, "_") : "小驴题库") + (q.userTags?.length ? ` ${q.userTags.join(" ")}` : "");

    // 格式化换行与制表符
    const cleanFront = front.replace(/\t/g, " ").replace(/\r?\n/g, "");
    const cleanBack = back.replace(/\t/g, " ").replace(/\r?\n/g, "");

    rows.push(`${cleanFront}\t${cleanBack}\t${tags}`);
  }

  return rows.join("\n");
}

/**
 * 导出为排版考究的标准 Markdown 试题册
 */
export function exportQuestionsToExamDocMarkdown(
  questions: readonly Question[],
  options: { title?: string } = {},
): string {
  const title = options.title || "标准试题精选手册";
  const lines: string[] = [];

  lines.push(`# 📚 ${title}`);
  lines.push(`> 导出时间：${new Date().toLocaleString()} | 题目总数：**${questions.length} 道**\n`);

  questions.forEach((q, i) => {
    const no = i + 1;
    const typeLabel = q.type === "single" ? "单选题" : q.type === "multiple" ? "多选题" : q.type === "judge" ? "判断题" : q.type === "fill" ? "填空题" : q.type === "material" ? "材料题" : "简答题";
    lines.push(`### ${no}. 【${typeLabel}】${q.stem.trim()}`);

    if (q.options.length) {
      lines.push("");
      q.options.forEach((opt, oi) => {
        lines.push(`- **${String.fromCharCode(65 + oi)}.** ${opt}`);
      });
    }

    lines.push("");
    lines.push(`> **【正确答案】**：\`${q.answer}\``);
    if (q.kp) lines.push(`> **【核心考点】**：${q.kp}`);
    if (q.difficulty) lines.push(`> **【难度系数】**：${"★".repeat(Math.min(5, Math.max(1, q.difficulty)))}`);
    if (q.analysis) {
      lines.push(`> **【试题解析】**：${q.analysis.trim()}`);
    }
    lines.push("\n---");
  });

  return lines.join("\n");
}
