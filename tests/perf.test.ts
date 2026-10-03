// 性能基线（TODO 26.3 本地可测部分）：软上限断言，超时即回归警报
import { describe, it, expect } from "vitest";
import { replay } from "../src/core/replayer";
import { assemble, blueprintTotals } from "../src/core/mock";
import { grade } from "../src/core/answer";
import { makeQuestion } from "../src/core/blockTemplate";
import type { AttemptEvent, Question } from "../src/core/types";

const N_QUESTIONS = 5000;
const N_EVENTS = 50_000;

const bank: Question[] = Array.from({ length: N_QUESTIONS }, (_, i) =>
  makeQuestion({
    type: i % 5 === 0 ? "judge" : "single",
    stem: `题干 ${i}：某省社会消费品零售总额数据计算题……`,
    options: i % 5 === 0 ? [] : ["选项甲", "选项乙", "选项丙", "选项丁"],
    answer: i % 5 === 0 ? "对" : "B",
    kp: `模块${i % 20}/考点${i % 100}`,
  }),
);

const events: AttemptEvent[] = Array.from({ length: N_EVENTS }, (_, i) => ({
  v: 1,
  eid: `e-${i}`,
  ts: 1_700_000_000_000 + i * 1000,
  qid: `q-${i % N_QUESTIONS}`,
  kind: i % 7 === 0 ? "recite" : "practice",
  mode: "single",
  verdict: i % 3 === 0 ? "wrong" : "correct",
  myAnswer: i % 3 === 0 ? "A" : "B",
  sessionId: `s-${i % 500}`,
  examId: null,
  queue: "normal",
  device: "d-bench",
  seq: i,
}));

describe("性能基线（软上限）", () => {
  // 注：基线 ~400ms（2026-10-03 实测）；上限放宽到 5s 以吸收 guard 全量并发下的负载抖动，
  // 只作回归警报（数量级劣化才会触发），不是精确基准
  it(`重算 ${N_EVENTS} 条流水 < 5s`, () => {
    const t0 = performance.now();
    const r = replay(events);
    const ms = performance.now() - t0;
    expect(r.byQuestion.size).toBeGreaterThan(0);
    expect(ms).toBeLessThan(5000);
  });
  it(`组装 5000 题库蓝图 < 1500ms`, () => {
    const bp = {
      id: "b",
      name: "bench",
      durationS: 3600,
      passLine: 60,
      shuffleOptions: false,
      sectionTimed: false,
      sections: [{ name: "全库", count: 2000, scoreEach: 1, source: "mixed" as const, types: [] }],
    };
    const t0 = performance.now();
    const r = assemble(bp, bank);
    const ms = performance.now() - t0;
    expect(r.paper).toHaveLength(2000);
    expect(ms).toBeLessThan(1500);
  });
  it(`判分 10000 次 < 1000ms`, () => {
    const q = bank[0];
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) grade(q, "A");
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1000);
  });
  it("蓝图合计纯计算", () => {
    const bp = {
      id: "b",
      name: "x",
      durationS: 60,
      passLine: 60,
      shuffleOptions: false,
      sectionTimed: false,
      sections: [{ name: "s", count: 10, scoreEach: 2, source: "mixed" as const, types: [] }],
    };
    expect(blueprintTotals(bp)).toEqual({ questions: 10, score: 20 });
  });
});
