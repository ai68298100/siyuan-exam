/**
 * 试题 OCR 识别后处理与结构化分拣引擎
 * 职责：
 * 1. 清洗拍照扫描版题目中的常见水印、页眉页脚与干扰字符；
 * 2. 启发式拆分题干、选项列表、答案、解析与考点；
 * 3. 自动归一化文本内的数学公式 LaTeX 表达；
 * 4. 提供面向视觉多模态大模型（Vision LLM）的端到端提题 Prompt 规范。
 */

import type { Question, QuestionType } from "./types";
import { makeQuestion } from "./blockTemplate";
import { normalizeLatexFormula } from "./math";

export interface OcrParseOptions {
  /** 默认题型回退（缺省时根据选项与答案自动推断） */
  fallbackType?: QuestionType;
  /** 默认考点（若 OCR 中未提取到则采用） */
  fallbackKp?: string;
  /** 默认来源出处 */
  fallbackSource?: string;
  /** 是否自动对提取的题干和选项执行 LaTeX 公式清洗规范化（默认 true） */
  normalizeFormulas?: boolean;
}

export interface ParsedOcrQuestion {
  type: QuestionType;
  stem: string;
  options: string[];
  answer: string;
  analysis: string;
  kp?: string;
  difficulty?: number;
  confidence: number; // 0 - 100 结构化置信度评估
  rawCleanedText: string;
}

/** 常见的扫描版试卷页眉页脚/水印噪音正则过滤表 */
const SCAN_NOISE_PATTERNS = [
  /【?\s*绝密\s*★\s*启用前\s*】?/g,
  /【?\s*内部资料\s*严禁外传\s*】?/g,
  /第\s*\d+\s*页\s*[（(]\s*共\s*\d+\s*页\s*[)）]/g,
  /第\s*\d+\s*页/g,
  /【\s*】/g,
  /关注公众号.*?(获取|下载|查看)/g,
  /微信(?:小程序|扫一扫|搜索).*?(?:答案|解析)/g,
  /http[s]?:\/\/[^\s]+/gi,
];

/**
 * 智能解析清洗并结构化 OCR 文本为题目对象
 */
