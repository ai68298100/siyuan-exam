// ============================================================
// 选项干扰项误概念对照与认知诊断纯函数引擎（52-05 / 43-02）
// 纯函数领域层：
// 1. 选项级混淆概念（Misconceptions）与题目易错陷阱结构化建模
// 2. 重复错误（≥2 次命中同一干扰项）智能识别与可否认对照建议生成
// 3. 题目修订漂移与陈旧态检查（题面变更时提示重新核对）
// 4. 诚实边界约束：明确声明“单次选错不自动推断认知缺陷”，杜绝标签化
// 规则：严格无外部宿主依赖（禁 import "siyuan"），严禁类型强转。
// ============================================================

import type { AttemptEvent, Question } from "./types";

export interface OptionMisconception {
  /** 选项字母（大写，如 "A"、"B"） */
  letter: string;
  /** 混淆概念或定理（如 "现期比重 vs 基期比重"） */
  concept: string;
  /** 易错陷阱或诱导点说明 */
  trapDescription: string;
  /** 辨析要点或避坑准则 */
  counterRule?: string;
}

export interface MisconceptionItem {
  letter: string;
  misconception: OptionMisconception;
  /** 学习者历史选择该选项的次数 */
  pickCount: number;
  /** 最近一次选择该干扰项的时间戳 */
  lastPickedAt: number;
  /** 是否达到重复错误门槛（≥2 次） */
  isRepeatedError: boolean;
  /** 辨析指导与对照说明 */
  advisoryText: string;
}

export interface MisconceptionDiagnosisResult {
  qid: string;
  hasDiagnosis: boolean;
  repeatedErrorFound: boolean;
  totalWrongAttempts: number;
  items: MisconceptionItem[];
  /** 题面是否已发生修订（漂移陈旧态） */
  isStale: boolean;
  /** 免责与诚实边界说明 */
  boundaryDisclaimer: string;
}

const DEFAULT_REPEAT_THRESHOLD = 2;

/**
 * 诊断学习者在单道题目上的选项级混淆概念与重复易错陷阱。
 * 纯函数无 IO。
 */
export function diagnoseMisconceptions(options: {
  question: Question;
  events: readonly AttemptEvent[];
  misconceptions: readonly OptionMisconception[];
  minRepeatCount?: number;
  currentQuestionHash?: string;
}): MisconceptionDiagnosisResult {
  const { question, events, misconceptions } = options;
  const minRepeat = Math.max(1, options.minRepeatCount ?? DEFAULT_REPEAT_THRESHOLD);

  // 1. 筛选本题的答错事件
  const qWrongEvents = events.filter(
    (e) => e.qid === question.id && e.verdict === "wrong" && e.myAnswer,
  );
  const totalWrongAttempts = qWrongEvents.length;

  // 统计每个选项的选择频次及最新时间
  const pickCounts = new Map<string, { count: number; lastAt: number }>();
  for (const e of qWrongEvents) {
    const rawAnswer = (e.myAnswer ?? "").trim().toUpperCase();
    if (!rawAnswer) continue;
    // 选择题支持单选与多选中的每个字母
    for (const char of rawAnswer) {
      if (/^[A-J]$/.test(char)) {
        const cur = pickCounts.get(char) ?? { count: 0, lastAt: 0 };
        cur.count++;
        cur.lastAt = Math.max(cur.lastAt, e.ts);
        pickCounts.set(char, cur);
      }
    }
  }

  // 2. 匹配预设的选项误概念字典
  const items: MisconceptionItem[] = [];
  let repeatedErrorFound = false;

  for (const misc of misconceptions) {
    const letter = misc.letter.trim().toUpperCase();
    const stat = pickCounts.get(letter);
    const count = stat?.count ?? 0;
    const lastPickedAt = stat?.lastAt ?? 0;
    const isRepeated = count >= minRepeat;

    if (count > 0) {
      if (isRepeated) repeatedErrorFound = true;

      let advisoryText: string;
      if (isRepeated) {
        advisoryText = `⚠️ 检测到重复选择选项 ${letter}（共 ${count} 次）。易错陷阱：${misc.trapDescription}；涉及混淆概念：【${misc.concept}】。`;
        if (misc.counterRule) {
          advisoryText += ` 💡 辨析准则：${misc.counterRule}`;
        }
      } else {
        advisoryText = `曾选选项 ${letter}（1次）。易错提示：${misc.trapDescription}（概念：${misc.concept}）。`;
      }

      items.push({
        letter,
        misconception: misc,
        pickCount: count,
        lastPickedAt,
        isRepeatedError: isRepeated,
        advisoryText,
      });
    }
  }

  // 按选择次数降序
  items.sort((a, b) => b.pickCount - a.pickCount);

  // 3. 检查题面版本是否发生漂移
  const isStale = Boolean(
    options.currentQuestionHash &&
    question.hash &&
    options.currentQuestionHash !== question.hash,
  );

  const boundaryDisclaimer =
    "根据 52-05 诚实边界规范：单次选错仅作启发式提示，不作为确定性认知问题诊断；当且仅当多次重复选错同一干扰项时提供可否认的对照建议。";

  return {
    qid: question.id,
    hasDiagnosis: items.length > 0,
    repeatedErrorFound,
    totalWrongAttempts,
    items,
    isStale,
    boundaryDisclaimer,
  };
}

/** 格式化导出干扰项误概念对照卡片 Markdown */
export function exportMisconceptionMarkdown(res: MisconceptionDiagnosisResult): string {
  if (!res.hasDiagnosis) return "";

  const lines: string[] = [];
  lines.push(`> 🧠 **【干扰项易错概念与认知对照】**`);
  if (res.isStale) {
    lines.push(`> ⚠️ *提示：题目内容已发生修订，对照建议基于历史题面生成，仅供参考。*`);
  }

  for (const item of res.items) {
    const repeatTag = item.isRepeatedError ? "🔥 **【高频重复错因】**" : "🔍 【单次选错提示】";
    lines.push(`> - ${repeatTag} **选项 ${item.letter}**（已选 ${item.pickCount} 次）`);
    lines.push(`>   - 混淆概念：\`${item.misconception.concept}\``);
    lines.push(`>   - 诱导陷阱：${item.misconception.trapDescription}`);
    if (item.misconception.counterRule) {
      lines.push(`>   - 辨析准则：👉 *${item.misconception.counterRule}*`);
    }
  }

  lines.push(`> ℹ️ *${res.boundaryDisclaimer}*`);
  return lines.join("\n");
}
