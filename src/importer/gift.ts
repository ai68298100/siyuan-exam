// ============================================================
// GIFT 解析器（TODO 5 组）：Moodle GIFT 格式 → Question[]
// 支持：单选 / 多选（=答案%）/ 判断（TRUE/FALSE）/ 短答 / 填空
// 不支持（原样跳过并报告）：数值区间、匹配题、::标题/分类行保留为 kp 参考
// 纯函数；与 parseAiken 同输出 ImportReport，走同一 validate/去重漏斗
// ============================================================
import type { Question } from "../core/types";
import { normalizeAnswer, questionHash, OPTION_LETTERS } from "../core/answer";
import { newQuestionId, newBatchId } from "../core/ids";
import type { ImportOptions, ImportReport, ImportError } from "./pipeline";
import { validate } from "./pipeline";

interface GiftParsed {
  type: Question["type"];
  stem: string;
  options: { text: string; correct: boolean; weight?: number }[];
  answer: string;          // judge: 对/错；short: 文本；单选/多选: 字母串
  analysis: string;
}

/** 解析单题 GIFT 块（{...} 内的选项区） */
function parseGiftBody(body: string): GiftParsed | null {
  // 分离题干与选项区：第一个 { ... } 为答案区
  const braceStart = body.indexOf("{");
  const braceEnd = body.lastIndexOf("}");
  if (braceStart < 0 || braceEnd <= braceStart) return null;
  const stem = body.slice(0, braceStart).trim();
  const inner = body.slice(braceStart + 1, braceEnd).trim();

  // 判断题：TRUE/FALSE
  if (/^(TRUE|FALSE|T|F)$/i.test(inner)) {
    return { type: "judge", stem, options: [], answer: /t/i.test(inner[0]) ? "对" : "错", analysis: "" };
  }

  // 题型预判：含 ~ 行 = 选择题；全部 = 行 = 短答
  const rawOpts = inner.split("\n").map((l) => l.trim()).filter(Boolean);
  const isChoice = rawOpts.some((l) => l.startsWith("~"));

  if (!isChoice) {
    // 短答/填空：= 答案 # 反馈（可多行 = 多可接受答案）
    const shorts: string[] = [];
    const analysisParts: string[] = [];
    for (const line of rawOpts) {
      if (!line.startsWith("=")) continue;
      const hashIdx = line.indexOf("#");
      const ans = hashIdx > 0 ? line.slice(1, hashIdx).trim() : line.slice(1).trim();
      shorts.push(ans);
      if (hashIdx > 0) analysisParts.push(line.slice(hashIdx + 1).trim());
    }
    if (!shorts.length) return null;
    return { type: "short", stem, options: [], answer: shorts.join("|"), analysis: analysisParts.join(" ") };
  }

  // 选择题：= 正确 / ~ 干扰
  const opts: { text: string; correct: boolean }[] = [];
  const analysisParts: string[] = [];
  for (const line of rawOpts) {
    const isCorrect = line.startsWith("=");
    if (!isCorrect && !line.startsWith("~")) continue;
    let text = line.slice(1).trim();
    const hashIdx = text.indexOf("#");
    if (hashIdx > 0) {
      const fb = text.slice(hashIdx + 1).trim();
      if (isCorrect && fb) analysisParts.push(fb);
      text = text.slice(0, hashIdx).trim();
    }
    if (text) opts.push({ text, correct: isCorrect });
  }

  if (opts.filter((o) => o.correct).length > 1) {
    return { type: "multiple", stem, options: opts, answer: "", analysis: analysisParts.join(" ") };
  }
  return { type: "single", stem, options: opts, answer: "", analysis: analysisParts.join(" ") };
}

/** GIFT 文本 → ImportReport（与 parseAiken 同输出） */
export function parseGift(text: string, opt: ImportOptions = {}): ImportReport {
  const errors: ImportError[] = [];
  const ok: Question[] = [];
  const seenHash = new Set(opt.existingHashes);
  const dedupe = opt.dedupe !== false;
  let duplicates = 0;
  const batch = newBatchId();

  // 按_blank行分隔题目块；块内合并换行
  const blocks = text.split(/\n\s*\n/).map((b) => b.replace(/\r/g, "").trim()).filter(Boolean);
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    const rowNo = bi + 1;
    try {
      // ::标题:: 前缀 → kp 候选
      let kp = "";
      let body = block;
      const titleMatch = body.match(/^::([^:]+)::/);
      if (titleMatch) { kp = titleMatch[1].trim(); body = body.slice(titleMatch[0].length).trim(); }
      // // 注释行跳过
      if (body.startsWith("//")) continue;

      const parsed = parseGiftBody(body);
      if (!parsed) throw new Error("GIFT 格式无法识别（缺少 {答案区}）");

      const options = parsed.type === "single" || parsed.type === "multiple"
        ? parsed.options.map((o) => o.text).filter(Boolean)
        : [];
      let answer: string;
      if (parsed.type === "single") {
        const ci = parsed.options.findIndex((o) => o.correct);
        if (ci < 0) throw new Error("单选题无正确答案（= 前缀）");
        answer = OPTION_LETTERS[ci];
      } else if (parsed.type === "multiple") {
        const letters = parsed.options.map((o, i) => (o.correct ? OPTION_LETTERS[i] : "")).filter(Boolean).sort().join("");
        if (!letters) throw new Error("多选题无正确答案");
        answer = letters;
      } else {
        answer = normalizeAnswer(parsed.type, parsed.answer) ?? "";
        if (!answer && parsed.type !== "short") throw new Error(`答案无法识别：${parsed.answer}`);
      }

      const analysis = parsed.analysis;
      const q: Question = {
        id: newQuestionId(),
        type: parsed.type,
        stem: parsed.stem,
        options,
        answer: parsed.type === "short" ? parsed.answer : answer,
        analysis,
        difficulty: opt.difficulty,
        score: 1,
        source: "GIFT 导入",
        sourceKind: "mock",
        kp,
        origin: "imported",
        batch,
        review: "verified",
        hash: questionHash(parsed.stem, options),
      };
      const bad = validate(q);
      if (bad) throw new Error(bad);
      if (dedupe && seenHash.has(q.hash)) { duplicates++; continue; }
      seenHash.add(q.hash);
      ok.push(q);
    } catch (e) {
      errors.push({ row: rowNo, reason: (e as Error).message, raw: block.slice(0, 120) });
    }
  }
  return { ok, errors, duplicates, batch, dupeSamples: [] };
}
