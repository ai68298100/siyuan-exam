import { describe, it, expect } from "vitest";
import { weeklyAggregates, weekCompare, dailyDocPath } from "../src/core/weekly";
import type { ReplayResult } from "../src/core/types";

const NOW = new Date(2026, 9, 2); // 2026-10-02 周五
const days = (() => {
  const m = new Map<string, ReplayResult["days"] extends Map<string, infer V> ? V : never>();
  return m;
})() as ReplayResult["days"];

function setDay(offsetDays: number, attempts: number, correct: number) {
  const d = new Date(2026, 9, 2 - offsetDays);
  const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  days.set(k, { date: k, attempts, correct });
}

describe("周聚合", () => {
  it("本周与上周各自聚合，对比可取", () => {
    setDay(0, 10, 8); // 本周五
    setDay(1, 5, 4); // 本周四
    setDay(7, 20, 15); // 上周五
    const weeks = weeklyAggregates(days, NOW, 2);
    expect(weeks).toHaveLength(2);
    expect(weeks.map((w) => w.attempts).sort((a, b) => a - b)).toEqual([15, 20]);
    const cmp = weekCompare(weeks)!;
    expect(cmp.thisWeek.attempts + cmp.lastWeek.attempts).toBe(35);
    const newer = Math.max(cmp.thisWeek.attempts, cmp.lastWeek.attempts);
    expect(newer).toBe(20);
  });
});

describe("每日笔记路径", () => {
  it("模板含日期 token → 替换", () => {
    expect(dailyDocPath('/Diary/{{now | date "%Y-%m-%d"}}', NOW)).toBe("/Diary/2026-10-02");
  });
  it("无 token → 追加 ymd", () => {
    expect(dailyDocPath("/Diary", NOW)).toBe("/Diary/2026-10-02");
  });
});
