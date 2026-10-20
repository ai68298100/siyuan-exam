// ============================================================
// 主观题机考方格答题纸与字数实时测算引擎（54-06 / 55-05）
// 纯函数领域层：
// 1. 规范化考试字数核算：汉字、标点、英文单词、数字串精确切分与统揽
// 2. 25×N 机考标准方格答题纸网格模型生成（支持段落换行、每行字数标尺）
// 3. 字数范围达标状态机：字数不足(too_few)/合格(fit)/临界预警(warning)/超限(exceeded)
// 4. 里程碑标尺标记（100/200/300/500/800/1000 字线）
// 规则：严格无外部宿主依赖（禁 import "siyuan"），严禁类型强转。
// ============================================================

export interface WordCountMetrics {
  /** 汉字数量（CJK 字符） */
  chineseChars: number;
  /** 标点符号数量（全角及半角标点） */
  punctuations: number;
  /** 英文单词数量（连续字母串） */
  englishWords: number;
  /** 数字串数量（连续阿拉伯数字） */
  numberWords: number;
  /** 空白与换行符数量 */
  whitespaceCount: number;
  /** 自然段落数量 */
  paragraphs: number;
  /** 原始文本总字符数 */
  totalChars: number;
  /**
   * 官方考试标准字数：
   * 汉字数 + 标点符号数 + 英文单词数 + 连续数字串数（满足中国申论与主观机考计字标准）
   */
  examWords: number;
}

export type WordLimitState = "no_limit" | "too_few" | "fit" | "warning" | "exceeded";

export interface WordLimitStatus {
  state: WordLimitState;
  currentWords: number;
  minWords?: number;
  maxWords?: number;
  difference: number; // 距目标下限还差几字，或超出上限几字
  progressPct: number; // 0-100+
  label: string;
  tone: "neutral" | "danger" | "success" | "warning";
}

export interface GridCell {
  /** 格内字符（空为 ""） */
  char: string;
  /** 在整张答题纸中的有效字数序号（从 1 开始，空格/回车不占序号） */
  wordIndex: number | null;
  /** 在整张方格纸中的绝对格子序号（从 1 开始，含排版空格） */
  cellIndex: number;
  /** 是否为段落起始缩进占位格 */
  isIndent: boolean;
  /** 是否达到百字或重要里程碑（如 100/200/500/800/1000 字） */
  isMilestone: boolean;
  /** 里程碑标记文字（如 "100字"） */
  milestoneLabel?: string;
  /** 是否超过了上限字数警戒线 */
  isExceeded: boolean;
}

export interface GridRow {
  rowNumber: number; // 从 1 开始
  cells: GridCell[];
  /** 截至该行末累计占用的有效字数 */
  cumulativeWords: number;
  /** 该行最后一个里程碑标注（若有） */
  milestoneTag?: string;
}

export interface PaperGridModel {
  columns: number;
  totalRows: number;
  rows: GridRow[];
  totalWords: number;
  totalCellsOccupied: number;
  metrics: WordCountMetrics;
  limitStatus: WordLimitStatus;
}

export interface WordLimitOptions {
  minWords?: number;
  maxWords?: number;
  /** 临界预警阈值比例（默认 0.90，达到 90% 上限即提示黄色预警） */
  warningRatio?: number;
}

export interface GridOptions extends WordLimitOptions {
  /** 每行格子列数（默认 25 列，中国国考/省考申论标准答题纸规格） */
  columns?: number;
  /** 保底显示行数（默认 10 行） */
  minRows?: number;
}