export function parseOcrQuestionText(
  rawText: string,
  options: OcrParseOptions = {},
): ParsedOcrQuestion {
  if (!rawText || !rawText.trim()) {
    return {
      type: options.fallbackType ?? "single",
      stem: "",
      options: [],
      answer: "",
      analysis: "",
      kp: options.fallbackKp,
      confidence: 0,
      rawCleanedText: "",
    };
  }

  const shouldNormalize = options.normalizeFormulas !== false;

  // 1. 去除水印与噪音字符
  let cleaned = rawText.replace(/\r\n/g, "\n");
  for (const pat of SCAN_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pat, "");
  }

  // 2. 逐行提取预处理
  const rawLines = cleaned
    .split("\n")
    .map((l) => l.trim().replace(/^【\s*】/, "").trim())
    .filter((l) => Boolean(l) && !/^[【】()（）\s·.-]+$/.test(l));

  let detectedType: QuestionType | null = null;
  let extractedAnswer = "";
  let extractedAnalysis = "";
  let extractedKp = options.fallbackKp ?? "";
  const optionLines: string[] = [];
  const stemLines: string[] = [];

  // 3. 状态机扫描标记
  let currentSection: "stem" | "options" | "answer" | "analysis" | "kp" = "stem";

  for (const line of rawLines) {
    // 检查显式题型标签：如 【单选题】、【多选题】、【判断题】、【填空题】、【简答题】
    const typeTagMatch = line.match(/【(单选题?|多选题?|不定项|判断题?|填空题?|简答题?|论述题?|主观题?)】/);
    if (typeTagMatch) {
      const tag = typeTagMatch[1];
      if (tag.includes("单选")) detectedType = "single";
      else if (tag.includes("多选") || tag.includes("不定项")) detectedType = "multiple";
      else if (tag.includes("判断")) detectedType = "judge";
      else if (tag.includes("填空")) detectedType = "fill";
      else if (tag.includes("简答") || tag.includes("论述") || tag.includes("主观")) detectedType = "short";
    }

    // 检查答案标签
    const ansMatch = line.match(/(?:【(?:参考)?答案】|^(?:参考)?答案\s*[:：]|^ANSWER\s*[:：])\s*(.*)$/i);
    if (ansMatch) {
      extractedAnswer = ansMatch[1].trim();
      currentSection = "answer";
      continue;
    }

    // 检查解析标签
    const anaMatch = line.match(/(?:【(?:试题)?解析】|^(?:试题)?解析\s*[:：]|【详解】)\s*(.*)$/i);
    if (anaMatch) {
      extractedAnalysis = anaMatch[1].trim();
      currentSection = "analysis";
      continue;
    }

    // 检查考点标签
    const kpMatch = line.match(/(?:【考点】|^(?:考点|知识点)\s*[:：])\s*(.*)$/i);
    if (kpMatch) {
      extractedKp = kpMatch[1].trim();
      currentSection = "kp";
      continue;
    }

    // 检查选项行起始标记：必须为行首 A-J 加点/顿号/括号/空格，或同行多个空格后的选项标记
    const hasOptionPrefix =
      /^(?:[A-J][.、:）\s]|[(（[【][A-J][)）\]】])/.test(line) ||
      /(?:\s{2,}|\t)(?:[A-J][.、:）\s]|[(（[【][A-J][)）\]】])/.test(line);

    if (currentSection === "analysis") {
      extractedAnalysis += (extractedAnalysis ? "\n" : "") + line;
      continue;
    }

    if (currentSection === "kp") {
      extractedKp += (extractedKp ? " / " : "") + line;
      continue;
    }

    if (currentSection === "answer") {
      if (!extractedAnswer) {
        extractedAnswer = line;
      } else {
        // 如果答案之后跟解析
        extractedAnalysis += (extractedAnalysis ? "\n" : "") + line;
        currentSection = "analysis";
      }
      continue;
    }

    if (hasOptionPrefix) {
      currentSection = "options";
      optionLines.push(line);
      continue;
    }

    if (currentSection === "stem") {
      stemLines.push(line);
    } else if (currentSection === "options") {
      // 选项跨行文字追加到上一选项
      if (optionLines.length > 0) {
        optionLines[optionLines.length - 1] += " " + line;
      }
    }
  }

  // 4. 解析选项（处理单行多个选项切分，如 "A. 10   B. 20"）
  const parsedOptions: string[] = [];
  const fullOptionText = optionLines.join("\n");
  if (fullOptionText) {
    // 正则切分 A. ... B. ...
    const OPTION_SPLIT_REGEX = /(?:^|\s{2,}|\s+|\t)(?:([A-J])[.、:）\s]|[(（[【]([A-J])[)）\]】])\s*/g;
    const matches: Array<{ letter: string; index: number; length: number }> = [];

    let m: RegExpExecArray | null;
    while ((m = OPTION_SPLIT_REGEX.exec(fullOptionText)) !== null) {
      const letter = (m[1] || m[2]).toUpperCase();
      matches.push({ letter, index: m.index, length: m[0].length });
    }

    if (matches.length >= 2) {
      for (let i = 0; i < matches.length; i++) {
        const cur = matches[i];
        const next = matches[i + 1];
        const content = next
          ? fullOptionText.slice(cur.index + cur.length, next.index).trim()
          : fullOptionText.slice(cur.index + cur.length).trim();
        parsedOptions.push(shouldNormalize ? normalizeLatexFormula(content) : content);
      }
    } else {
      // 回退简单按行提取
      for (const optLine of optionLines) {
        const stripped = optLine.replace(/^[A-J][.、\s]|^[(（[【][A-J][)）\]】]\s*/i, "").trim();
        parsedOptions.push(shouldNormalize ? normalizeLatexFormula(stripped) : stripped);
      }
    }
  }

  // 5. 组合与清理题干
  let stem = stemLines.join("\n").trim();
  // 去除题目前置题号：如 "1."、"2、"、"第1题："、"12. "、"【单选题】"
  stem = stem.replace(/^(?:【[^】]+】\s*)?(?:第?\s*\d+\s*[题.、:：]\s*)/, "").trim();
  if (shouldNormalize) {
    stem = normalizeLatexFormula(stem);
  }

  // 6. 启发式判定题型与答案规范
  if (!detectedType) {
    if (parsedOptions.length >= 2) {
      // 检查答案中是否包含多项（如 "AB" / "ACD" / "A, C"）
      const letters = extractedAnswer.replace(/[^A-Ja-j]/g, "");
      if (letters.length > 1) {
        detectedType = "multiple";
      } else {
        detectedType = "single";
      }
    } else if (/正确|错误|对|错|√|×|T|F/i.test(extractedAnswer) || /^(正确|错误|对|错)$/.test(stem)) {
      detectedType = "judge";
    } else if (stem.includes("____") || stem.includes("(   )") || stem.includes("（   ）")) {
      detectedType = "fill";
    } else {
      detectedType = options.fallbackType ?? (parsedOptions.length > 0 ? "single" : "short");
    }
  }

  // 规范化答案文本
  let answer = extractedAnswer.trim();
  if (detectedType === "single" || detectedType === "multiple") {
    // 提取纯字母
    const letters = answer.match(/[A-J]/gi);
    if (letters) {
      answer = letters.map((l) => l.toUpperCase()).join(detectedType === "multiple" ? "" : "");
    }
  } else if (detectedType === "judge") {
    if (/^[Tt]|对|正确|√/.test(answer)) answer = "对";
    else if (/^[Ff]|错|错误|×/.test(answer)) answer = "错";
  }

  // 7. 计算结构置信度评分
  let confidence = 50;
  if (stem) confidence += 20;
  if (parsedOptions.length >= 2) confidence += 15;
  if (answer) confidence += 15;

  return {
    type: detectedType,
    stem,
    options: parsedOptions,
    answer,
    analysis: shouldNormalize ? normalizeLatexFormula(extractedAnalysis) : extractedAnalysis,
    kp: extractedKp || options.fallbackKp,
    confidence: Math.min(100, confidence),
    rawCleanedText: cleaned,
  };
}

