import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextPlanTrace, type PlanTrace } from "../src/core/planner";
import { emitExamEvent, onExamEvent, type BusEvent } from "../src/core/bus";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";

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
