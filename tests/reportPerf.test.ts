// 69-03：报告聚合套件专项基准——报告页切换日期范围/重开面板的聚合成本回归锁
// （与 perfAggregate.test.ts 互补：那边锁 replay+全套统计 <1.5s，这里锁报告页实际调用的聚合子集）
import { describe, it, expect } from "vitest";
import { hourly, calibration } from "../src/core/report";
import { quadrantReport } from "../src/core/quadrant";
import { exposureNodeCounts } from "../src/core/exposure";
import { exposureStats } from "../src/core/report";
import { weeklyAggregates, dailyTrend } from "../src/core/weekly";
import type { AttemptEvent } from "../src/core/types";
import { replay } from "../src/core/replayer";

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
      exposure: i % 5 === 0 ? ["hint", "analysis"] : undefined,
    });
  }
  return events;
}

describe("报告聚合套件基准（69-03：切日期范围应即时）", () => {
  it("万级流水：报告页全部聚合 < 300ms（含四象限/暴露/周趋势）", () => {
    const events = genEvents(10_000);
    const t0 = performance.now();
    hourly(events);
    calibration(events);
    exposureStats(events);
    quadrantReport(events.filter((e) => e.kind === "practice"), (qid) => (Number(qid.slice(-1)) % 2 ? "single" : "fill"), 7);
    const rp = replay(events);
    weeklyAggregates(rp.days);
    dailyTrend(rp.days);
    exposureNodeCounts(events);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(300);
  });

  it("重复调用命中同一纯函数路径（无隐藏每调用重初始化）——两次耗时同量级", () => {
    const events = genEvents(10_000);
    const run = () => {
      const t0 = performance.now();
      hourly(events);
      calibration(events);
      quadrantReport(events.filter((e) => e.kind === "practice"), () => "single", 0);
      return performance.now() - t0;
    };
    const first = run();
    const second = run();
    // 不做绝对值断言（CI 机器差异），只断言第二次不劣于第一次的 4 倍（排除病态退化）
    expect(second).toBeLessThan(Math.max(first * 4, 50));
  });
});