const CJK_REGEX = /[\u4e00-\u9fa5\u3400-\u4dbf]/g;
const PUNCTUATION_REGEX = /[，。！？、；：“”‘’（）《》【】—…·～.,!?:;'"()[\]<>_~-]/g;
const ENGLISH_WORD_REGEX = /[a-zA-Z]+(?:'[a-zA-Z]+)?/g;
const NUMBER_WORD_REGEX = /\d+(?:\.\d+)?%?/g;

const STANDARD_MILESTONES = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1500, 2000];

/**
 * 精准核算主观题文本的各项文字与考试字数指标。
 * 纯函数无 IO。
 */
export function countWordsAndCharacters(text: string): WordCountMetrics {
  if (!text) {
    return {
      chineseChars: 0,
      punctuations: 0,
      englishWords: 0,
      numberWords: 0,
      whitespaceCount: 0,
      paragraphs: 0,
      totalChars: 0,
      examWords: 0,
    };
  }

  const chineseMatches = text.match(CJK_REGEX) || [];
  const punctuationMatches = text.match(PUNCTUATION_REGEX) || [];
  const englishMatches = text.match(ENGLISH_WORD_REGEX) || [];
  const numberMatches = text.match(NUMBER_WORD_REGEX) || [];

  const chineseChars = chineseMatches.length;
  const punctuations = punctuationMatches.length;
  const englishWords = englishMatches.length;
  const numberWords = numberMatches.length;

  const totalChars = text.length;
  const whitespaceMatches = text.match(/\s/g) || [];
  const whitespaceCount = whitespaceMatches.length;

  // 统计非空自然段数
  const paragraphs = text
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean).length;

  // 官方申论与执业考试标准字数计算
  const examWords = chineseChars + punctuations + englishWords + numberWords;

  return {
    chineseChars,
    punctuations,
    englishWords,
    numberWords,
    whitespaceCount,
    paragraphs,
    totalChars,
    examWords,
  };
}

/**
 * 计算字数限制达标状态机。
 */
export function evaluateWordCountStatus(
  currentWords: number,
  options: WordLimitOptions = {},
): WordLimitStatus {
  const { minWords, maxWords, warningRatio = 0.9 } = options;

  if (minWords === undefined && maxWords === undefined) {
    return {
      state: "no_limit",
      currentWords,
      difference: 0,
      progressPct: 100,
      label: `共 ${currentWords} 字`,
      tone: "neutral",
    };
  }

  // 仅设上限
  if (minWords === undefined && maxWords !== undefined) {
    const progress = Math.round((currentWords / maxWords) * 100);
    if (currentWords > maxWords) {
      const diff = currentWords - maxWords;
      return {
        state: "exceeded",
        currentWords,
        maxWords,
        difference: diff,
        progressPct: progress,
        label: `超限 ${diff} 字（上限 ${maxWords} 字，有扣分风险）`,
        tone: "danger",
      };
    }
    if (currentWords >= maxWords * warningRatio) {
      const remain = maxWords - currentWords;
      return {
        state: "warning",
        currentWords,
        maxWords,
        difference: remain,
        progressPct: progress,
        label: `接近上限（已写 ${currentWords}/${maxWords} 字，还剩 ${remain} 字）`,
        tone: "warning",
      };
    }
    return {
      state: "fit",
      currentWords,
      maxWords,
      difference: maxWords - currentWords,
      progressPct: progress,
      label: `字数符合要求（${currentWords}/${maxWords} 字）`,
      tone: "success",
    };
  }

  // 仅设下限
  if (minWords !== undefined && maxWords === undefined) {
    const progress = Math.min(100, Math.round((currentWords / minWords) * 100));
    if (currentWords < minWords) {
      const diff = minWords - currentWords;
      return {
        state: "too_few",
        currentWords,
        minWords,
        difference: diff,
        progressPct: progress,
        label: `字数不足（还需 ${diff} 字达标，要求不少于 ${minWords} 字）`,
        tone: "danger",
      };
    }
    return {
      state: "fit",
      currentWords,
      minWords,
      difference: currentWords - minWords,
      progressPct: 100,
      label: `字数已达标（${currentWords} 字，要求 ≥ ${minWords} 字）`,
      tone: "success",
    };
  }

  // 同时设置了上限与下限（如 800 - 1000 字）
  const min = minWords!;
  const max = maxWords!;
  const progress = Math.round((currentWords / max) * 100);

  if (currentWords < min) {
    const diff = min - currentWords;
    return {
      state: "too_few",
      currentWords,
      minWords: min,
      maxWords: max,
      difference: diff,
      progressPct: progress,
      label: `字数不足（还差 ${diff} 字达到最低要求 ${min} 字）`,
      tone: "danger",
    };
  }

  if (currentWords > max) {
    const diff = currentWords - max;
    return {
      state: "exceeded",
      currentWords,
      minWords: min,
      maxWords: max,
      difference: diff,
      progressPct: progress,
      label: `已超限 ${diff} 字（允许范围 ${min}–${max} 字）`,
      tone: "danger",
    };
  }

  if (currentWords >= max * warningRatio) {
    const remain = max - currentWords;
    return {
      state: "warning",
      currentWords,
      minWords: min,
      maxWords: max,
      difference: remain,
      progressPct: progress,
      label: `接近上限（已写 ${currentWords}/${max} 字，临界区间）`,
      tone: "warning",
    };
  }

  return {
    state: "fit",
    currentWords,
    minWords: min,
    maxWords: max,
    difference: 0,
    progressPct: progress,
    label: `字数适中（${currentWords} 字，要求 ${min}–${max} 字）`,
    tone: "success",
  };
}

