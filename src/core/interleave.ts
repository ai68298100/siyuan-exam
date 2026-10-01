// ============================================================
// 材料组埋藏（TODO 20 组学习科学）：同组子题防止连续出现
// 轮流穿插算法：每轮从各活跃组取一题，穿插无组题；单组剩余时接受相邻
// ============================================================
import type { Question } from "./types";

export function interleaveGroups(questions: Question[]): Question[] {
  // 按 group 分桶（保持原始顺序）
  const groups = new Map<string, Question[]>();
  const loose: Question[] = [];
  for (const q of questions) {
    if (q.group) {
      const arr = groups.get(q.group) ?? [];
      arr.push(q);
      groups.set(q.group, arr);
    } else {
      loose.push(q);
    }
  }
  // 轮流穿插：每轮从各活跃组各取一题
  const result: Question[] = [];
  const keys = [...groups.keys()];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const key of keys) {
      const arr = groups.get(key)!;
      if (arr.length) {
        result.push(arr.shift()!);
        progressed = true;
      }
    }
    // 穿插一道无组题（如有）
    if (loose.length) result.push(loose.shift()!);
  }
  return result;
}
