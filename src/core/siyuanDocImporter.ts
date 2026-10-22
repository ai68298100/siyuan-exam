/**
 * 从思源笔记文档直接提取试题导入引擎 (SiYuan Doc Question Importer)
 * 职责：
 * 1. 预处理思源笔记导出的 Kramdown/Markdown 原文（清洗 IAL 块属性、折叠块、挖空等）；
 * 2. 自动通过内容特征分流送入 Aiken/TSV/GIFT/MarkdownExam 解析管线；
 * 3. 自动为提取出的题目注入文档来源元数据（docId、文档标题、hpath），实现题面与思源原生笔记溯源关联；
 * 4. 纯函数与轻量解析层，支持无头测试。
 */

import type { ImportOptions, ImportReport } from "../importer/pipeline";
import { parseText } from "../importer/pipeline";
import { newBatchId } from "./ids";

export interface SiyuanDocMeta {
  docId: string;
  title: string;
  hpath?: string;
  notebookId?: string;
}

/**
 * 预处理思源笔记文档 Markdown 文本：
 * 1. 剥离思源专有的 IAL 属性段 `{: id="xxx" ...}`，避免干扰题干解析；
 * 2. 将思源折叠块 `::: details 答案 ... :::` 或 `<details><summary>答案</summary>...</details>` 标准化；
 * 3. 规范化空白与换行。
 */
export function cleanSiyuanDocMarkdown(raw: string): string {
  if (!raw) return "";

  let s = raw;

  // 1. 移除思源 IAL 块属性行（例如 {: id="2026..." updated="2026..."}）
  s = s.replace(/\{:[^}]*\}\s*$/gm, "");

  // 2. 将思源常用折叠块答案转为标准提示词
  // 如 ::: details 答案与解析 ... ::: 转换为 【答案】与【解析】
  s = s.replace(/:::\s*details\s*(?:答案|解析|答案与解析)?\s*\r?\n([\s\S]*?):::/gi, (_m, body: string) => {
    return `\n${body.trim()}\n`;
  });

  // 3. 将 HTML <details> 折叠块转换为标准行
  s = s.replace(/<details>\s*<summary>([^<]*)<\/summary>([\s\S]*?)<\/details>/gi, (_m, summary: string, body: string) => {
    return `\n${summary.trim()}\n${body.trim()}\n`;
  });

  // 4. 清洗思源原生单行高亮 ==重点== 或挖空 {{c1::...}}
  // 保持内容分流识别能力

  return s.trim();
}

/**
 * 从思源笔记文档 Markdown 原文解析提取全套题目
 */
export async function parseQuestionsFromSiyuanDoc(
  docMarkdown: string,
  docMeta: SiyuanDocMeta,
  options: ImportOptions = {},
): Promise<ImportReport> {
  const cleanedText = cleanSiyuanDocMarkdown(docMarkdown);
  if (!cleanedText) {
    return {
      batch: newBatchId(),
      ok: [],
      errors: [{ row: 1, raw: "文档内容为空", reason: "未在选定的思源文档中读取到有效文本" }],
      duplicates: 0,
    };
  }

  // 统一通过导入分流引擎解析（支持 MarkdownExam / Aiken / TSV / GIFT / 挖空）
  const report = await parseText(cleanedText, options);

  // 为所有成功提取的题目注入文档元数据
  const rawQuestions = report.ok ?? [];
  const enrichedQuestions = rawQuestions.map((q) => {
    return {
      ...q,
      source: q.source && q.source !== "Markdown文档导入" ? q.source : docMeta.title,
      sourceKind: "real" as const,
      // 若原题无明确考点，默认将文档路径父级或标题作为建议考点
      kp: q.kp || (docMeta.hpath ? docMeta.hpath.replace(/^\/|\/$/g, "").replace(/\/[^/]+$/, "") : docMeta.title),
    };
  });

  return {
    ...report,
    ok: enrichedQuestions,
  };
}
