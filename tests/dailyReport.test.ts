import { describe, expect, it, vi } from "vitest";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";

describe("今日战报", () => {
  it("只统计当前库本地今日作答，并保留跨日错题的消灭状态", async () => {
    let now = new Date(2026, 9, 10, 23, 58).getTime();
    const write = vi.fn(async () => "block-report");
    const client = {
      listQuestions: async (bank: string) => bank === "bank-a" ? [{ id: "q-a" }] : [{ id: "q-b" }],
      getNotebookConf: async () => ({ dailyNoteSavePath: "/daily" }),
      sql: async () => [{ id: "daily-doc" }],
      appendBlock: write,
    } as unknown as KernelApiClient;
    const app = new ExamApp({ client, storage: new MemoryStorage(), now: () => now });
    app.listBanks = () => [{ id: "bank-a", name: "库甲", createdAt: now }];
    await app.attempts.load("test-device");
    const answer = (qid: string, verdict: "wrong" | "correct") => app.attempts.append({ qid, verdict, kind: "practice", mode: "quick", myAnswer: "A", sessionId: "test" });
    answer("q-a", "wrong");
    now = new Date(2026, 9, 11, 0, 1).getTime();
    answer("q-a", "correct");
    answer("q-a", "correct");
    answer("q-b", "wrong");
    await app.writeDailyReport("bank-a", "库甲");
    const text = write.mock.calls[0][1];
    expect(text).toContain("2026-10-11");
    expect(text).toContain("刷题：**2** 题 · 正确率 **100%**");
    expect(text).toContain("今日新消灭错题：**1**");
    expect(text).toContain("题库：库甲");
  });

  it("当前库今日无作答时不混入昨天和其他库记录", async () => {
    let now = new Date(2026, 9, 10, 22).getTime();
    const write = vi.fn(async () => "block-report");
    const app = new ExamApp({ client: {
      listQuestions: async () => [{ id: "q-a" }], getNotebookConf: async () => ({ dailyNoteSavePath: "/daily" }),
      sql: async () => [{ id: "daily-doc" }], appendBlock: write,
    } as unknown as KernelApiClient, storage: new MemoryStorage(), now: () => now });
    app.listBanks = () => [{ id: "bank-a", name: "库甲", createdAt: now }];
    await app.attempts.load("test-device");
    app.attempts.append({ qid: "q-a", kind: "practice", mode: "quick", verdict: "correct", myAnswer: "A", sessionId: "s" });
    now = new Date(2026, 9, 11, 15).getTime();
    app.attempts.append({ qid: "q-b", kind: "practice", mode: "quick", verdict: "correct", myAnswer: "A", sessionId: "s" });
    await app.writeDailyReport("bank-a", "库甲");
    expect(write.mock.calls[0][1]).toContain("刷题：**0** 题");
  });
});
