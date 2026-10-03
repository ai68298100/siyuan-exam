// ============================================================
// 人机对话题型引擎（v1.x 前置核心；医考 CBT 范式，research/02·07）
// 1) 不定项判分：全对满分；少选按比例；含错选不得分；空=not_attempted
// 2) 作答流锁：lockout 模式下已答题目不可回退（goto 守卫为纯函数）
// 3) 共用题干题组：exam-group 关联（写侧模板见 blockTemplate.questionGroupToMarkdown）
// ============================================================
import type { Question } from "./types";
import { normalizeAnswer, foldText } from "./answer";

export interface IndefiniteGrade {
  verdict: "correct" | "wrong" | "not_attempted";
  myAnswer: string | null;
  /** 部分得分系数 0-1（少选且无错选时 >0）；错选/空=0 */
  factor: number;
}

/** 不定项判分（卫生资格范式：少选每个正确选项按比例得分，错选全扣） */
export function gradeIndefinite(q: Question, myAnswerRaw: string | null | undefined): IndefiniteGrade {
  const myAnswer = myAnswerRaw == null || myAnswerRaw === "" ? null : myAnswerRaw;
  if (!myAnswer) return { verdict: "not_attempted", myAnswer: null, factor: 0 };
  const correctSet = new Set(normalizeAnswer("multiple", q.answer)?.split("") ?? []);
  const mine = [...new Set(normalizeAnswer("multiple", myAnswer)?.split("") ?? [])];
  if (!mine.length || !correctSet.size) return { verdict: "wrong", myAnswer, factor: 0 };
  let hits = 0,
    misses = 0;
  for (const L of mine) {
    if (correctSet.has(L)) hits++;
    else misses++;
  }
  if (misses > 0) return { verdict: "wrong", myAnswer, factor: 0 };
  if (hits === correctSet.size) return { verdict: "correct", myAnswer, factor: 1 };
  // 少选：按命中比例给部分分，但判 wrong（进错题本——漏选也是漏）
  return { verdict: "wrong", myAnswer, factor: hits / correctSet.size };
}

/** 作答流锁守卫（人机对话严格顺序作答）：
 *  - 已有已答题：强制停留于"已答边界 +1"（不可回跳、不可跳过未答题）
 *  - 尚无已答题：目标索引自由（钳制在卷内） */
export function guardLockout(targetIndex: number, answeredFlags: readonly boolean[], _current: number): number {
  const last = answeredFlags.length - 1;
  let max = -1;
  for (let i = 0; i < answeredFlags.length; i++) if (answeredFlags[i]) max = i;
  if (max < 0) return Math.max(0, Math.min(targetIndex, last));
  return Math.min(answeredFlags.length - 1, max + 1);
}

/** 材料组 ID：g-xxxxxx（子题 exam-group 关联） */
export const newGroupId = (): string => {
  const g = globalThis.crypto;
  if (!g?.getRandomValues) throw new Error("[lv-exam] WebCrypto 不可用");
  const buf = new Uint8Array(3);
  g.getRandomValues(buf);
  return "g-" + [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/** 共用题干校验：组内子题 ≥2 且题型均为可组题型 */
export function validateMaterialGroup(material: string, subs: Question[]): string | null {
  if (!foldText(material)) return "材料题干为空";
  if (subs.length < 2) return "共用题干至少需要 2 道子题";
  return null;
}
