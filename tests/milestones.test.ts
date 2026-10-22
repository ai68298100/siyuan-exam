import { describe, it, expect } from "vitest";
import type { AttemptEvent, Question, WrongItem } from "../src/core/types";
import { calculateMilestones, exportMilestoneBadgeWallMarkdown } from "../src/core/milestones";

describe("备考里程碑与荣誉勋章系统 (milestones)", () => {
  const dummyQuestions: Question[] = Array.from({ length: 60 }, (_, i) => ({
    id: `q-${i}`,
    type: "single",
    stem: `题干 ${i}`,
    options: ["A", "B"],
    answer: "A",
  }));

  const dummyEvents: AttemptEvent[] = Array.from({ length: 120 }, (_, i) => ({
    v: 1,
    eid: `e-${i}`,
    qid: `q-${i % 60}`,
    verdict: "correct",
    ts: 1000 + i * 100,
  }));

  const dummyWrongs: WrongItem[] = [
    { qid: "q-1", status: "eliminated", wrongCount: 3, lastWrongAt: 1000 },
    { qid: "q-2", status: "active", wrongCount: 1, lastWrongAt: 2000 },
  ];

  it("计算题量、消灭错题、连续打卡与教研工匠勋章", () => {
    const overview = calculateMilestones({
      events: dummyEvents,
      questions: dummyQuestions,
      wrongItems: dummyWrongs,
      eliminatedCount: 12,
      streakDays: 8,
      mockRunCount: 4,
      readinessGrade: "A",
    });

    expect(overview.totalBadges).toBeGreaterThanOrEqual(8);
    expect(overview.unlockedCount).toBeGreaterThanOrEqual(6);
    expect(overview.overallScore).toBeGreaterThan(400);

    const firstStep = overview.badges.find((b) => b.id === "first_step");
    expect(firstStep?.unlocked).toBe(true);

    const century = overview.badges.find((b) => b.id === "century_drill");
    expect(century?.unlocked).toBe(true);

    const stubborn = overview.badges.find((b) => b.id === "stubborn_breaker");
    expect(stubborn?.unlocked).toBe(true);

    const author = overview.badges.find((b) => b.id === "curator_author");
    expect(author?.unlocked).toBe(true);
  });

  it("导出荣誉勋章墙 Markdown 手账", () => {
    const overview = calculateMilestones({
      events: dummyEvents,
      questions: dummyQuestions,
      wrongItems: dummyWrongs,
      eliminatedCount: 5,
      streakDays: 3,
      readinessGrade: "B",
    });

    const md = exportMilestoneBadgeWallMarkdown(overview);
    expect(md).toContain("个人备考荣誉勋章墙与成长里程碑");
    expect(md).toContain("荣誉总积分");
    expect(md).toContain("初心破冰");
  });
});