/**
 * 将解析出的题目元数据转换为标准的 Question 数据实体
 */
export function ocrResultToQuestion(
  parsed: ParsedOcrQuestion,
  defaults: { id?: string; source?: string } = {},
): Question {
  const q = makeQuestion({
    type: parsed.type,
    stem: parsed.stem || "【识别题目】未提取到题干内容",
    options: parsed.options,
    answer: parsed.answer,
    analysis: parsed.analysis || undefined,
    kp: parsed.kp || undefined,
    source: defaults.source ?? "OCR图片导入",
    difficulty: parsed.difficulty ?? (parsed.type === "multiple" ? 4 : parsed.type === "short" ? 4 : 3),
  });
  q.id = defaults.id ?? `ocr-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000).toString(36)}`;
  return q;
}

/**
 * 面向视觉多模态大模型（Vision LLM）的端到端试题提取 Prompt 构造器
 */
export function buildVisionOcrPrompt(): string {
  return `你是一个专业的中高考、考研与执业资格考试试题数字化专家。
请仔细识别附图中的试题，要求：
1. 精确识别全部文字与数学/物理/化学公式，公式一律使用标准的 LaTeX 语法（行内公式用 $...$，块级公式用 $$...$$）；
2. 严禁丢失选项字母（A、B、C、D）和图表说明；
3. 输出纯 JSON 格式对象，不要输出任何多余的前言或 Markdown 标签，字段定义如下：
{
  "type": "single" | "multiple" | "judge" | "fill" | "short",
  "stem": "题干内容（公式包裹在 $...$ 中）",
  "options": ["选项A内容", "选项B内容", "选项C内容", "选项D内容"],
  "answer": "正确答案（如 A、ABCD、对/错 或填空标准答案）",
  "analysis": "详细解答与解题步骤解析",
  "kp": "涉及的核心考点/知识点"
}`;
}
