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
  kp?: string; // 考点提示（写入题目 kp）
  sourceTitle?: string; // 来源材料标题（写入 source；引用=待 v0.4.x 块引用）
  preset?: keyof typeof PROMPT_PRESETS;
  customHint?: string; // 用户自定义命题要求（追加到系统提示）
  quality?: "standard" | "economy"; // 标准=二遍换角色核验（默认）；经济=单遍
  existingHashes?: Set<string>;
  /** 取消信号：每个分片完成后检查，中止后续分片（已完成分片保留） */
  signal?: { aborted: boolean };
}

export interface GenIssue {
  index: number; // 原始序号（1-based）
  reason: string;
  raw: string;
}

export interface GenResult {
  pending: Question[]; // 通过质量门槛，进待审核队列（review=pending）
  rejected: GenIssue[];
  duplicates: number;
  batch: string;
}

/** 长材料切片（段落聚合，maxChars 上限） */
export function sliceText(text: string, maxChars = 6000): string[] {
  const paras = text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!paras.length) return text.trim() ? [text.trim()] : [];
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > maxChars && cur) {
      chunks.push(cur);
      cur = p;
    } else cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Prompt 预设（Prompt Settings lite；用户自定义模板编辑待 v0.4.x） */
export const PROMPT_PRESETS: Record<string, { label: string; hint: string }> = {
  default: { label: "通用", hint: "" },
  gongkao: {
    label: "公考行测",
    hint: "命题风格贴近公务员考试行测：言语理解与表达、数量关系、判断推理、资料分析、常识判断；干扰项设为常见速算/逻辑误区。",
  },
  kaoyan: {
    label: "考研政治",
    hint: "命题风格贴近考研政治：马原/毛中特/史纲/思修法基/时政；重视概念辨析与内涵外延；干扰项为相近表述偷换。",
  },
  yixue: {
    label: "医学执业",
    hint: "命题风格贴近医学执业资格考试：临床情景题干、A1/A2 型表述；干扰项为相似症状/体征/用药误区。",
  },
  jiakao: { label: "驾考", hint: "命题风格贴近驾考科目一/四：交规条款、标志标线、安全文明驾驶；题干简短直白。" },
};

/**
 * 干扰项构建规范（docs/03 附录 A；Haladyna & Downing 1993 / TGM-D 复述版）
 * 选择题选项必须逐条自查，避免"唯长选项""词面呼应题干"等表面线索。
 */
export const HALADYNA_RULES = [
  "干扰项彼此同质（同类概念/同类量纲/同类表述长度，禁止唯一长选项或唯一精确表述）；",
  "每个干扰项对应一个可诊断的常见误解（算错/偷换概念/张冠李戴），并在解析中点名该误区；",
  "禁止绝对化词面（都/最/必然/一定）与题干词面重复造成的提示性线索；",
  '选项避免"以上都对/都不是/全部/都不"及组合式兜底；',
  "选项相互独立不重叠（单项只有一个可辩护正确答案，多选各正确项有独立依据）；",
  "正确项位置/长度不形成规律性偏好。",
].join("\n");

