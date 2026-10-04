// ============================================================
// AI 错因假设（TODO 116-01，docs/18 T08）：事实 → 错因假设 → 验证行动。
// 纯提示词构造 + 输入整形，无 IO：
// - 只用给定证据（作答/用时/置信/受助标记/用户自述思路），不足处列「缺证据」不猜；
// - 仅答案不一致不能断言粗心/不会（验收红线写入 system）；
// - 用户标签与 AI 假设独立——AI 输出是假设，采纳由用户确认（不直接改复盘）。
// ============================================================
import type { Question } from "../core/types";
import type { AiMessage } from "./client";

/** 错因分析证据（116-01：作答证据 + 暴露条件 + 用户思路；缺的字段如实标「缺证据」） */
export interface MisdiagnosisEvidence {
  myAnswer: string | null; // 本次作答（null=未作答/跳过）
  confidence?: "sure" | "fuzzy" | "guess"; // 答前自评（U12）
  timeMs?: number; // 本次用时（真实驻留）
  helped?: boolean; // 受助作答（讲解/提示后再答）
  userThought?: string; // 用户复盘原文（自己的话，可选）
}

/** 证据 → 人读事实行（供提示词与测试；缺的字段显式列「缺证据」不猜） */
export function evidenceFacts(q: Question, ev: MisdiagnosisEvidence): string[] {
  const facts: string[] = [
    `题型：${q.type}`,
    `题干：${q.stem}`,
    ...q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`),
    `正确答案：${q.answer}`,
    `我的作答：${ev.myAnswer ?? "（未作答）"}`,
    `解析：${q.analysis?.trim() || "（无参考解析——列缺证据，不编造）"}`,
  ];
  facts.push(
    ev.confidence ? `答前信心：${{ sure: "确定", fuzzy: "模糊", guess: "蒙" }[ev.confidence]}` : "答前信心：缺证据",
  );
  facts.push(
    ev.timeMs != null && ev.timeMs > 0 ? `用时：${Math.round(ev.timeMs / 1000)} 秒` : "用时：缺证据",
  );
  facts.push(ev.helped ? "受助作答：是（讲解/提示后再答）" : "受助作答：否/缺证据");
  facts.push(`用户自述思路：${ev.userThought?.trim() || "缺证据（用户未写复盘）"}`);
  return facts;
}

/** T08 消息构造：三段式输出（事实/假设/验证行动），红线入 system */
export function buildMisdiagnosisMessages(q: Question, ev: MisdiagnosisEvidence): AiMessage[] {
  const system = [
    "你是耐心的考试辅导老师，中文、简洁。任务：基于给定证据做错因分析，输出严格三段——",
    "【事实】只复述给定证据，不添加推断；",
    "【错因假设】1-2 条假设，每条列支持证据与不支持/缺失证据，并提一个向用户澄清的问题（缺证据处写「缺证据」，不编造）；",
    "【验证行动】给一个可执行的小步（如重做同考点变式/复述某概念），不要清单轰炸。",
    "红线：仅答案不一致不能断言「粗心」或「不会」；不做心理/人格诊断；不替用户下最终结论——输出是假设，采纳由用户决定；受助作答不得当独立能力证据。",
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: evidenceFacts(q, ev).join("\n") },
  ];
}
