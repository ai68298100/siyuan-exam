// ============================================================
// 记忆服务（v0.2）：思源内核 riff 的领域封装
// - 卡包命名空间隔离：小驴考试/<题库名>（与内置闪卡共存，docs/03 #1）
// - 错题转卡：blockIds → addRiffCards；导入/转卡去重由内核按块幂等
// - 自评→FSRS rating 映射：四级自评（墨墨式）→ 0=Again 1=Hard 2=Good 3=Easy
//   （rating 数值语义待真机复核——TODO 27 组真机冒烟项）
// 纯逻辑（映射/挑选）与 IO（riff 调用）分离，测试覆盖纯逻辑
// ============================================================
import type { Question } from "./types";

export const DECK_PREFIX = "小驴考试/";

export const deckNameForBank = (bankName: string) => DECK_PREFIX + bankName;

/** 四级自评 → riff rating（1不会 2模糊 3会 4熟知） */
export function selfRatingToRiffRating(selfRating: number): 0 | 1 | 2 | 3 {
  switch (selfRating) {
    case 1:
      return 0; // Again
    case 2:
      return 1; // Hard
    case 3:
      return 2; // Good
    case 4:
      return 3; // Easy
    default:
      return 0;
  }
}

/** 二元自评（记住/忘了）→ rating */
export function binaryToRiffRating(remembered: boolean): 0 | 1 | 2 | 3 {
  return remembered ? 2 : 0;
}

/** 举一反三：完整考点优先 → 同章节（kp 首段）→ 任意；排除已做 */
export function pickSameKp(
  all: Question[],
  seedQuestion: Question,
  n: number,
  excludeIds: Set<string> = new Set(),
  rnd: () => number = Math.random,
): Question[] {
  const pool = all.filter((q) => !excludeIds.has(q.id) && q.id !== seedQuestion.id);
  const sameExact = seedQuestion.kp ? pool.filter((q) => q.kp === seedQuestion.kp) : [];
  const kpRoot = seedQuestion.kp?.split("/")[0];
  const sameRoot = kpRoot ? pool.filter((q) => q.kp?.split("/")[0] === kpRoot && !sameExact.includes(q)) : [];
  const rest = pool.filter((q) => !sameExact.includes(q) && !sameRoot.includes(q));
  const out: Question[] = [];
  const drain = (arr: Question[]) => {
    while (arr.length && out.length < n) out.push(arr.splice(Math.floor(rnd() * arr.length), 1)[0]);
  };
  drain(sameExact);
  drain(sameRoot);
  drain(rest);
  return out;
}

/** 冲刺 cram 队列：错 ≥2 次 ∪ 可选考点池；排除已消灭 */
export function cramQueue(
  questions: Question[],
  wrongCounts: Map<string, number>,
  minWrong = 2,
  limit = 50,
): Question[] {
  const scored = questions
    .filter((q) => (wrongCounts.get(q.id) ?? 0) >= minWrong)
    .sort((a, b) => (wrongCounts.get(b.id) ?? 0) - (wrongCounts.get(a.id) ?? 0));
  return scored.slice(0, limit);
}

/** 每日一练：到期优先（调用方传入）→ 高频错题 → 随机补足到 n */
export function dailySet(
  all: Question[],
  dueFirst: Question[],
  wrongCounts: Map<string, number>,
  n: number,
  rnd: () => number = Math.random,
): Question[] {
  const seen = new Set<string>();
  const out: Question[] = [];
  const push = (q: Question) => {
    if (out.length < n && !seen.has(q.id)) {
      seen.add(q.id);
      out.push(q);
    }
  };
  dueFirst.forEach(push);
  const byWrong = [...all].sort((a, b) => (wrongCounts.get(b.id) ?? 0) - (wrongCounts.get(a.id) ?? 0));
  byWrong.forEach(push);
  const shuffled = [...all];
  while (out.length < n && shuffled.length) {
    push(shuffled.splice(Math.floor(rnd() * shuffled.length), 1)[0]);
  }
  return out;
}
