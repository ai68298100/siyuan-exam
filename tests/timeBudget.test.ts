import { describe, it, expect } from "vitest";
import { avgMsByType, estimatePlanMinutes, DEFAULT_TYPE_MS } from "../src/core/timeBudget";
import { makeQuestion } from "../src/core/blockTemplate";
import type { AttemptEvent, Question } from "../src/core/types";

const q = (id: string, type: Question["type"], group?: string): Question =>
  ({ ...makeQuestion({ type, stem: id, options: type === "single" ? ["1", "2"] : [], answer: "A" }), id, group });

const ev = (qid: string, timeMs: number | null): AttemptEvent =>
  ({
    v: 2, eid: `e-${qid}-${timeMs}`, ts: 1, qid, kind: "practice", mode: "single",
    verdict: "correct", myAnswer: "A", sessionId: "s1", queue: "normal", device: "d", seq: 1,
    ...(timeMs != null ? { timeMs } : {}),
  }) as AttemptEvent;

describe("每日时间预算（53-01 lite，廿九批）", () => {
  it("avgMsByType：题型中位数、单样本题型不产出、挂机超长截断", () => {
    const typeOf = (qid: string) => (qid.startsWith("j") ? "judge" : qid.startsWith("s") ? "short" : undefined);
    const events = [
      ev("j1", 20_000), ev("j2", 40_000), ev("j3", 900_000), // 90 万 ms 挂机 → 截断 60 万 → 中位 40s
      ev("s1", 120_000),                                      // 短答只有 1 个样本 → 不产出
      ev("j1", null),                                         // 无用时事件跳过
    ];
    const avg = avgMsByType(events, typeOf);
    expect(avg.judge).toBe(40_000);
    expect(avg.short).toBeUndefined();
  });

  it("estimatePlanMinutes：有历史用历史，缺历史回落默认并标注 sourced=false", () => {
    const queue = [q("a", "judge"), q("b", "material")];
    const r1 = estimatePlanMinutes(queue, { judge: 30_000, material: 100_000 });
    expect(r1.sourced).toBe(true);
    expect(r1.minutes).toBe(Math.round((30_000 + 100_000 * 1.6) / 60_000)); // 材料读题加权
    const r2 = estimatePlanMinutes([q("c", "short"), q("d", "short"), q("e", "short")], {});
    expect(r2.sourced).toBe(false);
    expect(r2.minutes).toBe(Math.round((DEFAULT_TYPE_MS.short * 3) / 60_000));
    expect(r2.low).toBeLessThan(r2.minutes);
    expect(r2.high).toBeGreaterThan(r2.minutes);
  });

  it("空计划：1 分钟下限（避免显示 0 误导）", () => {
    const r = estimatePlanMinutes([], { judge: 30_000 });
    expect(r.minutes).toBeGreaterThanOrEqual(1);
    expect(r.sourced).toBe(true);
  });
});
