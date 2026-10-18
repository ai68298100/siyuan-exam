import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextPlanTrace, type PlanTrace } from "../src/core/planner";
import { emitExamEvent, onExamEvent, type BusEvent } from "../src/core/bus";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";
import { PracticeSession } from "../src/core/session";
import { makeQuestion } from "../src/core/blockTemplate";

/** node 测试环境无 window：用 EventTarget 桩（与 bus.test.ts 同法） */
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget() as unknown as Window & typeof globalThis);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("44-05 昨日计划回看轨迹（四四批）", () => {
  const trace = (over: Partial<PlanTrace>): PlanTrace => ({
    date: "2026-10-03",
    planned: 10,
    done: 0,
    absentStreak: 0,
    ...over,
  });

  it("昨日有计划零完成 → 缺席 +1；有完成 → 归零", () => {
    const r1 = nextPlanTrace(trace({ absentStreak: 2 }), "2026-10-04", 10, 0);
    expect(r1.absentStreak).toBe(3);
    const r2 = nextPlanTrace(trace({ absentStreak: 2, planned: 0 }), "2026-10-04", 10, 0);
    expect(r2.absentStreak).toBe(0); // 昨日无计划 → 不计缺席
    const r3 = nextPlanTrace(trace({ absentStreak: 2 }), "2026-10-04", 10, 4);
    expect(r3.absentStreak).toBe(0); // 昨日有完成 → 归零
  });

  it("链断（prev 非昨日）→ 归零重新计；首日 prev=null → 0", () => {
    expect(nextPlanTrace(trace({ date: "2026-10-01", absentStreak: 5 }), "2026-10-04", 10, 0).absentStreak).toBe(0);
    expect(nextPlanTrace(null, "2026-10-04", 10, 0).absentStreak).toBe(0);
  });
});

describe("48-02 补全：session-ended / wrongbook-changed 事件（四四批）", () => {
  it("session-ended 信封 payload 仅计数（无题干）", () => {
    let got: BusEvent<{ sessionId: string; mode: string; total: number; correct: number; wrong: number }> | null = null;
    const off = onExamEvent("session-ended", (env) => { got = env; });
    emitExamEvent("session-ended", { sessionId: "s1", mode: "quick", total: 10, correct: 8, wrong: 2 });
    expect(got!.payload).toEqual({ sessionId: "s1", mode: "quick", total: 10, correct: 8, wrong: 2 });
    expect(JSON.stringify(got)).not.toContain("题干");
    off();
  });

  it("ExamApp.setWrongStatus / snoozeWrong 发射 wrongbook-changed", async () => {
    const app = new ExamApp({
      client: { sql: async () => [] } as unknown as KernelApiClient,
      storage: new MemoryStorage(),
      now: () => 1_800_000_000_000,
    });
    const seen: { qid: string; status: string }[] = [];
    const off = onExamEvent<{ qid: string; status: string }>("wrongbook-changed", (env) => seen.push(env.payload));
    await app.setWrongStatus("q1", "mastered");
    await app.snoozeWrong("q2", 7);
    expect(seen).toEqual([
      { qid: "q1", status: "mastered" },
      { qid: "q2", status: "snoozed" },
    ]);
    off();
  });
});

describe("44-04 会话延迟回炉错题策略与回忆事件标记（四四批）", () => {
  it("错题进入队尾回炉，准确标识 attemptIndex 与 isDelayedReview", () => {
    const q1 = makeQuestion({ type: "single", stem: "题1", options: ["A", "B"], answer: "A" });
    const q2 = makeQuestion({ type: "single", stem: "题2", options: ["A", "B"], answer: "B" });
    const session = new PracticeSession([q1, q2], "quick");

    // 1. 第一题初答答错
    expect(session.isDelayedReviewAtCurrent()).toBe(false);
    expect(session.currentAttemptIndex()).toBe(0);
    const r1 = session.submit("B"); // 错误
    expect(r1).not.toBeNull();
    expect(r1?.attemptIndex).toBe(0);
    expect(r1?.isDelayedReview).toBe(false);
    expect(session.state.qids).toEqual([q1.id, q2.id, q1.id]); // 队尾追加错题回炉

    // 2. 第二题初答答对
    expect(session.next()).toBe(true);
    expect(session.isDelayedReviewAtCurrent()).toBe(false);
    expect(session.currentAttemptIndex()).toBe(0);
    const r2 = session.submit("B"); // 正确
    expect(r2).not.toBeNull();
    expect(r2?.attemptIndex).toBe(0);
    expect(r2?.isDelayedReview).toBe(false);

    // 3. 进入队尾回炉题（第一题延迟重测）
    expect(session.next()).toBe(true);
    expect(session.isDelayedReviewAtCurrent()).toBe(true);
    expect(session.currentAttemptIndex()).toBe(1);
    const r3 = session.submit("A"); // 延迟无提示回忆答对
    expect(r3).not.toBeNull();
    expect(r3?.attemptIndex).toBe(1);
    expect(r3?.isDelayedReview).toBe(true);
    expect(session.state.answered?.[2].delayedReview).toBe(true);

    // 4. 结算指标：基础统计与细分初答/回炉消灭
    const summary = session.finish();
    expect(summary).toEqual({ total: 3, correct: 2, wrong: 1 });

    const breakdown = session.breakdown();
    expect(breakdown.initialTotal).toBe(2);
    expect(breakdown.initialCorrect).toBe(1);
    expect(breakdown.delayedTotal).toBe(1);
    expect(breakdown.delayedRecovered).toBe(1);
  });

  it("作答事件支持 delayedReview 标记并与 ExamApp 正常落盘", () => {
    const app = new ExamApp({
      client: { sql: async () => [] } as unknown as KernelApiClient,
      storage: new MemoryStorage(),
      now: () => 1_800_000_000_000,
    });

    const event = app.recordAttempt({
      qid: "q-delayed-1",
      kind: "practice",
      mode: "quick",
      verdict: "correct",
      myAnswer: "A",
      sessionId: "s-1",
      queue: "normal",
      delayedReview: true,
    });

    expect(event.delayedReview).toBe(true);
    const retrieved = app.attempts.all().find((e) => e.qid === "q-delayed-1");
    expect(retrieved?.delayedReview).toBe(true);
  });
});
