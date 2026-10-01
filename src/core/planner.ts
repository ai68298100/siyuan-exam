// ============================================================
// 备考计划引擎（v0.5）：考试倒计时 / 冲刺姿态 / 每日任务聚合
// 纯函数；时区取本地；多题库由调用方传"最近考日"（docs/10 导航原则 #4）
// ============================================================
import type { Question } from "./types";

const DAY_MS = 86400000;

/** 自然日差（本地时区）：exam - today，负数=已过期；格式非法返回 null */
export function daysUntil(examDate: string, now: Date = new Date()): number | null {
  const parts = examDate.trim().split("-").map((s) => parseInt(s, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, mo, d] = parts;
  if (y < 2000 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const exam = new Date(y, mo - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = exam.getTime() - today.getTime();
  return Math.round(diffMs / DAY_MS);
}

export interface PlanInput {
  examDate?: string;            // YYYY-MM-DD（未设 = 常规模式）
  sprintDays?: number;          // 冲刺姿态阈值，默认 14
  dailyGoal: number;            // 每日配额
  all: Question[];
  wrongCounts: Map<string, number>;   // 全库错次（含已消灭历史）
  activeWrongIds: Set<string>;        // 当前错题本在册
  dueFirst?: Question[];              // FSRS 到期（有卡才有；无卡传空）
  rnd?: () => number;
}

export interface PlanResult {
  mode: "sprint" | "normal";
  daysToExam: number | null;
  queue: Question[];
  /** 聚合说明（入口页展示"为什么是这些题"） */
  reason: string;
}

/**
 * 每日任务聚合规则（PRD §6.10 修订版）：
 * - 冲刺姿态（距考 ≤ sprintDays）：cram 队列（错≥2，按错次排序）优先占满配额，不足补每日一练（到期→高频错→随机）
 * - 常规姿态：到期优先 → 在册错题 → 随机补足
 * - 考日已过：回常规姿态（考后恢复）
 */
export function planToday(input: PlanInput, now: Date = new Date()): PlanResult {
  const { examDate, sprintDays = 14, dailyGoal, all, wrongCounts, activeWrongIds, dueFirst = [] } = input;
  const rnd = input.rnd ?? Math.random;
  const days = examDate ? daysUntil(examDate, now) : null;
  const sprint = days != null && days >= 0 && days <= sprintDays;

  const quota = Math.max(1, dailyGoal);
  const seen = new Set<string>();
  const queue: Question[] = [];
  const push = (q: Question) => { if (queue.length < quota && !seen.has(q.id)) { seen.add(q.id); queue.push(q); } };

  let cramUsed = 0;
  if (sprint) {
    const cram = all
      .filter((q) => (wrongCounts.get(q.id) ?? 0) >= 2)
      .sort((a, b) => (wrongCounts.get(b.id) ?? 0) - (wrongCounts.get(a.id) ?? 0));
    for (const q of cram) {
      if (queue.length >= quota) break;
      push(q);
      if (queue[queue.length - 1]?.id === q.id) cramUsed++;
    }
  }
  dueFirst.forEach(push);
  const activeWrong = shuffle(all.filter((q) => activeWrongIds.has(q.id)), rnd);
  activeWrong.forEach(push);
  const rest = shuffle(all.filter((q) => !seen.has(q.id)), rnd);
  rest.forEach(push);

  const reason = sprint
    ? `冲刺 D-${days}：错≥2 优先（${cramUsed} 题）+ 补足`
    : dueFirst.length
      ? `到期 ${Math.min(dueFirst.length, queue.length)} 优先 + 每日补足`
      : `在册错题优先 + 随机补足`;
  return { mode: sprint ? "sprint" : "normal", daysToExam: days, queue, reason };
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
