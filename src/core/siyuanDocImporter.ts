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
 * 预处理思源笔记文档 Markdown 文本（完全只读，不修改原笔记）：
 * 1. 剥离思源专有的 IAL 属性段 `{: id="xxx" ...}`，避免干扰题干解析；
 * 2. 剥离引用块前缀 `>`，支持存放在引用块中的题面；
 * 3. 将思源折叠块 `::: details 答案 ... :::` 或 `<details><summary>答案</summary>...</details>` 标准化；
 * 4. 转换思源块引用 `((id "锚文本"))` 为易读文本；
 * 5. 转换思源双链 `[[文档|别名]]` 为纯文本别名；
 * 6. 将笔记常见问答卡 `Q:` / `A:` / `【问】` / `【答】` 映射为标准题面与答案结构。
 */
export function cleanSiyuanDocMarkdown(raw: string): string {
  if (!raw) return "";

  let s = raw;

  // 1. 移除思源 IAL 块属性行（例如 {: id="2026..." updated="2026..."}）
  s = s.replace(/\{:[^}]*\}\s*$/gm, "");

  // 2. 剥离行首引用块标记（支持整道题写在引用块 > 里的场景）
  s = s.replace(/^>\s?/gm, "");

  // 3. 将思源常用折叠块答案转为标准提示词
  // 如 ::: details 答案与解析 ... ::: 转换为 【答案】与【解析】
  s = s.replace(/:::\s*details\s*(?:答案|解析|答案与解析)?\s*\r?\n([\s\S]*?):::/gi, (_m, body: string) => {
    return `\n【答案】\n${body.trim()}\n`;
  });

  // 4. 将 HTML <details> 折叠块转换为标准行
  s = s.replace(/<details>\s*<summary>([^<]*)<\/summary>([\s\S]*?)<\/details>/gi, (_m, summary: string, body: string) => {
    const sum = summary.trim();
    const isAns = /(?:答案|解析|详解)/.test(sum);
    return `\n${isAns ? "【答案】" : sum}\n${body.trim()}\n`;
  });

  // 5. 替换思源块引用：((id "锚文本")) 替换为 锚文本；纯 ((id)) 移除
  s = s.replace(/\(\([0-9a-zA-Z-]+\s+"([^"]+)"\)\)/g, "$1");
  s = s.replace(/\(\([0-9a-zA-Z-]+\)\)/g, "");

  // 6. 替换思源双链：[[title|alias]] 替换为 alias；[[title]] 替换为 title
  s = s.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2");
  s = s.replace(/\[\[([^\]]+)\]\]/g, "$1");

  // 7. 问答卡问答标号归一化：支持 Q: ... A: ... 与 【问】... 【答】...
  s = s.replace(/^\s*(?:Q\d*|【问\d*】)\s*[:：]\s*/gim, "");
  s = s.replace(/^\s*(?:A\d*|【答\d*】)\s*[:：]\s*/gim, "【答案】：");

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

export interface SiyuanDocBatchItem {
  docId: string;
  title: string;
  hpath?: string;
  markdown: string;
}

/**
 * 批量从多篇思源笔记文档中提取试题，合并结果并确定性去重
 */
export async function parseQuestionsFromSiyuanDocBatch(
  docs: readonly SiyuanDocBatchItem[],
  options: ImportOptions = {},
): Promise<ImportReport> {
  const allQuestions: import("./types").Question[] = [];
  const allErrors: import("../importer/pipeline").ImportError[] = [];
  let duplicates = 0;
  const seenHash = new Set(options.existingHashes);

  for (const doc of docs) {
    const singleReport = await parseQuestionsFromSiyuanDoc(doc.markdown, {
      docId: doc.docId,
      title: doc.title,
      hpath: doc.hpath,
    }, {
      ...options,
      existingHashes: seenHash,
    });

    duplicates += singleReport.duplicates || 0;

    for (const q of singleReport.ok) {
      if (seenHash.has(q.hash)) {
        duplicates++;
      } else {
        seenHash.add(q.hash);
        allQuestions.push(q);
      }
    }
    allErrors.push(...singleReport.errors);
  }

  return {
    batch: newBatchId(),
    ok: allQuestions,
    errors: allErrors,
    duplicates,
  };
}
