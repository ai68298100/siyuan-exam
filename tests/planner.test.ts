import { describe, it, expect } from "vitest";
import { daysUntil, planToday } from "../src/core/planner";
import { makeQuestion } from "../src/core/blockTemplate";
import type { Question } from "../src/core/types";

const NOW = new Date(2026, 9, 2); // 2026-10-02 本地
const qs: Question[] = [
  makeQuestion({ type: "single", stem: "A", options: ["1", "2"], answer: "A", kp: "资料" }),
  makeQuestion({ type: "single", stem: "B", options: ["1", "2"], answer: "B", kp: "言语" }),
  makeQuestion({ type: "judge", stem: "C", answer: "对", kp: "资料" }),
  makeQuestion({ type: "fill", stem: "D", answer: "x", kp: "言语" }),
];

describe("daysUntil", () => {
  it("同日 0、未来正数、过去负数", () => {
    expect(daysUntil("2026-10-02", NOW)).toBe(0);
    expect(daysUntil("2026-10-16", NOW)).toBe(14);
    expect(daysUntil("2026-09-30", NOW)).toBe(-2);
  });
  it("非法格式 → null", () => {
    expect(daysUntil("", NOW)).toBeNull();
    expect(daysUntil("abc", NOW)).toBeNull();
    expect(daysUntil("2026-13-40", NOW)).toBeNull();
  });
});

describe("planToday", () => {
  const wrongCounts = new Map([[qs[0].id, 5], [qs[1].id, 2], [qs[2].id, 1]]);
  const base = { dailyGoal: 3, all: qs, wrongCounts, activeWrongIds: new Set([qs[0].id, qs[2].id]) };

  it("冲刺姿态（距考 ≤14）：错≥2 优先占配额", () => {
    const p = planToday({ ...base, examDate: "2026-10-10" }, NOW);
    expect(p.mode).toBe("sprint");
    expect(p.daysToExam).toBe(8);
    expect(p.queue.map((q) => q.id)).toEqual([qs[0].id, qs[1].id, qs[2].id]); // 错5、错2、错1
    expect(p.reason).toContain("冲刺 D-8");
  });
  it("冲刺阈值恰好 14 天触发；15 天不触发", () => {
    expect(planToday({ ...base, examDate: "2026-10-16" }, NOW).mode).toBe("sprint");
    expect(planToday({ ...base, examDate: "2026-10-17" }, NOW).mode).toBe("normal");
  });
  it("考日已过 → 常规", () => {
    expect(planToday({ ...base, examDate: "2026-09-30" }, NOW).mode).toBe("normal");
  });
  it("常规姿态：到期优先 → 在册错题 → 随机补足", () => {
    const p = planToday({ ...base, dueFirst: [qs[3]] }, NOW);
    expect(p.mode).toBe("normal");
    expect(p.queue[0].id).toBe(qs[3].id);
    expect(p.queue).toHaveLength(3);
    expect(new Set(p.queue.map((q) => q.id)).size).toBe(3);
  });
  it("配额下限 1", () => {
    const p = planToday({ ...base, dailyGoal: 0 }, NOW);
    expect(p.queue.length).toBeGreaterThanOrEqual(1);
  });
});
