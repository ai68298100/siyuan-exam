// ============================================================
// 备考计划引擎（v0.5）：考试倒计时 / 冲刺姿态 / 每日任务聚合
// 纯函数；时区取本地；多题库由调用方传"最近考日"（docs/10 导航原则 #4）
// ============================================================
import type { Question } from "./types";

const DAY_MS = 86400000;

/** 错因权重（练题狗范式：知识不会 > 陷阱 > 粗心；加权回流排序用） */
export const REASON_WEIGHT: Record<"careless" | "unknown" | "trap", number> = {
  careless: 1.2,
  trap: 1.6,
  unknown: 2.0,
};

/** 自然日差（本地时区）：exam - today，负数=已过期；格式非法返回 null */
export function daysUntil(examDate: string, now: Date = new Date()): number | null {
  const parts = examDate
    .trim()
    .split("-")
    .map((s) => parseInt(s, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, mo, d] = parts;
  if (y < 2000 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const exam = new Date(y, mo - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = exam.getTime() - today.getTime();
  return Math.round(diffMs / DAY_MS);
}

export interface PlanInput {
  examDate?: string; // YYYY-MM-DD（未设 = 常规模式）
  sprintDays?: number; // 冲刺姿态阈值，默认 14
  dailyGoal: number; // 每日配额
  all: Question[];
  wrongCounts: Map<string, number>; // 全库错次（含已消灭历史）
  activeWrongIds: Set<string>; // 当前错题本在册
  wrongReasons?: Map<string, "careless" | "unknown" | "trap">; // 错因（加权回流）
  dueFirst?: Question[]; // FSRS 到期（有卡才有；无卡传空）
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
 * 每日任务聚合规则（PRD §6.10 修订版 + 练题狗加权回流）：
 * - 冲刺姿态（距考 ≤ sprintDays）：cram 队列（错≥2，按 错次×错因权重 排序）优先占满配额，不足补每日一练（到期→高频错→随机）
 * - 常规姿态：到期优先 → 在册错题（按 错次×错因权重 加权排序，知识不会最优先）→ 随机补足
 * - 考日已过：回常规姿态（考后恢复）
 */
export function planToday(input: PlanInput, now: Date = new Date()): PlanResult {
  const { examDate, sprintDays = 14, dailyGoal, all, wrongCounts, activeWrongIds, dueFirst = [] } = input;
  const reasons = input.wrongReasons;
  const rnd = input.rnd ?? Math.random;
  const days = examDate ? daysUntil(examDate, now) : null;
  const sprint = days != null && days >= 0 && days <= sprintDays;

  const quota = Math.max(1, dailyGoal);
  const seen = new Set<string>();
  const queue: Question[] = [];
  const push = (q: Question) => {
    if (queue.length < quota && !seen.has(q.id)) {
      seen.add(q.id);
      queue.push(q);
    }
  };

  /** 回流权重：错次 × 错因系数（知识不会 2.0 / 陷阱 1.6 / 粗心 1.2；未知错因取粗心档） */
  const weight = (qid: string) => {
    const reason = reasons?.get(qid) ?? "careless";
    return (wrongCounts.get(qid) ?? 1) * REASON_WEIGHT[reason];
  };

  let cramUsed = 0;
  let stubborn = 0;
  if (sprint) {
    const cram = all
      .filter((q) => (wrongCounts.get(q.id) ?? 0) >= 2)
      .sort((a, b) => weight(b.id) - weight(a.id) || (wrongCounts.get(b.id) ?? 0) - (wrongCounts.get(a.id) ?? 0));
    for (const q of cram) {
      if (queue.length >= quota) break;
      push(q);
      if (queue[queue.length - 1]?.id === q.id) cramUsed++;
    }
    stubborn = cram.filter((q) => (reasons?.get(q.id) ?? "careless") !== "careless").length;
  }
  dueFirst.forEach(push);
  // 在册错题：加权排序替代随机（同权重内部仍随机打散）
  const activeWrong = all
    .filter((q) => activeWrongIds.has(q.id))
    .map((q) => ({ q, w: weight(q.id) }))
    .sort((a, b) => b.w - a.w || rnd() - 0.5)
    .map((e) => e.q);
  activeWrong.forEach(push);
  if (!sprint) stubborn = all.filter((q) => activeWrongIds.has(q.id) && weight(q.id) >= 3.2).length;
  const rest = shuffle(
    all.filter((q) => !seen.has(q.id)),
    rnd,
  );
  rest.forEach(push);

  const reason = sprint
    ? `冲刺 D-${days}：顽固回流优先（${cramUsed} 题${stubborn ? ` · 顽固 ${stubborn}` : ""}）+ 补足`
    : dueFirst.length
      ? `到期 ${Math.min(dueFirst.length, queue.length)} 优先 + 每日补足`
      : `错题加权回流${stubborn ? `（顽固 ${stubborn}）` : ""} + 随机补足`;
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
