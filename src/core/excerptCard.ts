// ============================================================
// 阅读笔记原文高亮与切片渐进式制卡出题引擎（Excerpt Card Engine）
//
// 1) 渐进式学习（Incremental Reading / Progressive Summarization）：
//    支持从学习资料切片（Excerpt）或用户阅读笔记（MaterialNote）中提取知识卡。
// 2) 智能卡片类型自适应推断：
//    - 高亮/挖空语法（==高亮==、{{c1::挖空}}、**加粗**）→ fill 填空卡（支持多空 multiBlank 规格）
//    - 概念定义句式（"...是指..."、"概念：定义"、"Q: ... A: ..."）→ short 简答背诵卡（附带自适应采分点 rubric）
//    - 列表要素句式（"包括：1... 2... 3..."、"三大要素：A、B、C"）→ multiple 多选卡或单选排除卡
//    - 辨析正反句式（"误区：...并非..."、"区别于..."）→ judge 正误判断卡
// 3) 严密溯源（Provenance & Traceability）：
//    保留 materialId、materialTitle、revision、locator（页码/时间点/引文）、noteId，
//    自动打标并在 source 中格式化显示，无缝对接题库与复习系统。
// 4) 纯函数无副作用，具备防重复提取校验与置信度打标。
// ============================================================

import type { Question, QuestionType } from "./types";
import type { RubricSpec } from "./rubric";
import type { NoteLocator, MaterialNote } from "./materialNotes";
import { makeQuestion } from "./blockTemplate";
import { locatorLabel } from "./materialNotes";
import { parseSingleClozeSentence } from "./cloze";

/** 切片输入源：可来自原生阅读切片，或由 MaterialNote 适配转换 */
export interface ExcerptSource {
  /** 切片原文或笔记正文 */
  text: string;
  /** 关联的学习材料 ID */
  materialId?: string;
  /** 学习材料标题 */
  materialTitle?: string;
  /** 材料版本号 */
  revision?: number;
  /** 关联的笔记 ID（若是从笔记生成） */
  noteId?: string;
  /** 物理定位器：页码/秒数/短引文 */
  locator?: NoteLocator | null;
  /** 关联标签列表 */
  tags?: string[];
  /** 知识点/考点层级（若缺省则自动推断） */
  kp?: string;
  /** 思源块 ID（若有） */
  blockId?: string;
}

/** 制卡提取配置选项 */
export interface ExcerptExtractOptions {
  /** 允许生成的题型白名单，缺省允许所有题型 */
  targetTypes?: QuestionType[];
  /** 简答题是否自动生成采分点（rubric），默认 true */
  autoRubric?: boolean;
  /** 缺省知识点分类，默认 "阅读笔记切片" */
  defaultKp?: string;
  /** 是否将首个标签作为考点分类，默认 true */
  tagAsKp?: boolean;
  /** 置信度阈值（0~1）：高于此值置为 verified，低于此值置为 pending，默认 0.75 */
  confidenceThreshold?: number;
  /** 填空题占位符，默认 "____" */
  placeholder?: string;
  /** 默认分值，默认 1 */
  defaultScore?: number;
  /** 启用列表要素提取多选题，默认 true */
  generateListQuestions?: boolean;
  /** 启用正反辨析提取判断题，默认 true */
  generateContrastJudge?: boolean;
}

/** 单次提取输出 */
export interface CardExtractionResult {
  questions: Question[];
  stats: {
    total: number;
    byType: Record<QuestionType, number>;
  };
  skipped: {
    reason: string;
    text: string;
  }[];
}

/** 规范化材料溯源文本（如：[材料] 计算机网络 (P12) 或 [笔记] P3 · 「引文」） */
export function formatExcerptProvenance(source: ExcerptSource): string {
  const parts: string[] = [];
  if (source.materialTitle) {
    parts.push(source.materialTitle.trim());
  } else if (source.materialId) {
    parts.push(source.materialId);
  }

  const loc = locatorLabel(source.locator);
  if (loc) {
    parts.push(loc);
  }

  if (source.noteId && !parts.length) {
    parts.push(`笔记 ${source.noteId}`);
  }

  if (parts.length === 0) {
    return "阅读切片摘录";
  }
  return parts.join(" · ");
}

