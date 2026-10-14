import { describe, expect, it } from "vitest";
import { ExamApp, type MockRecord } from "../src/app";
import type { StorageAdapter } from "../src/core/attemptLog";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 模拟 plugin.saveData 的异步写入，并复制载荷避免引用别名掩盖竞态。 */
class SlowStorage implements StorageAdapter {
  readonly map = new Map<string, unknown>();
  async load(key: string): Promise<unknown> {
    const value = this.map.get(key);
    return value == null ? value : structuredClone(value);
  }
  async save(key: string, value: unknown): Promise<void> {
    await pause(5);
    this.map.set(key, structuredClone(value));
  }
}

function appWith(storage = new SlowStorage()) {
  return { app: new ExamApp({ client: {} as any, storage }), storage };
}

describe("ExamApp 持久化并发保护", () => {
  it("错因/复盘并发写入保留每个题目的最新快照", async () => {
    const { app, storage } = appWith();
    await Promise.all([
      app.saveWrongReason("q1", "careless"),
      app.saveWrongReason("q2", "trap"),
      app.saveWrongReflection("q1", "先圈关键词"),
      app.saveWrongReflection("q2", "区分定义"),
    ]);
    expect(storage.map.get("wrongbook/reasons")).toMatchObject({
      q1: { reason: "careless" },
      q2: { reason: "trap" },
    });
    expect(storage.map.get("wrongbook/reflections")).toMatchObject({
      q1: { text: "先圈关键词" },
      q2: { text: "区分定义" },
    });
  });

  it("AI 用量与估分并发累计不丢更新", async () => {
    const { app, storage } = appWith();
    await Promise.all([
      app.recordAiUsage("a", 100, 1),
      app.recordAiUsage("b", 200, 2),
      app.saveEstimate({ key: "a", mine: "A", percent: 50, score: 1, total: 2 }),
      app.saveEstimate({ key: "b", mine: "B", percent: 75, score: 3, total: 4 }),
    ]);
    expect(storage.map.get("ai/usage")).toMatchObject({ totalTokens: 300, totalCalls: 3 });
    expect(storage.map.get("estimate/history")).toHaveLength(2);
  });

  it("模考成绩并发写入保留不同 run，重复 run 仍幂等覆盖", async () => {
    const { app } = appWith();
    const base = (runId: string, percent: number): MockRecord => ({
      id: "paper",
      runId,
      name: "示例卷",
      startedAt: 1,
      total: 10,
      full: 10,
      percent,
      pass: percent >= 60,
    });
    await Promise.all([app.saveMockResult(base("r1", 50)), app.saveMockResult(base("r2", 70))]);
    expect((await app.listMockResults()).map((r) => r.runId).sort()).toEqual(["r1", "r2"]);
    await Promise.all([app.saveMockResult(base("r1", 60)), app.saveMockResult(base("r1", 80))]);
    const r1 = (await app.listMockResults()).filter((r) => r.runId === "r1");
    expect(r1).toHaveLength(1);
    expect(r1[0].percent).toBe(80);
  });

  it("check-in pending 采用最后一次写入，旧写入不会覆盖新状态", async () => {
    const { app } = appWith();
    const first = { externalRef: "old", date: "2026-10-14", kind: "study" } as any;
    const latest = { externalRef: "new", date: "2026-10-14", kind: "study" } as any;
    await Promise.all([app.setCheckinPending(first), app.setCheckinPending(latest)]);
    expect((await app.getCheckinPending())?.externalRef).toBe("new");
  });
});
