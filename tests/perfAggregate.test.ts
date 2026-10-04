import { describe, it, expect } from "vitest";
import { replay } from "../src/core/replayer";
import { calibration, exposureStats, delayedRecall, masteryByKp, weakTop, hourly } from "../src/core/report";
import { makeQuestion } from "../src/core/blockTemplate";
import type { AttemptEvent } from "../src/core/types";

/** 万级合成流水：500 题 × ~20 次作答，跨度 180 天，判定/信心/受助/先回忆混合 */
function genEvents(n = 10_000): AttemptEvent[] {
  const events: AttemptEvent[] = [];
  const start = Date.now() - 180 * 86_400_000;
  for (let i = 0; i < n; i++) {
    const qid = `q-perf${String(i % 500).padStart(3, "0")}`;
    const verdict = i % 3 === 0 ? "wrong" : "correct";
    events.push({
      eid: `e-perf-${i}`,
      qid,
      kind: i % 7 === 0 ? "mock" : "practice",
      mode: i % 7 === 0 ? "paper" : "daily",
      verdict,
      myAnswer: verdict === "correct" ? "A" : "B",
      ts: start + Math.floor((i / n) * 180) * 86_400_000 + (i % 86_400),
      timeMs: 8_000 + (i % 30) * 1_000,
      sessionId: "s-perf",
      device: "d-perf",
      seq: i,
      confidence: i % 4 === 0 ? "sure" : i % 4 === 1 ? "fuzzy" : i % 4 === 2 ? "guess" : undefined,
      help: i % 11 === 0 ? "hint" : undefined,
      recall: i % 13 === 0 ? true : undefined,
    });
  }
  return events;
}

describe("性能回归锁（万级流水，guard 口径外的预算断言）", () => {
  it("10k 事件：replay < 1.5s；报告聚合全套 < 1.5s", () => {
    const events = genEvents();
    expect(events.length).toBe(10_000);
    const t0 = performance.now();
    const d = replay(events);
    const t1 = performance.now();
    // 报告聚合全套（报告中心一次刷新的全部口径）
    calibration(events);
    exposureStats(events);
    delayedRecall(events);
    hourly(events);
    const questions = Array.from({ length: 500 }, (_, i) =>
      makeQuestion({ id: `q-perf${String(i).padStart(3, "0")}`, type: "single", stem: `S${i}`, options: ["a", "b"], answer: "A", kp: `考点/${i % 40}` }),
    );
    const mast = masteryByKp(questions, d.byQuestion, events);
    weakTop(mast, 10);
    const t2 = performance.now();
    // 语义抽查：回放确实吃满了数据（不是空转）
    expect(d.byQuestion.size).toBe(500);
    expect(d.wrongbook.size).toBeGreaterThan(0);
    // 预算（CI 单核放宽余量；回归到秒级必炸）
    expect(t1 - t0).toBeLessThan(1500);
    expect(t2 - t1).toBeLessThan(1500);
  }, 20_000);
});