/**
 * 生成 25×N 机考标准答题方格纸模型。
 * 遵循申论考场规则：自然段首空两格，每行固定 25 格，换行另起一行，带百字标尺。
 */
export function generatePaperGrid(
  text: string,
  options: GridOptions = {},
): PaperGridModel {
  const columns = options.columns && options.columns > 0 ? options.columns : 25;
  const minRows = options.minRows && options.minRows > 0 ? options.minRows : 10;
  const maxWords = options.maxWords;

  const metrics = countWordsAndCharacters(text);
  const limitStatus = evaluateWordCountStatus(metrics.examWords, options);

  const rawParagraphs = (text || "").split(/\r?\n/);
  const rows: GridRow[] = [];

  let currentCells: GridCell[] = [];
  let absoluteCellIndex = 1;
  let runningWordIndex = 0;
  let rowNumber = 1;

  const pushCurrentRow = () => {
    // 补齐该行剩余空格子以维持整行 columns 格
    while (currentCells.length < columns) {
      currentCells.push({
        char: "",
        wordIndex: null,
        cellIndex: absoluteCellIndex++,
        isIndent: false,
        isMilestone: false,
        isExceeded: maxWords !== undefined && runningWordIndex > maxWords,
      });
    }

    let milestoneTag: string | undefined;
    const milestoneCell = currentCells.find((c) => c.isMilestone && c.milestoneLabel);
    if (milestoneCell) {
      milestoneTag = milestoneCell.milestoneLabel;
    }

    rows.push({
      rowNumber: rowNumber++,
      cells: currentCells,
      cumulativeWords: runningWordIndex,
      milestoneTag,
    });
    currentCells = [];
  };

  for (let pi = 0; pi < rawParagraphs.length; pi++) {
    const para = rawParagraphs[pi];
    // 空行单独产生一行空行占位（但至少要有首行）
    if (!para && pi > 0 && pi === rawParagraphs.length - 1 && text.endsWith("\n")) {
      break;
    }

    // 每段若非空且没有手动缩进，可按国考规范在段首插入 2 格缩进占位
    // 检查开头是否已有空格或全角空格
    const charList = [...para];
    let indentCount = 0;
    while (charList.length > 0 && (charList[0] === " " || charList[0] === "\u3000")) {
      charList.shift();
      indentCount++;
    }

    // 默认空两格（如果段落有文本且没手动缩进）
    const effectiveIndent = indentCount > 0 ? indentCount : (charList.length > 0 ? 2 : 0);

    for (let ind = 0; ind < effectiveIndent; ind++) {
      currentCells.push({
        char: "",
        wordIndex: null,
        cellIndex: absoluteCellIndex++,
        isIndent: true,
        isMilestone: false,
        isExceeded: false,
      });
      if (currentCells.length === columns) {
        pushCurrentRow();
      }
    }

    // 逐字填充入格子
    for (const ch of charList) {
      // 遇到普通空格
      if (ch === " " || ch === "\u3000") {
        currentCells.push({
          char: "",
          wordIndex: null,
          cellIndex: absoluteCellIndex++,
          isIndent: false,
          isMilestone: false,
          isExceeded: maxWords !== undefined && runningWordIndex > maxWords,
        });
      } else {
        runningWordIndex++;
        const isMilestone = STANDARD_MILESTONES.includes(runningWordIndex);
        const milestoneLabel = isMilestone ? `${runningWordIndex}字` : undefined;
        const isExceeded = maxWords !== undefined && runningWordIndex > maxWords;

        currentCells.push({
          char: ch,
          wordIndex: runningWordIndex,
          cellIndex: absoluteCellIndex++,
          isIndent: false,
          isMilestone,
          milestoneLabel,
          isExceeded,
        });
      }

      if (currentCells.length === columns) {
        pushCurrentRow();
      }
    }

    // 自然段结束，当前行截断换行
    if (currentCells.length > 0) {
      pushCurrentRow();
    }
  }

  // 补充空白行直到达到 minRows
  while (rows.length < minRows) {
    pushCurrentRow();
  }

  return {
    columns,
    totalRows: rows.length,
    rows,
    totalWords: runningWordIndex,
    totalCellsOccupied: absoluteCellIndex - 1,
    metrics,
    limitStatus,
  };
}