/** 推导考点（KP）分类 */
export function inferKnowledgePoint(source: ExcerptSource, defaultKp = "阅读切片摘录", tagAsKp = true): string {
  if (source.kp && source.kp.trim()) {
    return source.kp.trim();
  }
  if (tagAsKp && source.tags && source.tags.length > 0) {
    const firstTag = source.tags[0].trim();
    if (firstTag) return firstTag;
  }
  if (source.materialTitle && source.materialTitle.trim()) {
    return source.materialTitle.trim();
  }
  return defaultKp;
}

// ------------------------------------------------------------
// 核心卡片提取器（Extractors）
// ------------------------------------------------------------

/**
 * 1. 原生高亮与标记挖空提取（Cloze / Fill）
 */
function extractClozeCards(
  source: ExcerptSource,
  opts: ExcerptExtractOptions,
  kp: string,
  provenance: string,
): Question[] {
  const results: Question[] = [];
  const text = source.text;
  const placeholder = opts.placeholder ?? "____";

  // 先拆分成句子或段落
  const lines = text
    .split(/\r?\n|。(?=[^」』”’\s])/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // 检查是否包含高亮 ==...== 或花括号 {{...}} 或 Markdown 加粗 **...**
    const hasClozeSyntax = /==[^=\n\r]+==|\{\{[^}\n\r]+?\}\}|\*\*[^*\n\r]{2,30}\*\*/.test(line);
    if (!hasClozeSyntax) continue;

    // 先做一次粗替换：将 **...** 在没有 == 时也转换为高亮格式，方便 cloze 解析
    // 同时去除显式的“挖空：”或“填空：”提示前缀
    let normalizedLine = line.replace(/^(?:(?:[【\[]?挖空[】\]]?|[【\[]?填空[】\]]?)\s*[:：]\s*)/i, "");
    if (!/==[^=\n\r]+==/.test(normalizedLine)) {
      normalizedLine = normalizedLine.replace(/\*\*([^*\n\r]{2,30})\*\*/g, "==$1==");
    }

    const parsed = parseSingleClozeSentence(normalizedLine, {
      placeholder,
      modes: ["highlight", "curly"],
    });

    if (parsed && parsed.answers.length > 0) {
      const q = makeQuestion({
        type: "fill",
        stem: parsed.stem,
        answer: parsed.combinedAnswer,
        analysis: `【切片出处】${provenance}\n【原文完整语句】${line}`,
        kp,
        source: provenance,
        difficulty: Math.min(5, Math.max(1, parsed.answers.length)),
        answerSpec: parsed.spec,
      });

      // 附加来源块元数据与溯源属性
      q.score = opts.defaultScore ?? 1;
      q.confidence = 0.95; // 显式高亮挖空具有极高置信度
      q.origin = "manual";
      q.review = "verified";
      if (source.blockId) q.blockId = source.blockId;
      results.push(q);
    }
  }

  return results;
}

/**
 * 2. 概念与定义问答卡提取（Definition & QA / Short）
 */
