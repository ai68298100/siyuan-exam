// ============================================================
// AI 出题管线（v0.4；docs/05 增补 + research/06/08 质量范式）
// 切片 → 提示词（五模块框架）→ 容错 JSON 解析 → 客户端质量门槛 → 待审核队列
// 纯函数 + AiChannel 注入；经济档位=单遍，标准档位=超量 1.2×（v0.4 起步，二遍核验 v0.4.x）
// ============================================================
import type { Question } from "../core/types";
import { normalizeAnswer, questionHash, foldText } from "../core/answer";
import { newQuestionId, newBatchId } from "../core/ids";
import { validate } from "../importer/pipeline";
import type { AiChannel, AiMessage } from "./client";

export interface GenOptions {
  types: Question["type"][];
  count: number;
  difficulty: "easy" | "medium" | "hard" | "mixed";
  kp?: string;                  // 考点提示（写入题目 kp）
  sourceTitle?: string;         // 来源材料标题（写入 source；引用=待 v0.4.x 块引用）
  existingHashes?: Set<string>;
}

export interface GenIssue {
  index: number;                // 原始序号（1-based）
  reason: string;
  raw: string;
}

export interface GenResult {
  pending: Question[];          // 通过质量门槛，进待审核队列（review=pending）
  rejected: GenIssue[];
  duplicates: number;
  batch: string;
}

/** 长材料切片（段落聚合，maxChars 上限） */
export function sliceText(text: string, maxChars = 6000): string[] {
  const paras = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  if (!paras.length) return text.trim() ? [text.trim()] : [];
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > maxChars && cur) { chunks.push(cur); cur = p; }
    else cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export function buildPrompt(chunk: string, opt: GenOptions): AiMessage[] {
  const types = opt.types.length ? opt.types : ["single"];
  const typeLine = types.map((t) => ({ single: "单选", multiple: "多选", judge: "判断", fill: "填空", short: "简答" }[t])).join("、");
  const system = [
    "你是严谨的命题专家。根据给定材料出题，禁止编造材料中不存在的事实。",
    "硬性规则：",
    "1) 只输出一个 JSON 数组，不要任何解释文字或代码围栏；",
    "2) 每题字段：type(stem 的题型：single/multiple/judge/fill/short)、stem(题干，禁止\"以下说法正确的是\"式空泛句)、options(字符串数组，judge/fill/short 为空数组)、answer(单选=字母；多选=字母连写如 ABD；判断=对/错；填空/简答=文本)、analysis(解析 ≥30 字，必须含因果解释)、kp(知识点标签，可为空)；",
    "3) 干扰项应为常见误解；禁止\"以上都对/都不是\"类选项；",
    "4) 难度目标：" + (opt.difficulty === "mixed" ? "易中难混合" : opt.difficulty === "easy" ? "基础" : opt.difficulty === "hard" ? "较难" : "中等") + "。",
  ].join("\n");
  const user = `【材料】\n${chunk}\n\n【要求】出 ${opt.count} 道题（题型：${typeLine}）。${opt.kp ? `考点方向：${opt.kp}。` : ""}只输出 JSON 数组。`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** 容错 JSON 解析：剥代码围栏、截取首个 [..] 平衡段、忽略尾随文本 */
export function extractJsonArray(raw: string): unknown[] | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = s.indexOf("[");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "[") depth++;
    else if (ch === "]") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  try {
    const arr = JSON.parse(s.slice(start, end + 1));
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

const MIN_ANALYSIS = 12;

function toQuestion(o: Record<string, unknown>, opt: GenOptions, batch: string): { q?: Question; reason?: string } {
  const type = String(o.type ?? "").toLowerCase() as Question["type"];
  if (!["single", "multiple", "judge", "fill", "short"].includes(type)) return { reason: `题型无法识别：${type}` };
  const stem = String(o.stem ?? "").trim();
  const options = Array.isArray(o.options) ? (o.options as unknown[]).map((x) => String(x)) : [];
  const answer = normalizeAnswer(type, String(o.answer ?? ""));
  if (!answer) return { reason: `答案无法识别：${String(o.answer ?? "")}` };
  const analysis = String(o.analysis ?? "").trim();
  if (foldText(analysis).length < MIN_ANALYSIS) return { reason: "解析过短（缺少因果解释）" };
  if (/以上都[是对]|以上选项都/.test(stem + options.join(""))) return { reason: "含\"以上都对\"类禁用选项" };
  const q: Question = {
    id: newQuestionId(),
    type, stem, options, answer,
    analysis,
    difficulty: opt.difficulty === "mixed" ? undefined : { easy: 2, medium: 3, hard: 4 }[opt.difficulty],
    score: 1,
    source: opt.sourceTitle ? `AI · ${opt.sourceTitle}` : "AI 生成",
    sourceKind: "mock",
    kp: String(o.kp ?? opt.kp ?? ""),
    origin: "ai",
    batch,
    review: "pending",
    hash: questionHash(stem, options),
  };
  const bad = validate(q);
  if (bad) return { reason: bad };
  return { q };
}

/** 生成入口：调通道 → 解析 → 门槛 → 去重 → 待审核 */
export async function generate(channel: AiChannel, sourceText: string, opt: GenOptions): Promise<GenResult> {
  const chunks = sliceText(sourceText);
  if (!chunks.length) throw new Error("材料为空");
  const pending: Question[] = [];
  const rejected: GenIssue[] = [];
  const seenHash = new Set(opt.existingHashes);
  const dedupe = true;
  let duplicates = 0;
  let idx = 0;
  const batch = newBatchId();
  // 超量 1.2×：分片自然超量（每片按 count 出，收满即停）
  for (const chunk of chunks) {
    const messages = buildPrompt(chunk, opt);
    const raw = await channel.chat(messages);
    const arr = extractJsonArray(raw);
    if (!arr) {
      rejected.push({ index: ++idx, reason: "响应不是有效 JSON 数组", raw: raw.slice(0, 120) });
      continue;
    }
    for (const item of arr) {
      idx++;
      if (!(item && typeof item === "object")) { rejected.push({ index: idx, reason: "非对象", raw: JSON.stringify(item).slice(0, 80) }); continue; }
      const r = toQuestion(item as Record<string, unknown>, opt, batch);
      if (r.reason || !r.q) { rejected.push({ index: idx, reason: r.reason ?? "未知", raw: JSON.stringify(item).slice(0, 80) }); continue; }
      if (dedupe && seenHash.has(r.q.hash)) { duplicates++; continue; }
      seenHash.add(r.q.hash);
      pending.push(r.q);
      if (pending.length >= opt.count) break;
    }
    if (pending.length >= opt.count) break;
  }
  return { pending, rejected, duplicates, batch };
}
