import { describe, it, expect } from "vitest";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";
import type { Question } from "../src/core/types";
import { makeQuestion } from "../src/core/blockTemplate";
import type { ImportReport } from "../src/importer/pipeline";

/** stub 内核：记录写入；listQuestions 可设置为"部分读回"模拟索引缺失 */
function stubClient() {
  const written: { qid: string; blockId: string }[] = [];
  const createdDocs: string[] = [];
  let revealRatio = 1;                       // 1=全部可读回；<1 模拟部分索引缺失
  const client = {
    sql: async () => [],                       // ensureDoc 查重：空=文档不存在 → 走 createDocWithMd
    createDocWithMd: async (_nb: string, hpath: string) => { createdDocs.push(hpath); return "doc-" + createdDocs.length; },
    appendQuestions: async (_docId: string, qs: Question[]) => {
      const out = qs.map((q) => ({ qid: q.id, blockId: "b-" + q.id }));
      written.push(...out);
      return out;
    },
    listQuestions: async () => {
      const all = written.map((w) => ({ ...makeQuestion({ type: "single", stem: w.qid, options: ["1"], answer: "A" }), id: w.qid, blockId: w.blockId, rootId: "r" }));
      const cut = Math.floor(all.length * revealRatio);
      return all.slice(0, cut);
    },
    setReveal(ratio: number) { revealRatio = ratio; },
  } as unknown as KernelApiClient & { setReveal(r: number): void };
  return { client, written, createdDocs };
}

const mkApp = (client: KernelApiClient, kernelOnline: boolean) => {
  const app = new ExamApp({ client, storage: new MemoryStorage(), now: () => 1_800_000_000_000 });
  app.kernelOnline = kernelOnline;
  return app;
};

const report = (n: number, kp?: string): ImportReport => ({
  ok: Array.from({ length: n }, (_, i) => ({ ...makeQuestion({ type: "single", stem: `题${i}`, options: ["1", "2"], answer: "A" }), kp })),
  errors: [], duplicates: 0, batch: "b-test-0001",
});

describe("commitImport 应用层（U08：写入+读回确认）", () => {
  it("在线 Happy path：按考点落文档、写入数正确、读回 verified=true 全确认", async () => {
    const { client, written, createdDocs } = stubClient();
    const app = mkApp(client, true);
    const r = await app.commitImport("bank1", report(5, "言语"));
    expect(r.written).toBe(5);
    expect(r.docs).toEqual(["/言语"]);
    expect(createdDocs).toEqual(["/言语"]);
    expect(r.readback).toMatchObject({ verified: true, missing: [] });
    expect(r.readback.confirmed).toHaveLength(5);
    expect(written).toHaveLength(5);
  }, 15_000);

  it("离线兜底：写入计数返回，但读回 verified=false（不冒充成功）", async () => {
    const { client } = stubClient();
    const app = mkApp(client, false);
    const r = await app.commitImport("bank1", report(3));
    expect(r.written).toBe(3);
    expect(r.readback).toEqual({ confirmed: [], missing: [], verified: false });
  }, 15_000);

  it("部分读回：confirmed/missing 如实分列（重试缺失的依据）", async () => {
    const { client } = stubClient();
    client.setReveal(0.6);                     // 索引只揭示 60%
    const app = mkApp(client, true);
    const r = await app.commitImport("bank1", report(5));
    expect(r.readback.verified).toBe(true);
    expect(r.readback.confirmed).toHaveLength(3);
    expect(r.readback.missing).toHaveLength(2);
  }, 15_000);

  it("空批次：直接返回零回执，不触发写文档", async () => {
    const { client, createdDocs } = stubClient();
    const app = mkApp(client, true);
    const r = await app.commitImport("bank1", report(0));
    expect(r).toEqual({ written: 0, docs: [], readback: { confirmed: [], missing: [], verified: false } });
    expect(createdDocs).toHaveLength(0);
  }, 15_000);
});
