import { describe, it, expect } from "vitest";
import { buildPublicStats } from "../src/core/publicStats";
import type { AttemptEvent, ReplayResult } from "../src/core/types";

const NOW = new Date(2026, 9, 2, 14, 30).getTime();
const ev = (i: number, qid: string, verdict: "correct" | "wrong", hour: number): AttemptEvent => ({
  v: 1, eid: "e" + i, ts: new Date(2026, 9, 2 - (i % 3), hour).getTime(), qid,
  kind: "practice", mode: "single", verdict, myAnswer: null,
  sessionId: "s", examId: null, queue: "normal", device: "d", seq: i,
});

function derived(events: AttemptEvent[]): ReplayResult {
  const byQuestion = new Map<string, { attempts: number; correct: number; lastAt: number }>();
  const wrongbook = new Map<string, any>();
  const days = new Map<string, any>();
  for (const e of events) {
    const d = new Date(e.ts);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const v = days.get(k) ?? { date: k, attempts: 0, correct: 0 };
    if (e.verdict !== "not_attempted") { v.attempts++; if (e.verdict === "correct") v.correct++; }
    days.set(k, v);
    const s = byQuestion.get(e.qid) ?? { attempts: 0, correct: 0, lastAt: 0 };
    s.attempts++; if (e.verdict === "correct") s.correct++;
    byQuestion.set(e.qid, s);
  }
  return { wrongbook, byQuestion, days, reciteStreak: new Map(), skipped: 0, clockAnomalies: 0 };
}

describe("公开只读数据接口（脱敏契约）", () => {
  it("聚合字段齐全且不含题目内容/路径/key", () => {
    const events = [
      ev(0, "q1", "correct", 8),
      ev(1, "q2", "wrong", 21),
    ];
    const stats = buildPublicStats(derived(events), events, 5, NOW);
    expect(stats.version).toBe(1);
    expect(stats.attempts).toBe(2);
    expect(stats.accuracy).toBe(50);
    expect(stats.eliminated).toBe(0);
    expect(stats.activeWrong).toBe(0);
    expect(stats.streak).toBe(5);
    expect(stats.hours).toHaveLength(24);
    expect(stats.hours[8]).toBe(1);
    expect(stats.hours[21]).toBe(1);
    expect(stats.daily.length).toBeGreaterThan(0);
    const json = JSON.stringify(stats);
    expect(json).not.toContain("qid");
    expect(json).not.toContain("stem");
    expect(json).not.toContain("key");
    expect(json).not.toContain("path");
  });
  it("无事件 → 零值", () => {
    const stats = buildPublicStats(derived([]), [], 0, NOW);
    expect(stats.attempts).toBe(0);
    expect(stats.hours.every((h) => h === 0)).toBe(true);
  });
});