function extractDefinitionQACards(
  source: ExcerptSource,
  opts: ExcerptExtractOptions,
  kp: string,
  provenance: string,
): Question[] {
  const results: Question[] = [];
  const text = source.text;

  // 模式 A：Q & A 显式格式（Q: ... A: ... 或 问：... 答：... 或 问答：... 答：... 或 问题：... 答案：...）
  const qaPattern = /(?:^|\n|\b)(?:Q|问答|问题|问)\s*[:：]\s*([^\n\r]+?)\s*(?:\n\s*|\s+)(?:A|答案|答)\s*[:：]\s*([\s\S]+?)(?=(?:\n\s*(?:Q|问答|问题|问)\s*[:：])|$)/gi;
  let qaMatch: RegExpExecArray | null;
  const coveredRanges: [number, number][] = [];

  while ((qaMatch = qaPattern.exec(text)) !== null) {
    const rawQuestion = qaMatch[1].trim();
    const answer = qaMatch[2].trim();
    if (rawQuestion.length >= 3 && answer.length >= 3) {
      coveredRanges.push([qaMatch.index, qaMatch.index + qaMatch[0].length]);
      const stem = rawQuestion.endsWith("？") || rawQuestion.endsWith("?") ? rawQuestion : `${rawQuestion}？`;
      const rubric = opts.autoRubric !== false ? generateAutoRubric(answer) : undefined;
      const q = makeQuestion({
        type: "short",
        stem: `【问答】${stem}`,
        answer,
        analysis: `【切片出处】${provenance}`,
        kp,
        source: provenance,
        difficulty: 3,
        rubric,
      });
      q.confidence = 0.92;
      q.review = "verified";
      if (source.blockId) q.blockId = source.blockId;
      results.push(q);
    }
  }

  // 模式 B：定义句式（"【概念】是指/指的是..." 或 "某某，是指..." 或 "定义/概念：..."）
  // 匹配形如：TCP（传输控制协议）是指一种面向连接的、可靠的传输层通信协议。
  // 若某处已由模式 A 覆盖，或包含明确的挖空标记（==高亮== 或 {{挖空}}），则跳过，避免重复提取
  const defPattern = /([A-Za-z0-9\u4e00-\u9fa5（）()、·-]{2,25})\s*(?:(?:是指|指的是|即|被定义为)|(?:(?:概念|定义)\s*[:：]))\s*([^。；\n\r]{8,150})/g;
  let defMatch: RegExpExecArray | null;
  while ((defMatch = defPattern.exec(text)) !== null) {
    const matchIndex = defMatch.index;
    const matchEnd = matchIndex + defMatch[0].length;
    // 检查是否在已处理的 QA 区间内
    const isCoveredByQA = coveredRanges.some(([start, end]) => matchIndex >= start && matchEnd <= end);
    if (isCoveredByQA) continue;

    // 检查匹配片段是否含有高亮或花括号
    if (/==[^=\n\r]+==|\{\{[^}\n\r]+?\}\}/.test(defMatch[0])) continue;

    const concept = defMatch[1].replace(/^[·、\s]+|[·、\s]+$/g, "").trim();
    const definition = defMatch[2].trim();

    // 过滤常见伪概念（例如“注意”、“例如”、“原因是”）
    if (isInvalidConcept(concept)) continue;
    if (definition.length < 8) continue;

    const stem = `请简述「${concept}」的定义与核心特征。`;
    const answer = `${concept}是指${definition}。`;
    const rubric = opts.autoRubric !== false ? generateAutoRubric(definition) : undefined;

    const q = makeQuestion({
      type: "short",
      stem,
      answer,
      analysis: `【切片出处】${provenance}\n【原文摘录】${defMatch[0]}`,
      kp,
      source: provenance,
      difficulty: 2,
      rubric,
    });
    q.confidence = 0.88;
    q.review = "verified";
    if (source.blockId) q.blockId = source.blockId;
    results.push(q);
  }

  return results;
}

/**
 * 3. 列表要素与多项选择卡提取（List & Enumeration / Multiple or Single）
 */
function extractListEnumerationCards(
  source: ExcerptSource,
  _opts: ExcerptExtractOptions,
  kp: string,
  provenance: string,
): Question[] {
  const results: Question[] = [];
  const text = source.text;

  // 模式 A：显式列表句式（"X包括/分为/具有以下要素：1. A  2. B  3. C"）
  const listPattern = /([^\n。；]{3,30}?)(?:主要)?(?:包括|分为|包含|具有|涵盖)(?:以下)?(?:几个|几项|下列)?(?:核心|基础|关键)?(?:要素|特征|原则|方面|阶段|步骤|类型|功能|部分|组成|内容)?[:：]\s*([\s\S]+?)(?=\n\n|$)/g;
  let listMatch: RegExpExecArray | null;
  while ((listMatch = listPattern.exec(text)) !== null) {
    const subject = listMatch[1].trim();
    const body = listMatch[2].trim();

    // 解析出子项：支持 1. A / ① A / - A / 顿号并列
    const items = parseListItems(body);
    if (items.length >= 2 && items.length <= 6) {
      // 生成一道多选题
      const stem = `根据切片内容，关于「${subject}」的组成要素，下列各项中正确的有：`;
      const options = items.slice(0, 4); // 取前 4 项做为正确选项组合或待选组合
      
      // 如果正好 2~4 个选项，可全选多选
      if (options.length >= 2 && options.length <= 4) {
        const correctLetters = ["A", "B", "C", "D"].slice(0, options.length).join("");
        const q = makeQuestion({
          type: "multiple",
          stem,
          options,
          answer: correctLetters,
          analysis: `【切片出处】${provenance}\n【完整组成】\n${items.map((it, i) => `${i + 1}. ${it}`).join("\n")}`,
          kp,
          source: provenance,
          difficulty: 3,
        });
        q.confidence = 0.85;
        q.review = "verified";
        if (source.blockId) q.blockId = source.blockId;
        results.push(q);
      }
    }
  }

  return results;
}

/**
 * 4. 正反辨析与易错判断卡提取（Contrast / Judge）
 */
