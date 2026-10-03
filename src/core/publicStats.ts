// ============================================================
// 公开只读数据接口（TODO 21 组）：lv-exam:stats 事件载荷构造
// 其他插件（如小驴复盘）可监听 window "lv-exam:stats" 只读聚合，
// 永不暴露题目内容/key/路径（26.2 脱敏契约）
// ============================================================
import type { AttemptEvent, ReplayResult } from "./types";

export interface PublicStats {
  version: 1;
  generatedAt: number;
  attempts: number; // 累计有效作答
  accuracy: number; // 0-100（整数百分比）
  eliminated: number; // 已消灭错题
  activeWrong: number; // 在册错题
  streak: number; // 连续天数
  hours: number[]; // 24 点时段分布（无题目内容）
  daily: { date: string; attempts: number; correct: number }[]; // 最近 56 天（8 周）
}

export function buildPublicStats(
  d: ReplayResult,
  events: readonly AttemptEvent[],
  streak: number,
  now: number = Date.now(),
): PublicStats {
  let attempts = 0,
    correct = 0;
  for (const s of d.byQuestion.values()) {
    attempts += s.attempts;
    correct += s.correct;
  }
  const eliminated = [...d.wrongbook.values()].filter((w) => w.status === "eliminated").length;
  const activeWrong = [...d.wrongbook.values()].filter((w) => w.status === "active").length;
  const hours = new Array(24).fill(0) as number[];
  for (const e of events) {
    if (e.verdict === "not_attempted") continue;
    hours[new Date(e.ts).getHours()]++;
  }
  const daily = [...d.days.entries()]
    .map(([date, v]) => ({ date, attempts: v.attempts, correct: v.correct }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-56);
  return {
    version: 1,
    generatedAt: now,
    attempts,
    accuracy: attempts ? Math.round((correct / attempts) * 100) : 0,
    eliminated,
    activeWrong,
    streak,
    hours,
    daily,
  };
}
