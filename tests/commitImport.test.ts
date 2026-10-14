import { describe, it, expect } from "vitest";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";
import type { Question } from "../src/core/types";
import { makeQuestion } from "../src/core/blockTemplate";
import type { ImportReport } from "../src/importer/pipeline";

/** stub 内核：记录写入；listQuestions 可设置为"部分读回"模拟索引缺失 */
function stubClient() {
  const written: { qid: string; blockId: string; docId: string }[] = [];
  const createdDocs: string[] = [];
  const documents = new Map<string, string>();
  let revealRatio = 1; // 1=全部可读回；<1 模拟部分索引缺失
  let rawReadbackFails = false;
  let allReadbackFails = false;
  let rawFails = false;
  let appendFailureAfter = -1;
  const client = {
    sql: async (query: string) => {
      const hpath = /hpath='([^']+)'/.exec(query)?.[1];
      const id = hpath ? documents.get(hpath) : undefined;
      return id ? [{ id }] : [];
    },
    createDocWithMd: async (_nb: string, hpath: string) => {
      createdDocs.push(hpath);
      const id = "doc-" + createdDocs.length;
      documents.set(hpath, id);
      return id;
    },
    getBlockKramdown: async (docId: string) => {
      if (rawFails || ((rawReadbackFails || allReadbackFails) && written.length)) throw new Error("原文读取失败");
      return "# 导入题目\n" + written.filter((w) => w.docId === docId)
        .map((w) => `{: custom-exam-id="${w.qid}"}`).join("\n");
    },
    appendQuestions: async (docId: string, qs: Question[]) => {
      const slice = appendFailureAfter < 0 ? qs : qs.slice(0, appendFailureAfter);
      const out = slice.map((q) => ({ qid: q.id, blockId: "b-" + q.id, docId }));
      written.push(...out);
      if (appendFailureAfter >= 0) {
        appendFailureAfter = -1;
        throw new Error("写入回执丢失");
      }
      return out;
    },
    listQuestions: async () => {
      if (allReadbackFails && written.length) throw new Error("索引读取失败");
      const all = written.map((w) => ({
        ...makeQuestion({ type: "single", stem: w.qid, options: ["1"], answer: "A" }),
        id: w.qid,
        blockId: w.blockId,
        rootId: "r",
      }));
      const cut = Math.floor(all.length * revealRatio);
      return all.slice(0, cut);
    },
    setReveal(ratio: number) {
      revealRatio = ratio;
    },
    setRawReadbackFailure(on: boolean) { rawReadbackFails = on; },
    setAllReadbackFailure(on: boolean) { allReadbackFails = on; },
    setRawFailure(on: boolean) { rawFails = on; },
    failAppendAfter(n: number) { appendFailureAfter = n; },
  };
  const typedClient = client as unknown as KernelApiClient & Pick<typeof client,
    "setReveal" | "setRawReadbackFailure" | "setAllReadbackFailure" | "setRawFailure" | "failAppendAfter">;
  return { client: typedClient, written, createdDocs };
}

const mkApp = (client: KernelApiClient, kernelOnline: boolean) => {
  const app = new ExamApp({ client, storage: new MemoryStorage(), now: () => 1_800_000_000_000 });
  app.kernelOnline = kernelOnline;
  return app;
};