function extractContrastJudgeCards(
  source: ExcerptSource,
  _opts: ExcerptExtractOptions,
  kp: string,
  provenance: string,
): Question[] {
  const results: Question[] = [];
  const text = source.text;

  // 识别正误/注意/辨析句式：
  // "注意：X并非Y"、"误区：X...，实际上Y"、"易混淆：X...而Y..."
  const contrastPattern = /(?:注意|易错点|误区|辨析|区别|警惕)[:：]\s*([^\n\r。；]+(?:[。；\n]|$))/g;
  let match: RegExpExecArray | null;
  while ((match = contrastPattern.exec(text)) !== null) {
    const sentence = match[1].trim();
    if (sentence.length < 8) continue;

    // 尝试识别反命题（含有“并非”、“不是”、“不能”、“错误的是”）
    const hasNegative = /并非|不是|并不|不能|切勿|严禁|不可/.test(sentence);
    if (hasNegative) {
      // 可以生成判断题（真命题与解析）
      const stem = `【辨析判断】${sentence.replace(/^[·\s]+/, "")}`;
      const q = makeQuestion({
        type: "judge",
        stem,
        answer: "对", // 原文提醒的论断本身是正确的判断
        analysis: `【切片出处】${provenance}\n【原文易错提示】${sentence}`,
        kp,
        source: provenance,
        difficulty: 2,
      });
      q.confidence = 0.82;
      q.review = "verified";
      if (source.blockId) q.blockId = source.blockId;
      results.push(q);
    }
  }

  return results;
}

// ------------------------------------------------------------
// 辅助子函数
// ------------------------------------------------------------

/** 自动从解释文本提取关键词/短句并构建主观采分点 Rubric */
export function generateAutoRubric(text: string, fullScore = 5): RubricSpec {
  // 按句号、分号、顿号、逗号拆解采分短语
  const fragments = text
    .split(/[。；;，,\n\r]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && s.length <= 25);

  const criteriaList = (fragments.length > 0 ? fragments.slice(0, 4) : [text.slice(0, 30)]).map((frag, idx) => ({
    id: `crit-${idx + 1}`,
    label: `核心要点 ${idx + 1}：${frag}`,
    weight: 1,
    example: frag,
    levels: [
      { key: "full" as const, label: "完全答出", ratio: 1.0 },
      { key: "partial" as const, label: "部分提及", ratio: 0.5 },
      { key: "none" as const, label: "未作答或错误", ratio: 0 },
    ],
  }));

  // 权重均分
  const weightPerCrit = Math.max(1, Math.floor(fullScore / criteriaList.length));
  for (const c of criteriaList) {
    c.weight = weightPerCrit;
  }

  return {
    v: 1,
    kind: "rubric",
    fullScore,
    criteria: criteriaList,
  };
}

/** 解析子列表项 */
function parseListItems(body: string): string[] {
  // 1. 尝试数字序号或符号行
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const matchedLines: string[] = [];
  for (const line of lines) {
    const m = line.match(/^(?:(?:\d+[.、)])|(?:[①②③④⑤⑥⑦⑧⑨⑩])|[-*•])\s*(.+)$/);
    if (m) {
      matchedLines.push(m[1].trim());
    }
  }
  if (matchedLines.length >= 2) return matchedLines;

  // 2. 尝试同一行内顿号或逗号并列："A、B、C以及D"
  const separated = body
    .replace(/以及|和|与/g, "、")
    .split(/[、,，]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 25);

  if (separated.length >= 2) return separated;

  return [];
}

/** 概念过滤规则，避免提取伪词汇 */
function isInvalidConcept(name: string): boolean {
  const invalids = new Set([
    "注意",
    "提示",
    "例如",
    "说明",
    "综上",
    "原因",
    "结果",
    "要求",
    "特点",
    "这是",
    "它是",
    "如果",
    "总之",
    "问答",
    "问题",
    "答案",
    "解析",
    "思考",
    "复习",
    "练习",
    "考点",
  ]);
  return invalids.has(name) || name.length <= 1;
}

// ------------------------------------------------------------
// 顶层主入口
// ------------------------------------------------------------

/**
 * 从阅读切片/摘录（ExcerptSource）中提取卡片/题目
 */
