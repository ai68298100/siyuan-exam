// ============================================================
// 讲解模板（v0.4.x）：解释 / Hint（旧版保留，UI 已走 ai/hint 一次一层）/ 苏格拉底
// - T07（114-04）：提交后依据讲解分层——答案核验 / 关键步骤 / 下次检查点；
//   参考解析与模型补充分别标注，解析缺失列缺证据不编造，争议答案不背书。
// - T06（114-03）：苏格拉底一次只问一个问题，已问范围见对话史不复述。
// ============================================================
import type { Question } from "../core/types";
import type { AiMessage } from "./client";

export type ExplainMode = "explain" | "hint" | "socratic";

/** 苏格拉底追问：在既有对话史上追加用户消息（多轮保持；已问范围随史可见，模型不复述） */
export function continueExplainMessages(history: AiMessage[], followUp: string): AiMessage[] {
  return [...history, { role: "user", content: followUp }];
}

export function buildExplainMessages(q: Question, myAnswer: string | null, mode: ExplainMode): AiMessage[] {
  const fact = [
    `题干：${q.stem}`,
    ...q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`),
    `正确答案：${q.answer}`,
    `我的答案：${myAnswer ?? "（未作答）"}`,
    q.analysis ? `参考解析：${q.analysis}` : "参考解析：（缺证据——如实标注，不编造）",
  ]
    .filter(Boolean)
    .join("\n");

  const systemBase = "你是耐心的考试辅导老师，中文、简洁、直指误区。";
  if (mode === "explain") {
    // 114-04 T07：分层依据讲解（提交后）
    return [
      {
        role: "system",
        content:
          systemBase +
          "用户已提交作答。输出严格三段——" +
          "【答案核验】逐选项一行：『字母. 对/错 —— 一句话因果』；判定须与参考解析一致，解析缺失处写「解析缺证据」；" +
          "【关键步骤】1-3 步正确推理路径；解析原文与你的补充分别标注『解析』『补充』，不混写；" +
          "【下次检查点】一句话：下次遇到同考点先自查什么。" +
          "红线：争议答案不背书（解析可疑时如实指出）；「看懂讲解」不等于已掌握，不使用掌握性断言。",
      },
      { role: "user", content: fact },
    ];
  }
  if (mode === "hint") {
    // 旧版三连提示模板（UI 已改走 ai/hint 一次一层 buildHintMessages；此模板保留兼容）
    return [
      {
        role: "system",
        content:
          systemBase +
          "输出三条递进提示（绝不给出答案、不得复述正确选项）：提示① 题型与考点一句话；提示② 解题关键概念；提示③ 排除法路径（不点正确项名）。每行格式『提示N：…』。",
      },
      { role: "user", content: fact },
    ];
  }
  // 114-03 T06：苏格拉底一次一个问题
  return [
    {
      role: "system",
      content:
        systemBase +
        "苏格拉底模式：一次只向我提出一个问题（绝不一次给多个问题）。" +
        "问题针对我当前思路最薄弱的一环，从我的答案出发暴露矛盾；不陈述正确答案、不评价对错。" +
        "已问过的问题以对话史为准，不要重复或换皮重问；我卡住时给出选择：换个角度 / 给一层提示 / 直接看讲解。" +
        "只输出这一个问题本身，不加前言后语。",
    },
    { role: "user", content: fact },
  ];
}
