// ============================================================
// 讲解三模式（v0.4.x）：解释 / Hint 递进 / 苏格拉底——纯提示词构造
// ============================================================
import type { Question } from "../core/types";
import type { AiMessage } from "./client";

export type ExplainMode = "explain" | "hint" | "socratic";

/** 苏格拉底追问：在既有对话史上追加用户消息（多轮保持） */
export function continueExplainMessages(history: AiMessage[], followUp: string): AiMessage[] {
  return [...history, { role: "user", content: followUp }];
}

export function buildExplainMessages(q: Question, myAnswer: string | null, mode: ExplainMode): AiMessage[] {
  const fact = [
    `题干：${q.stem}`,
    ...q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`),
    `正确答案：${q.answer}`,
    `我的答案：${myAnswer ?? "（未作答）"}`,
    q.analysis ? `参考解析：${q.analysis}` : "",
  ].filter(Boolean).join("\n");

  const systemBase = "你是耐心的考试辅导老师，中文、简洁、直指误区。";
  if (mode === "explain") {
    return [
      { role: "system", content: systemBase + "逐选项解释：每个选项一行，格式『字母. 对/错 —— 一句话因果』；最后一段针对我的错因给一句建议。只输出解释本身。" },
      { role: "user", content: fact },
    ];
  }
  if (mode === "hint") {
    return [
      { role: "system", content: systemBase + "输出三条递进提示（绝不给出答案、不得复述正确选项）：提示① 题型与考点一句话；提示② 解题关键概念；提示③ 排除法路径（不点正确项名）。每行格式『提示N：…』。" },
      { role: "user", content: fact },
    ];
  }
  return [
    { role: "system", content: systemBase + "苏格拉底模式：只向我提出 2-3 个引导性问题（从我的答案出发暴露矛盾），不陈述正确答案、不评价对错。每行一个问题。" },
    { role: "user", content: fact },
  ];
}