export function extractCardsFromExcerpt(
  source: ExcerptSource,
  opts: ExcerptExtractOptions = {},
): CardExtractionResult {
  const text = (source.text || "").trim();
  const skipped: { reason: string; text: string }[] = [];
  const targetTypes = new Set<QuestionType>(
    opts.targetTypes ?? ["fill", "short", "multiple", "single", "judge"],
  );

  if (!text) {
    return {
      questions: [],
      stats: {
        total: 0,
        byType: { single: 0, multiple: 0, judge: 0, fill: 0, short: 0, material: 0 },
      },
      skipped: [{ reason: "切片内容为空", text: "" }],
    };
  }

  const kp = inferKnowledgePoint(source, opts.defaultKp, opts.tagAsKp);
  const provenance = formatExcerptProvenance(source);
  const allExtracted: Question[] = [];

  // 1. Cloze / Fill 卡片
  if (targetTypes.has("fill")) {
    const clozeCards = extractClozeCards(source, opts, kp, provenance);
    allExtracted.push(...clozeCards);
  }

  // 2. Definition & QA / Short 卡片
  if (targetTypes.has("short")) {
    const defCards = extractDefinitionQACards(source, opts, kp, provenance);
    allExtracted.push(...defCards);
  }

  // 3. List & Enumeration / Multiple or Single 卡片
  if (opts.generateListQuestions !== false && targetTypes.has("multiple")) {
    const listCards = extractListEnumerationCards(source, opts, kp, provenance);
    allExtracted.push(...listCards);
  }

  // 4. Contrast / Judge 卡片
  if (opts.generateContrastJudge !== false && targetTypes.has("judge")) {
    const judgeCards = extractContrastJudgeCards(source, opts, kp, provenance);
    allExtracted.push(...judgeCards);
  }

  // 过滤置信度并统计
  const minConfidence = opts.confidenceThreshold ?? 0.75;
  const validQuestions: Question[] = [];

  // 内存去重（避免单次切片中由于多重规则重复提取相同的 hash 题目）
  const seenHashes = new Set<string>();

  for (const q of allExtracted) {
    if (opts.defaultScore !== undefined && opts.defaultScore > 0) {
      q.score = opts.defaultScore;
    }
    if (seenHashes.has(q.hash)) {
      skipped.push({ reason: "题面指纹重复（单次提取去重）", text: q.stem });
      continue;
    }
    seenHashes.add(q.hash);

    if (typeof q.confidence === "number" && q.confidence < minConfidence) {
      q.review = "pending";
    }
    validQuestions.push(q);
  }

  if (validQuestions.length === 0 && allExtracted.length === 0) {
    skipped.push({ reason: "未检测到符合规范的高亮挖空、概念定义、列表项或辨析句式", text });
  }

  const byType: Record<QuestionType, number> = {
    single: 0,
    multiple: 0,
    judge: 0,
    fill: 0,
    short: 0,
    material: 0,
  };
  for (const q of validQuestions) {
    byType[q.type] = (byType[q.type] || 0) + 1;
  }

  return {
    questions: validQuestions,
    stats: {
      total: validQuestions.length,
      byType,
    },
    skipped,
  };
}

/**
 * 批量从一组阅读笔记（MaterialNote[]）渐进式制卡
 */
export function extractCardsFromMaterialNotes(
  notes: readonly MaterialNote[],
  materialMeta?: { id?: string; title?: string; revision?: number } | ExcerptExtractOptions,
  opts?: ExcerptExtractOptions,
): CardExtractionResult {
  let meta: { id?: string; title?: string; revision?: number } | undefined;
  let finalOpts: ExcerptExtractOptions = {};

  if (materialMeta) {
    if ("id" in materialMeta || "title" in materialMeta || "revision" in materialMeta) {
      meta = materialMeta as { id?: string; title?: string; revision?: number };
      finalOpts = opts || {};
    } else {
      finalOpts = materialMeta as ExcerptExtractOptions;
    }
  } else if (opts) {
    finalOpts = opts;
  }

  const allQuestions: Question[] = [];
  const allSkipped: { reason: string; text: string }[] = [];
  const seenIds = new Set<string>();

  for (const note of notes) {
    // 构造切片源：同时考虑用户笔记内容与引用引文
    const combinedText = note.locator?.quote
      ? `${note.locator.quote}\n${note.text}`
      : note.text;

    const source: ExcerptSource = {
      text: combinedText,
      materialId: note.materialId || meta?.id,
      materialTitle: meta?.title,
      revision: note.revision || meta?.revision,
      noteId: note.id,
      locator: note.locator,
      tags: note.tags,
    };

    const res = extractCardsFromExcerpt(source, finalOpts);
    for (const q of res.questions) {
      if (!seenIds.has(q.id)) {
        seenIds.add(q.id);
        allQuestions.push(q);
      } else {
        allSkipped.push({ reason: `笔记 ${note.id} 提取题目指纹重复`, text: q.stem });
      }
    }
    allSkipped.push(...res.skipped);
  }

  const byType: Record<QuestionType, number> = {
    single: 0,
    multiple: 0,
    judge: 0,
    fill: 0,
    short: 0,
    material: 0,
  };
  for (const q of allQuestions) {
    byType[q.type] = (byType[q.type] || 0) + 1;
  }

  return {
    questions: allQuestions,
    stats: {
      total: allQuestions.length,
      byType,
    },
    skipped: allSkipped,
  };
}

