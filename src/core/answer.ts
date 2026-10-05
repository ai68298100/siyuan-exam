// ============================================================
// 答案规范化与判分（导入 / 判分 / 导出共用的单一真相源）
// 定案（TODO 26.1）：空白折叠、全角→半角、大小写策略按题型、多选按字母序
// ============================================================
import type { Question } from "./types";
import { specOf, gradeWithSpec } from "./structuredAnswer";

export const OPTION_LETTERS = "ABCDEFGHIJ";

/** 全角转半角 + 折叠空白 */
export function foldText(s: string): string {
  return s
    .replace(/\u3000/g, " ")
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, " ")
    .trim();
}

/** 判断题答案方言归一化：对/T/F/√/×/true/false/是/否 → "对"|"错" */
export function normalizeJudge(raw: string): "对" | "错" | null {
  const s = foldText(raw).toLowerCase();
  if (["对", "t", "true", "√", "是", "y", "yes", "正确"].includes(s)) return "对";
  if (["错", "f", "false", "×", "x", "否", "n", "no", "错误"].includes(s)) return "错";
  return null;
}

/** 按题型规范化答案：single→"B"；multiple→"ABD"（字母序）；judge→"对"|"错"；fill/short→foldText */
export function normalizeAnswer(type: Question["type"], raw: string): string | null {
  const s = foldText(String(raw ?? ""));
  if (!s) return null;
  if (type === "judge") return normalizeJudge(s);
  if (type === "single") {
    const m = s.toUpperCase().match(/^[A-J]/);
    return m ? m[0] : null;
  }
  if (type === "multiple") {
    const letters = s
      .toUpperCase()
      .replace(/[^A-J]/g, "")
      .split("");
    const uniq = [...new Set(letters)].sort();
    return uniq.length ? uniq.join("") : null;
  }
  return s; // fill / short
}

export interface GradeResult {
  verdict: "correct" | "wrong" | "not_attempted";
  myAnswer: string | null;
}

/** 判分：myAnswer 为空/仅空白 → not_attempted（不计入正确率分母的口径见统计说明）。
 *  54-01/02：带 numeric answerSpec 的题走数值容差/单位判分（structuredAnswer），其余按字符串口径。 */
export function grade(q: Question, myAnswerRaw: string | null | undefined): GradeResult {
  const myAnswer = myAnswerRaw == null || myAnswerRaw === "" ? null : myAnswerRaw;
  if (myAnswer == null) return { verdict: "not_attempted", myAnswer: null };
  if (q.type === "short") {
    // 简答题：机器不判分，作答即计入尝试；对错由自评/背诵回路决定，此处按 not_attempted 语义返回 correct-by-self 由 UI 决定
    return { verdict: "not_attempted", myAnswer };
  }
  // 54-01/02：结构化数值判分优先（无 spec → 旧口径，向后兼容）
  const spec = specOf(q);
  if (spec) {
    const v = gradeWithSpec(q, myAnswer);
    return { verdict: v.verdict, myAnswer };
  }
  const mine = normalizeAnswer(q.type, myAnswer);
  const want = normalizeAnswer(q.type, q.answer);
  if (!mine || !want) return { verdict: "wrong", myAnswer };
  if (q.type === "fill") {
    // 大小写不敏感（含别名）
    const mineLc = mine.toLowerCase();
    const ok = mineLc === want.toLowerCase() || (q.alt ?? []).some((a) => foldText(a).toLowerCase() === mineLc);
    return { verdict: ok ? "correct" : "wrong", myAnswer };
  }
  return { verdict: mine === want ? "correct" : "wrong", myAnswer };
}

/** 去重指纹：题干+选项（fold 后）——导入去重与题库健康共用 */
export function questionHash(stem: string, options: string[]): string {
  const material = foldText(stem) + "\u0001" + options.map(foldText).join("\u0002");
  return sha1like(material);
}

/** 轻量散列（FNV-1a 64bit 的 hex；非加密用途，去重足够） */
export function sha1like(s: string): string {
  let h1 = 0xcbf29ce4,
    h2 = 0x84222325;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 ^ ((c << 3) | (i & 7))) >>> 0;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}
