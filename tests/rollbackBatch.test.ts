import { describe, it, expect } from "vitest";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";
import type { Question } from "../src/core/types";
import { makeQuestion } from "../src/core/blockTemplate";

/** stub 内核：sql 返回批次块；removeBlock 记录调用并可注入失败 */
function stubClient(batchBlocks: string[], failIds: Set<string> = new Set()) {
  const removed: string[] = [];
  const client = {
    sql: async (stmt: string) => {
      if (stmt.includes("custom-exam-batch")) {
        // 校验转义：单引号批次必须被转义后才能进 SQL
        expect(stmt).not.toContain("b-'x");
        return batchBlocks.map((id) => ({ id }));
      }
      return [];
    },
    removeBlock: async (id: string) => {
      if (failIds.has(id)) throw new Error("delete failed");
      removed.push(id);
    },
  } as unknown as KernelApiClient;
  return { client, removed };
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
});
