import { describe, it, expect } from "vitest";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";
import type { SessionState } from "../src/core/types";

const DAY = 86_400_000;
const client = { sql: async () => [] } as unknown as KernelApiClient;

const app = (storage: MemoryStorage, now: number) => new ExamApp({ client, storage, now: () => now });

const savedSession = (updatedAt: number): SessionState => ({
  id: "s-old", mode: "quick", qids: ["q1", "q2"], cursor: 1,
  drafts: {}, startedAt: updatedAt - 1000, updatedAt,
});

describe("会话过期草稿（TODO 2.4：7 天隐藏 / 30 天清理）", () => {
  it("3 天内的草稿可恢复", async () => {
    const s = new MemoryStorage();
    const now = 1_800_000_000_000;
    await s.save("session/active", savedSession(now - 3 * DAY));
    const resumed = await app(s, now).resumeSession(async (qids) => qids.map((id) => ({ id, type: "single", stem: "x", options: [], answer: "A", score: 1, origin: "manual", hash: "h" }) as never));
    expect(resumed).not.toBeNull();
  });

  it("7–30 天：隐藏（返回 null，存储保留）", async () => {
    const s = new MemoryStorage();
    const now = 1_800_000_000_000;
    await s.save("session/active", savedSession(now - 10 * DAY));
    const resumed = await app(s, now).resumeSession(async () => []);
    expect(resumed).toBeNull();
    expect(s.map.get("session/active")).not.toBeNull();   // 未清理，30 天前可回看的数据仍在
  });

  it(">30 天：清理存储（流水保留语义由 attempts 独立承担）", async () => {
    const s = new MemoryStorage();
    const now = 1_800_000_000_000;
    await s.save("session/active", savedSession(now - 31 * DAY));
    const resumed = await app(s, now).resumeSession(async () => []);
    expect(resumed).toBeNull();
    expect(s.map.get("session/active")).toBeNull();
  });
});