/**
 * 将提取出来的制卡结果导出为格式化 Markdown 文档
 */
export function exportCardsMarkdown(
  input: CardExtractionResult | readonly Question[],
  options?: { title?: string },
): string {
  const questions: readonly Question[] = "questions" in input ? input.questions : input;
  const firstSource = questions.length > 0 && questions[0].source ? questions[0].source : "";
  const docTitle =
    options?.title ||
    (firstSource.startsWith("渐进式笔记制卡")
      ? "渐进式笔记制卡"
      : firstSource
      ? `${firstSource.split(" · ")[0]} 摘抄闪卡集`
      : "渐进式笔记制卡提取卡包");

  const lines: string[] = [];
  lines.push(`# ${docTitle}`);
  lines.push("");
  lines.push(`> 提取时间: ${new Date().toLocaleString()}`);
  lines.push(`> 题目总数: ${questions.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  const typeLabels: Record<QuestionType, string> = {
    fill: "填空题",
    judge: "判断题",
    short: "简答题",
    single: "单选题",
    multiple: "多选题",
    material: "材料分析题",
  };

  const cardKindLabels: Record<QuestionType, string> = {
    fill: "填空卡",
    judge: "判断卡",
    short: "简答卡",
    single: "单选卡",
    multiple: "多选卡",
    material: "材料卡",
  };

  questions.forEach((q, idx) => {
    const label = typeLabels[q.type] || q.type;
    const cardKind = cardKindLabels[q.type] || "闪卡";
    lines.push(`## ${idx + 1}. [${label}] ${q.stem}`);
    lines.push("");
    lines.push(`- **卡片类型**：【${cardKind}】`);
    const kpOrTag = q.kp || "";
    if (kpOrTag) {
      lines.push(`- **考点**：${kpOrTag}`);
    }
    lines.push("");
    if (q.options && q.options.length > 0) {
      lines.push("**选项**：");
      q.options.forEach((opt, oi) => {
        lines.push(`- ${String.fromCharCode(65 + oi)}. ${opt}`);
      });
      lines.push("");
    }
    const answerStr = Array.isArray(q.answer) ? q.answer.join("；") : String(q.answer);
    lines.push(`**答案**：${answerStr}`);
    lines.push("");
    if (q.analysis) {
      lines.push(`**解析与出处**：${q.analysis}`);
      lines.push("");
    }
    const cardTags: string[] = q.tags || (q.kp ? [q.kp] : []);
    if (cardTags.length > 0) {
      lines.push(`**标签**：${cardTags.map((t) => `#${t}`).join(" ")}`);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  });

  return lines.join("\n");
}

/**
 * 将提取出来的制卡结果导出为带 UTF-8 BOM 的 CSV 格式（兼容 Excel/Anki）
 */
export function exportCardsCsv(input: CardExtractionResult | readonly Question[]): string {
  const questions: readonly Question[] = "questions" in input ? input.questions : input;
  const escapeCsv = (str: unknown): string => {
    if (str === null || str === undefined) return '""';
    const s = String(str).replace(/"/g, '""');
    return `"${s}"`;
  };

  const header = ["题型", "题干", "答案", "选项/要点", "解析", "考点", "标签"];
  const rows = [header.map(escapeCsv).join(",")];

  for (const q of questions) {
    const ans = Array.isArray(q.answer) ? q.answer.join("；") : String(q.answer);
    const opts = q.options ? q.options.join(" | ") : "";
    const cardTags = q.tags ? q.tags.join(";") : (q.kp || "");
    const row = [
      q.type,
      q.stem,
      ans,
      opts,
      q.analysis || "",
      q.kp || "",
      cardTags,
    ];
    rows.push(row.map(escapeCsv).join(","));
  }

  // 添加 UTF-8 BOM，防止 Excel 打开中文乱码
  return "\uFEFF" + rows.join("\n");
}
