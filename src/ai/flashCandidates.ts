// ============================================================
// AI 最小闪卡候选（TODO 116-03，docs/18 T10）：从用户反思/参考解析提出
// 最小问答/挖空/对照卡与拆卡理由。仅候选——先显示卡数/负荷/来源，
// 用户确认后才建卡；不自动评级、不碰 FSRS 调度（边界）。
// 纯函数：提示词构造 / 宽容 JSON 解析 / 卡面泄露守卫 / 负荷汇总。
// ============================================================
import type { Question } from "../core/types";
import type { AiMessage } from "./client";

export type FlashCardType = "qa" | "cloze" | "contrast";

export interface FlashCardCandidate {
  type: FlashCardType;
  front: string;
  back: string;
  source: "反思" | "解析" | "补充";
}

export interface FlashCandidateResult {
  cards: FlashCardCandidate[];
  splitReason?: string;
}

const MAX_CARDS = 5;
const MAX_LEN = 200;

export function buildFlashCandidateMessages(
  q: Question,
  ctx: { reflection?: string } = {},
): AiMessage[] {
  const fact = [
    `题干：${q.stem}`,
    ...q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`),
    `正确答案：${q.answer}`,
    q.analysis ? `参考解析：${q.analysis}` : "参考解析：（缺证据——不要据此编卡）",
    ctx.reflection?.trim() ? `用户反思/自我解释：${ctx.reflection.trim()}` : "用户反思：（无——卡面来源不要标「反思」）",
  ]
    .filter(Boolean)
    .join("\n");
  const system = [
    "你是记忆卡设计助手，中文、简洁。把这道题的知识拆成最小记忆卡候选，只输出 JSON：",
    '{"cards":[{"type":"qa|cloze|contrast","front":"…","back":"…","source":"反思|解析|补充"}],"splitReason":"为什么这样拆"}',
    "要求：≤" + MAX_CARDS + " 张；一张卡一个原子事实（最小卡，不复制整段解析）；",
    "cloze 卡 front 用 ____ 标挖空、back 为被挖内容；contrast 卡 = 正例/反例对照；",
    "front 不得包含 back 的内容（防自泄）；front/back 各 ≤" + MAX_LEN + " 字；",
    "来源如实标注：来自用户反思才标「反思」，来自参考解析标「解析」，你自己补的标「补充」；",
    "证据不足就少出卡，不凑数。只输出 JSON，不要解释。",
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: fact },
  ];
}

/** 宽容解析：剥 ``` 围栏 → JSON.parse → 逐卡整形（截长/丢非法/截 5 张）；解析失败抛可行动错误 */
export function parseFlashCandidates(raw: string): FlashCandidateResult {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型未返回 JSON（闪卡候选不可用）");
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("模型返回的 JSON 无法解析（闪卡候选不可用）");
  }
  const rawCards = Array.isArray((obj as { cards?: unknown }).cards) ? (obj as { cards: unknown[] }).cards : [];
  const validTypes = new Set(["qa", "cloze", "contrast"]);
  const validSources = new Set(["反思", "解析", "补充"]);
  // 发版加固（七三批）：压平换行——front/back 进单块 markdown 卡面，换行会破坏块结构与卡面
  const flat = (v: unknown) => String(v ?? "").replace(/\r?\n+/g, " ").trim().slice(0, MAX_LEN);
  const cards: FlashCardCandidate[] = [];
  for (const c of rawCards) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const type = String(o.type ?? "");
    const front = flat(o.front);
    const back = flat(o.back);
    const source = String(o.source ?? "补充");
    if (!validTypes.has(type) || !front || !back) continue;
    cards.push({
      type: type as FlashCardType,
      front,
      back,
      source: validSources.has(source) ? (source as FlashCardCandidate["source"]) : "补充",
    });
    if (cards.length >= MAX_CARDS) break;
  }
  if (!cards.length) throw new Error("模型未给出可用的卡候选（证据不足或格式不符）");
  const splitReason = String((obj as { splitReason?: unknown }).splitReason ?? "").replace(/\r?\n+/g, " ").trim().slice(0, 200) || undefined;
  return { cards, splitReason };
}

/** 卡面泄露守卫：front 包含 back（≥4 字）＝自泄；front=back＝无效卡。返回可读原因列表（空=干净） */
export function findCardLeaks(cards: FlashCardCandidate[]): string[] {
  const leaks: string[] = [];
  cards.forEach((c, i) => {
    if (c.front === c.back) {
      leaks.push(`卡 ${i + 1}：正面与背面相同`);
      return;
    }
    if (c.back.length >= 4 && c.front.includes(c.back)) {
      leaks.push(`卡 ${i + 1}：正面泄露了背面内容`);
    }
  });
  return leaks;
}

/** 负荷汇总（确认前展示：先显示卡数/负荷/来源——116-03 验收） */
export function summarizeLoad(cards: FlashCardCandidate[]): string {
  const byType = new Map<string, number>();
  const bySource = new Map<string, number>();
  for (const c of cards) {
    byType.set(c.type, (byType.get(c.type) ?? 0) + 1);
    bySource.set(c.source, (bySource.get(c.source) ?? 0) + 1);
  }
  const typeName: Record<string, string> = { qa: "问答", cloze: "挖空", contrast: "对照" };
  const t = [...byType.entries()].map(([k, n]) => `${typeName[k] ?? k} ${n}`).join(" / ");
  const s = [...bySource.entries()].map(([k, n]) => `${k} ${n}`).join("、");
  return `${cards.length} 张（${t}）· 来源：${s}`;
}
