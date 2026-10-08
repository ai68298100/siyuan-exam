import { describe, it, expect } from "vitest";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import { KernelApiClient } from "../src/kernel/client";
import type { Question } from "../src/core/types";
import { makeQuestion } from "../src/core/blockTemplate";

/**
 * stub 内核：sql 按 stmt 内 LIMIT/OFFSET 切片返回批次块（真实分页语义），
 * removeBlock 记录调用并可注入失败。挂到 KernelApiClient.prototype 上，
 * 让真实的 sqlPaged 循环跑在 stub sql 之上。
 */
function stubClient(batchBlocks: string[], failIds: Set<string> = new Set()) {
  const removed: string[] = [];
  const sqlCalls: string[] = [];
  const client = Object.create(KernelApiClient.prototype) as KernelApiClient;
  Object.assign(client, {
    sql: async (stmt: string) => {
      sqlCalls.push(stmt);
      if (stmt.includes("custom-exam-batch")) {
        // 校验转义：单引号批次必须被转义后才能进 SQL
        expect(stmt).not.toContain("b-'x");
        const m = /LIMIT (\d+) OFFSET (\d+)/.exec(stmt);
        if (!m) return batchBlocks.map((id) => ({ id }));
        const size = Number(m[1]);
        const off = Number(m[2]);
        return batchBlocks.slice(off, off + size).map((id) => ({ id }));
      }
      return [];
    },
    removeBlock: async (id: string) => {
      if (failIds.has(id)) throw new Error("delete failed");
      removed.push(id);
    },
  });
  return { client, removed, sqlCalls };
}

const mkApp = (client: KernelApiClient, kernelOnline: boolean) => {
  const app = new ExamApp({ client, storage: new MemoryStorage(), now: () => 1_800_000_000_000 });
  app.kernelOnline = kernelOnline;
  return app;
};

describe("导入批次回滚（TODO 12 组）", () => {
  const qs: (Question & { batch?: string })[] = [
    { ...makeQuestion({ type: "single", stem: "a", options: ["1", "2"], answer: "A" }), batch: "b-20261003-aaaa" },
    { ...makeQuestion({ type: "single", stem: "b", options: ["1", "2"], answer: "A" }), batch: "b-20261003-aaaa" },
    { ...makeQuestion({ type: "single", stem: "c", options: ["1", "2"], answer: "A" }), batch: "b-20261003-bbbb" },
    { ...makeQuestion({ type: "single", stem: "d", options: ["1", "2"], answer: "A" }) }, // 手工录入无批次
  ];

  it("listBatches：仅统计 imported 批次，新→旧；手工录题不计", () => {
    const { client } = stubClient([]);
    const app = mkApp(client, true);
    const imported = qs.slice(0, 3).map((q) => ({ ...q, origin: "imported" as const }));
    const list = app.listBatches(imported);
    expect(list).toEqual([
      { batch: "b-20261003-bbbb", count: 1 },
      { batch: "b-20261003-aaaa", count: 2 },
    ]);
    // 手工录入（origin=manual）不进批次清单
    const manual = app.listBatches(qs.map((q) => ({ ...q, origin: "manual" as const })));
    expect(manual).toHaveLength(0);
  });

  it("rollbackBatch：逐块删除并返回回执；失败块计数不中断", async () => {
    const { client, removed } = stubClient(["blk-1", "blk-2", "blk-3"], new Set(["blk-2"]));
    const app = mkApp(client, true);
    const r = await app.rollbackBatch("bank1", "b-20261003-aaaa");
    expect(r).toEqual({ deleted: 2, failed: 1 });
    expect(removed).toEqual(["blk-1", "blk-3"]);
  });

  it("离线兜底：直接拒绝，不发删除请求", async () => {
    const { client, removed } = stubClient(["blk-1"]);
    const app = mkApp(client, false);
    await expect(app.rollbackBatch("bank1", "b-x")).rejects.toThrow("离线");
    expect(removed).toHaveLength(0);
  });

  it("大批次跨页取全（3.8.6 无 LIMIT 默认截断 64 行）：2500 块分 3 页全部删除，不漏删", async () => {
    const pool = Array.from({ length: 2500 }, (_, i) => `blk-${i}`);
    const { client, removed, sqlCalls } = stubClient(pool);
    const app = mkApp(client, true);
    const r = await app.rollbackBatch("bank1", "b-20261003-aaaa");
    expect(r).toEqual({ deleted: 2500, failed: 0 });
    expect(removed).toHaveLength(2500);
    expect(new Set(removed).size).toBe(2500);
    // sqlPaged 分页：1000+1000+500 三页，均带 SQL 文本级 LIMIT/OFFSET
    expect(sqlCalls.length).toBe(3);
    expect(sqlCalls.every((s) => /LIMIT 1000 OFFSET \d+/.test(s))).toBe(true);
  });
});