export function buildPrompt(chunk: string, opt: GenOptions): AiMessage[] {
  const types = opt.types.length ? opt.types : ["single"];
  const typeLine = types
    .map((t) => ({ single: "单选", multiple: "多选", judge: "判断", fill: "填空", short: "简答" })[t])
    .join("、");
  const presetHint = opt.preset && PROMPT_PRESETS[opt.preset] ? PROMPT_PRESETS[opt.preset].hint : "";
  const customHint = opt.customHint?.trim() ? `\n用户额外要求：${opt.customHint.trim()}` : "";
  const hasChoice = types.some((t) => t === "single" || t === "multiple");
  const system =
    [
      "你是严谨的命题专家。根据给定材料出题，禁止编造材料中不存在的事实。",
      presetHint ? `命题风格：${presetHint}` : "",
      "硬性规则：",
      "1) 只输出一个 JSON 数组，不要任何解释文字或代码围栏；",
      '2) 每题字段：type(stem 的题型：single/multiple/judge/fill/short)、stem(题干，禁止"以下说法正确的是"式空泛句)、options(字符串数组，judge/fill/short 为空数组)、answer(单选=字母；多选=字母连写如 ABD；判断=对/错；填空/简答=文本)、analysis(解析 ≥30 字，必须含因果解释)、kp(知识点标签，可为空)；',
      '3) 干扰项应为常见误解；禁止"以上都对/都不是"类选项；',
      "4) 难度目标：" +
        (opt.difficulty === "mixed"
          ? "易中难混合"
          : opt.difficulty === "easy"
            ? "基础"
            : opt.difficulty === "hard"
              ? "较难"
              : "中等") +
        "。",
      hasChoice ? "5) 干扰项构建规范（逐题自查）：\n" + HALADYNA_RULES : "",
    ]
      .filter(Boolean)
      .join("\n") + customHint;
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
  let depth = 0,
    inStr = false,
    esc = false,
    end = -1;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
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
  if (/以上都[是对]|以上选项都/.test(stem + options.join(""))) return { reason: '含"以上都对"类禁用选项' };
  const q: Question = {
    id: newQuestionId(),
    type,
    stem,
    options,
    answer,
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

/** Question → 可重试的完整 JSON（repairIssues 的修复输入；不截断） */
function rawOf(q: Question): string {
  return JSON.stringify({
    type: q.type,
    stem: q.stem,
    options: q.options,
    answer: q.answer,
    analysis: q.analysis,
    kp: q.kp,
  });
}

/** 二遍核验（换角色）：严格审题人对每题打置信度；<0.85 或 pass=false 淘汰（research/08 Quanta+QuizAPI 范式） */
export const REVIEW_CONFIDENCE_MIN = 0.85;

export async function reviewQuestions(
  channel: AiChannel,
  questions: Question[],
  sourceChunk: string,
): Promise<Map<string, { confidence: number; pass: boolean; reason?: string }>> {
  const out = new Map<string, { confidence: number; pass: boolean; reason?: string }>();
  if (!questions.length) return out;
  const compact = questions.map((q, i) => ({
    index: i + 1,
    id: q.id,
    type: q.type,
    stem: q.stem,
    options: q.options,
    answer: q.answer,
    analysis: q.analysis,
  }));
  const messages: AiMessage[] = [
    {
      role: "system",
      content:
        '你是苛刻的审题人。对照材料逐题核查：答案是否唯一正确、解析是否因果成立、干扰项是否合理。只输出 JSON 数组：[{"id":题目id,"confidence":0到1,"pass":布尔,"reason":一句否决理由（pass 时省略）}]。',
    },
    { role: "user", content: `【材料】\n${sourceChunk.slice(0, 3000)}\n\n【待核题目】\n${JSON.stringify(compact)}` },
  ];
  const raw = await channel.chat(messages);
  const arr = extractJsonArray(raw);
  if (!arr) {
    // 核验失败不吞题：全部标低置信待人工（降级语义）
    for (const q of questions) out.set(q.id, { confidence: 0, pass: false, reason: "核验响应不可解析" });
    return out;
  }
  for (const item of arr) {
    const o = item as Record<string, unknown>;
    if (typeof o?.id === "string" && typeof o?.confidence === "number") {
      out.set(String(o.id), {
        confidence: Math.max(0, Math.min(1, o.confidence)),
        pass: o.pass !== false,
        reason: typeof o.reason === "string" ? o.reason : undefined,
      });
    }
  }
  // 缺失的题按未核验处理
  for (const q of questions)
    if (!out.has(q.id)) out.set(q.id, { confidence: 0, pass: false, reason: "审题人未返回该题" });
  return out;
}

/** 生成入口：调通道 → 解析 → 门槛 → （标准档）二遍核验 → 去重 → 待审核 */
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
  const quality = opt.quality ?? "standard";
  // 超量 1.2×：分片自然超量（每片按 count 出，收满即停）；取消信号每片间检查
  for (const chunk of chunks) {
    if (opt.signal?.aborted) break;
    const messages = buildPrompt(chunk, opt);
    const raw = await channel.chat(messages);
    const arr = extractJsonArray(raw);
    if (!arr) {
      rejected.push({ index: ++idx, reason: "响应不是有效 JSON 数组", raw: raw.slice(0, 120) });
      continue;
    }
    const candidates: Question[] = [];
    for (const item of arr) {
      idx++;
      if (!(item && typeof item === "object")) {
        rejected.push({ index: idx, reason: "非对象", raw: JSON.stringify(item).slice(0, 80) });
        continue;
      }
      const r = toQuestion(item as Record<string, unknown>, opt, batch);
      if (r.reason || !r.q) {
        rejected.push({ index: idx, reason: r.reason ?? "未知", raw: JSON.stringify(item).slice(0, 80) });
        continue;
      }
      if (dedupe && seenHash.has(r.q.hash)) {
        duplicates++;
        continue;
      }
      candidates.push(r.q);
    }
    // 标准档：二遍换角色核验
    if (quality === "standard" && candidates.length) {
      const verdicts = await reviewQuestions(channel, candidates, chunk);
      for (const q of candidates) {
        const v = verdicts.get(q.id) ?? { confidence: 0, pass: false, reason: "未核验" };
        if (!v.pass || v.confidence < REVIEW_CONFIDENCE_MIN) {
          rejected.push({
            index: idx,
            reason: `二遍核验淘汰：置信 ${v.confidence.toFixed(2)}${v.reason ? " · " + v.reason : ""}`,
            raw: rawOf(q),
          });
          continue;
        }
        q.confidence = v.confidence;
        if (seenHash.has(q.hash)) {
          duplicates++;
          continue;
        }
        seenHash.add(q.hash);
        pending.push(q);
        if (pending.length >= opt.count) break;
      }
    } else {
      for (const q of candidates) {
        if (seenHash.has(q.hash)) {
          duplicates++;
          continue;
        }
        seenHash.add(q.hash);
        pending.push(q);
        if (pending.length >= opt.count) break;
      }
    }
    if (pending.length >= opt.count) break;
  }
  return { pending, rejected, duplicates, batch };
}

/** 拒绝项重试（AI Inbox 范式的"重试"腿）：带否决原因让 AI 逐题修复 → 再过一遍门槛+二遍核验 */
export async function repairIssues(
  channel: AiChannel,
  issues: GenIssue[],
  sourceText: string,
  opt: GenOptions,
): Promise<GenResult> {
  const batch = newBatchId();
  const seenHash = new Set(opt.existingHashes);
  const pending: Question[] = [];
  const rejected: GenIssue[] = [];
  let duplicates = 0;
  const quality = opt.quality ?? "standard";

  const unfixable = issues.filter((i) => !i.raw.trim().startsWith("{"));
  const fixable = issues.filter((i) => i.raw.trim().startsWith("{"));
  if (!fixable.length) return { pending: [], rejected: issues, duplicates: 0, batch };

  const chunks: string[] = [];
  for (let i = 0; i < fixable.length; i += 5) {
    chunks.push(
      fixable
        .slice(i, i + 5)
        .map((f) => `【否决原因】${f.reason}\n【原题 JSON】${f.raw}`)
        .join("\n\n"),
    );
  }
  for (let ci = 0; ci < chunks.length; ci++) {
    if (opt.signal?.aborted) break;
    const group = fixable.slice(ci * 5, ci * 5 + 5);
    const messages: AiMessage[] = [
      {
        role: "system",
        content:
          '你是严谨的命题修订人。针对每道被否决的题，按否决原因修复（改干扰项/补解析/修答案），保持题型与考点不变。只输出修复后的 JSON 数组，元素结构：{"type":"single|multiple|judge|fill|short","stem":"...","options":[...],"answer":"...","analysis":"...","kp":"..."}。',
      },
      { role: "user", content: `【材料】\n${sourceText.slice(0, 3000)}\n\n【待修复题目】\n${chunks[ci]}` },
    ];
    const raw = await channel.chat(messages);
    const arr = extractJsonArray(raw);
    if (!arr) {
      group.forEach((f) => rejected.push({ index: f.index, reason: f.reason + "（修复响应不可解析）", raw: f.raw }));
      continue;
    }
    const candidates: Question[] = [];
    for (const item of arr) {
      if (!(item && typeof item === "object")) continue;
      const r = toQuestion(item as Record<string, unknown>, opt, batch);
      if (r.reason || !r.q) {
        rejected.push({ index: 0, reason: r.reason ?? "未知", raw: JSON.stringify(item).slice(0, 120) });
        continue;
      }
      if (seenHash.has(r.q.hash)) {
        duplicates++;
        continue;
      }
      candidates.push(r.q);
    }
    if (quality === "standard" && candidates.length) {
      const verdicts = await reviewQuestions(channel, candidates, sourceText.slice(0, 3000));
      for (const q of candidates) {
        const v = verdicts.get(q.id) ?? { confidence: 0, pass: false, reason: "未核验" };
        if (!v.pass || v.confidence < REVIEW_CONFIDENCE_MIN) {
          rejected.push({
            index: 0,
            reason: `修复后核验仍淘汰：置信 ${v.confidence.toFixed(2)}${v.reason ? " · " + v.reason : ""}`,
            raw: rawOf(q),
          });
          continue;
        }
        q.confidence = v.confidence;
        if (seenHash.has(q.hash)) {
          duplicates++;
          continue;
        }
        seenHash.add(q.hash);
        pending.push(q);
      }
    } else {
      for (const q of candidates) {
        if (seenHash.has(q.hash)) {
          duplicates++;
          continue;
        }
        seenHash.add(q.hash);
        pending.push(q);
      }
    }
  }
  // 不可解析的拒绝项原样保留（不参与修复）
  rejected.push(...unfixable);
  return { pending, rejected, duplicates, batch };
}