const report = (n: number, kp?: string): ImportReport => ({
  ok: Array.from({ length: n }, (_, i) => ({
    ...makeQuestion({ type: "single", stem: `题${i}`, options: ["1", "2"], answer: "A" }),
    kp,
  })),
  errors: [],
  duplicates: 0,
  batch: "b-test-0001",
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
    const rep = report(3);
    const r = await app.commitImport("bank1", rep);
    expect(r.written).toBe(3);
    expect(r.readback).toEqual({ confirmed: [], missing: rep.ok.map((q) => q.id), verified: false });
  }, 15_000);

  it("部分读回：confirmed/missing 如实分列（重试缺失的依据）", async () => {
    const { client } = stubClient();
    client.setReveal(0.6); // 索引只揭示 60%
    client.setRawReadbackFailure(true);
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

  it("取消：保留已写题，未处理题进入 missing 和 unprocessed，重试只补未处理题", async () => {
    const { client, written } = stubClient();
    const app = mkApp(client, true);
    // 两个考点 → 两个文档；第 1 个文档写完后取消
    const rep = report(4);
    rep.ok = rep.ok.map((q, i) => ({ ...q, kp: i < 2 ? "言语" : "数量" }));
    const progress: [number, number][] = [];
    let calls = 0;
    const r = await app.commitImport("bank1", rep, {
      onProgress: (done, total) => progress.push([done, total]),
      isCancelled: () => ++calls > 1, // 第 2 个文档前取消
    });
    expect(r.cancelled).toBe(true);
    expect(r.written).toBe(2);
    expect(written).toHaveLength(2);
    expect(progress).toEqual([[2, 4]]);
    // 所有题都保留在回执中，未处理的题单列，不能从重试池消失。
    expect(r.readback.verified).toBe(true);
    expect(r.readback.confirmed).toHaveLength(2);
    expect(r.readback.missing).toEqual(rep.ok.slice(2).map((q) => q.id));
    expect(r.unprocessed).toEqual(r.readback.missing);
    const retry = await app.commitImport("bank1", rep);
    expect(retry.written).toBe(2);
    expect(retry.readback.missing).toEqual([]);
    expect(written.map((q) => q.qid)).toEqual(rep.ok.map((q) => q.id));
  }, 15_000);

  it("重复提交同一报告：已存在 qid 不再写入，进度仍完成", async () => {
    const { client, written, createdDocs } = stubClient();
    const app = mkApp(client, true);
    const rep = report(3);
    await app.commitImport("bank1", rep);
    const progress: [number, number][] = [];
    const retry = await app.commitImport("bank1", rep, {
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(retry.written).toBe(0);
    expect(retry.readback.confirmed).toEqual(rep.ok.map((q) => q.id));
    expect(retry.readback.missing).toEqual([]);
    expect(written).toHaveLength(3);
    expect(createdDocs).toHaveLength(1);
    expect(progress).toEqual([[3, 3]]);
  });

  it("SQL 索引未更新：文档原文确认已落地题，试导后再次提交不会双写", async () => {
    const { client, written } = stubClient();
    client.setReveal(0);
    const app = mkApp(client, true);
    const rep = report(3);
    const first = await app.commitImport("bank1", rep);
    expect(first.written).toBe(3);
    expect(first.readback).toEqual({ confirmed: rep.ok.map((q) => q.id), missing: [], verified: true });
    const retry = await app.commitImport("bank1", rep);
    expect(retry.written).toBe(0);
    expect(retry.readback.confirmed).toHaveLength(3);
    expect(written).toHaveLength(3);
  }, 15_000);

  it("append 部分落地后抛异常：再次提交通过原文去重，只补剩余题", async () => {
    const { client, written } = stubClient();
    client.setReveal(0);
    client.failAppendAfter(2);
    const app = mkApp(client, true);
    const rep = report(4);
    await expect(app.commitImport("bank1", rep)).rejects.toThrow("写入回执丢失");
    expect(written).toHaveLength(2);
    const retry = await app.commitImport("bank1", rep);
    expect(retry.written).toBe(2);
    expect(retry.readback.confirmed).toHaveLength(4);
    expect(written.map((q) => q.qid)).toEqual(rep.ok.map((q) => q.id));
  }, 15_000);

  it("写后两个读取接口都失败：不冒充确认，全部题保留供恢复连接后重试", async () => {
    const { client, written } = stubClient();
    client.setAllReadbackFailure(true);
    const app = mkApp(client, true);
    const rep = report(2);
    const first = await app.commitImport("bank1", rep);
    expect(first.written).toBe(2);
    expect(first.readback).toEqual({ confirmed: [], missing: rep.ok.map((q) => q.id), verified: false });
    client.setAllReadbackFailure(false);
    const retry = await app.commitImport("bank1", rep);
    expect(retry.written).toBe(0);
    expect(retry.readback.confirmed).toHaveLength(2);
    expect(written).toHaveLength(2);
  }, 15_000);

  it("写前原文读取失败：不把读取失败当成空文档，不盲目写入", async () => {
    const { client, written } = stubClient();
    client.setRawFailure(true);
    const app = mkApp(client, true);
    await expect(app.commitImport("bank1", report(2))).rejects.toThrow("原文读取失败");
    expect(written).toEqual([]);
  });

  it("报告内部重复 qid：只写一次并按唯一题目数汇总", async () => {
    const { client, written } = stubClient();
    const app = mkApp(client, true);
    const rep = report(1);
    rep.ok.push({ ...rep.ok[0], kp: "重复章节" });
    const r = await app.commitImport("bank1", rep);
    expect(r.written).toBe(1);
    expect(r.readback.confirmed).toEqual([rep.ok[0].id]);
    expect(written).toHaveLength(1);
  });

  it("46-03 进度：不取消时逐文档推进至 (total,total)", async () => {
    const { client } = stubClient();
    const app = mkApp(client, true);
    const rep = report(6);
    rep.ok = rep.ok.map((q, i) => ({ ...q, kp: i < 2 ? "言语" : i < 4 ? "数量" : "判断" }));
    const progress: [number, number][] = [];
    const r = await app.commitImport("bank1", rep, {
      onProgress: (done, total) => progress.push([done, total]),
      isCancelled: () => false,
    });
    expect(r.cancelled).toBeUndefined();
    expect(progress).toEqual([[2, 6], [4, 6], [6, 6]]);
    expect(r.readback.confirmed).toHaveLength(6);
  }, 15_000);
});
