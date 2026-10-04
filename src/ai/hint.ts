// ============================================================
// 一次一层提示（TODO 114-01，docs/18 T05）：
// 按用户申请逐层给 目标(考点) → 概念 → 局部步骤，一次只给一层；
// 记录已展示内容供后续层去重；泄露守卫做确定性结果检查；
// 判断题等 ≤2 选项题型在第 2 层后结构性必然锁定答案 → 转正式揭示（G6）。
// 纯函数无 IO，便于 headless 单测与 119-02 泄露回归扩样。
// ============================================================
import type { Question } from "../core/types";
import type { AiMessage } from "./client";

export type HintLevel = 1 | 2 | 3;
export type ShownLevel = 0 | HintLevel;

/** 层级语义（写入提示词，模型与 UI 共用同一口径） */
export const HINT_LEVEL_LABEL: Record<HintLevel, string> = {
  1: "目标层：这道题在考什么（题型与考点，一句话）",
  2: "概念层：解题需要的关键概念或公式（不代入本题数值）",
  3: "步骤层：局部解题路径（不点正确项名，不报答案字母/最终数值）",
};

export type NextHintStep = { kind: "hint"; level: HintLevel } | { kind: "reveal" };

/**
 * 下一层推进：0→1→2→3；已到第 3 层、或 ≤2 选项题型（判断/二选一）到第 2 层——
 * 再往下必然暴露答案 → 返回正式揭示（G6：由用户提交作答查看判定，不冒充提示）。
 */
export function nextHintStep(shown: ShownLevel, optionCount: number): NextHintStep {
  if (shown === 0) return { kind: "hint", level: 1 };
  if (shown === 1) return { kind: "hint", level: 2 };
  if (shown === 2 && optionCount <= 2) return { kind: "reveal" };
  if (shown === 2) return { kind: "hint", level: 3 };
  return { kind: "reveal" };
}

/**
 * 构造单层提示消息：system 限定只给第 N 层 + 泄露红线；
 * user 附题面、我的作答与已展示层原文（模型不复述已给过的层）。
 */
export function buildHintMessages(
  q: Question,
  myAnswer: string | null,
  level: HintLevel,
  shownTexts: string[] = [],
): AiMessage[] {
  const fact = [
    `题型：${q.type}`,
    `题干：${q.stem}`,
    ...q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`),
    myAnswer ? `我的作答：${myAnswer}` : "我的作答：（未提交）",
    shownTexts.length ? `已展示过的提示（勿重复）：\n${shownTexts.map((s, i) => `- 提示${i + 1}：${s}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const redline =
    "绝对红线：不得出现正确答案字母（如『答案是B』『选C』）、不得出现正确选项原文、"
    + "简答/填空不得出现答案原文或最终数值、不得把选项排除到只剩一个。"
    + "违反任何一条都算泄题。";
  return [
    {
      role: "system",
      content:
        `你是耐心的考试辅导老师，中文、简洁。用户主动申请第 ${level} 层提示，本次只给第 ${level} 层：${HINT_LEVEL_LABEL[level]}。`
        + redline
        + "只输出这一层提示本身（一两句话，格式『提示：" + "…』），不要给其他层，不要评价用户。",
    },
    { role: "user", content: fact },
  ];
}

// ---------- 泄露守卫（确定性结果检查；保守判定，命中才拦） ----------

export interface HintLeak {
  kind: "answer-letter" | "option-text" | "answer-text" | "eliminate-unique";
  detail: string;
}

/**
 * 检查提示文本是否泄露答案：
 * - 答案字母披露：『答案：B』『选 C』『正确答案是 A』；
 * - 正确选项原文出现（选项 ≥6 字才判定，过短易误伤）；
 * - 简答/填空答案原文出现（≥4 字）；
 * - 排除至唯一：『排除』句内字母数 ≥ 选项数-1。
 */
export function findHintLeaks(hintText: string, q: Question): HintLeak[] {
  const leaks: HintLeak[] = [];
  const text = hintText.replace(/\s+/g, " ");

  // 1) 答案字母披露（choice/judge）：『答案[:：是]? B』『选[:：]? C』
  if (q.options.length > 0) {
    const letters = validLetters(q.options.length);
    const letterRe = new RegExp(`(?:正确答案|答案|应选|选|choose|answer)\\s*[:：是]?\\s*([${letters}])\\b`, "i");
    const m = text.match(letterRe);
    if (m) leaks.push({ kind: "answer-letter", detail: `提示出现答案字母「${m[1]}」` });
  }

  // 2) 正确选项原文（≥6 字按包含判定；忽略字母前缀本身）
  const correct = answerIndices(q);
  for (const i of correct) {
    const opt = (q.options[i] ?? "").trim();
    if (opt.length >= 6 && text.includes(opt)) {
      leaks.push({ kind: "option-text", detail: "提示包含正确选项原文" });
      break;
    }
  }

  // 3) 简答/填空答案原文（≥4 字按包含判定；别名同样计入）
  if (q.options.length === 0) {
    const candidates = [q.answer, ...(q.alt ?? [])].map((a) => a.trim()).filter((a) => a.length >= 4);
    if (candidates.some((a) => text.includes(a))) {
      leaks.push({ kind: "answer-text", detail: "提示包含答案原文" });
    }
  }

  // 4) 排除至唯一：单个『排除/排除法』片段内出现的不同选项字母 ≥ 选项数-1
  if (q.options.length >= 3) {
    const letters = validLetters(q.options.length);
    const clauseRe = new RegExp(`排除[^。\\n]{0,30}`, "g");
    for (const clause of text.match(clauseRe) ?? []) {
      const found = new Set(clause.match(new RegExp(`[${letters}]`, "g")) ?? []);
      if (found.size >= q.options.length - 1) {
        leaks.push({ kind: "eliminate-unique", detail: `提示排除 ${found.size} 项，唯一剩余即答案` });
        break;
      }
    }
  }
  return leaks;
}

/** 选项数对应的合法字母集（≤26） */
function validLetters(optionCount: number): string {
  const n = Math.min(Math.max(optionCount, 2), 26);
  return Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i)).join("");
}

/** 正确答案对应的选项下标（规范答案字母串；无法解析时返回空） */
function answerIndices(q: Question): number[] {
  return [...q.answer.toUpperCase()]
    .map((ch) => ch.charCodeAt(0) - 65)
    .filter((i) => i >= 0 && i < q.options.length);
}
