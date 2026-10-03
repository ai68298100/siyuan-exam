import { describe, it, expect } from "vitest";
import { uncertainCorrectList } from "../src/core/report";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";
import type { AttemptEvent } from "../src/core/types";

const ev = (over: Partial<AttemptEvent>): AttemptEvent =>
  ({
    v: 2, eid: "e", ts: 1_000, qid: "q1", kind: "practice", mode: "single",
    verdict: "correct", myAnswer: "B", sessionId: "s1", queue: "normal", device: "d", seq: 1,
    confidence: "guess",
    ...over,
  }) as AttemptEvent;

describe("uncertain-correct 下钻（44-02 对偶，三六批）", () => {
  it("只收 fuzzy/guess 的 correct；qid 去重保留最近；时间倒序", () => {
    const list = uncertainCorrectList([
      ev({ eid: "a", qid: "q1", ts: 100 }),
      ev({ eid: "b", qid: "q1", ts: 300 }),                                   // 更近 → 覆盖
      ev({ eid: "c", qid: "q2", ts: 200, confidence: "sure" }),               // 确定-对 → 排除
      ev({ eid: "d", qid: "q3", ts: 400, verdict: "wrong" as AttemptEvent["verdict"] }),
      ev({ eid: "e", qid: "q4", ts: 500, kind: "recite" }),                   // recite 不参与
      ev({ eid: "f", qid: "q5", ts: 600, confidence: "fuzzy" }),
    ]);
    expect(list.map((x) => x.qid)).toEqual(["q5", "q1"]);
    expect(list[1].confidence).toBe("guess");
  });

  it("空流水 → 空清单", () => {
    expect(uncertainCorrectList([])).toHaveLength(0);
  });
});

describe("清除插件数据（58-03 lite，三六批）", () => {
  it("逐键置空并返回回执；内存题库清空", async () => {
    const storage = new MemoryStorage();
    const app = new ExamApp({
      client: { sql: async () => [] } as unknown as KernelApiClient,
      storage,
      now: () => 1_800_000_000_000,
    });
    await storage.save("banks", [{ id: "b1", name: "x", createdAt: 1 }]);
    await storage.save("mock/results", [{ id: "m1" }]);
    const receipts = await app.purgeAllData();
    expect(receipts.length).toBeGreaterThanOrEqual(15);
    expect(receipts.every((r) => r.ok)).toBe(true);
    expect(await storage.load("banks")).toBeNull();
    expect(await storage.load("mock/results")).toBeNull();
    expect(app.listBanks()).toHaveLength(0); // 内存同步清空
  });
});
