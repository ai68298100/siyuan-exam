import { describe, it, expect } from "vitest";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";

/** createBank 一键流程（2.2 P0，廿五批）：笔记本+首页+示例题文档（真实入库，骨架失败不阻断） */
function stubClient(opts: { failSamples?: boolean } = {}) {
  const docs: { hpath: string }[] = [];
  const appended: number[] = [];
  const client = {
    createNotebook: async () => "nb-1",
    createDocWithMd: async (_nb: string, hpath: string) => {
      if (opts.failSamples && hpath === "/示例题") throw new Error("示例文档创建失败");
      docs.push({ hpath });
      return "doc-" + docs.length;
    },
    appendQuestions: async (_docId: string, qs: { id: string }[]) => {
      appended.push(qs.length);
      return qs.map((q) => ({ qid: q.id, blockId: "b-" + q.id }));
    },
    sql: async () => [],
  } as unknown as KernelApiClient;
  return { client, docs, appended };
}

const mkApp = (client: KernelApiClient) => {
  const app = new ExamApp({ client, storage: new MemoryStorage(), now: () => 1_800_000_000_000 });
  app.kernelOnline = true;
  return app;
};

describe("新建题库一键流程（廿五批）", () => {
  it("建库 = 笔记本 + 首页 + 示例题文档（3 道示例题真实入库）", async () => {
    const { client, docs, appended } = stubClient();
    const app = mkApp(client);
    const info = await app.createBank("行测");
    expect(info.id).toBe("nb-1");
    expect(docs.map((d) => d.hpath)).toEqual(["/首页", "/示例题"]);
    expect(appended).toEqual([3]);
    expect(app.listBanks()).toHaveLength(1);
  });

  it("示例题骨架失败不阻断建库（题库仍注册可用）", async () => {
    const { client } = stubClient({ failSamples: true });
    const app = mkApp(client);
    const info = await app.createBank("申论");
    expect(info.name).toBe("申论");
    expect(app.listBanks()).toHaveLength(1);
  });

  it("空名拒绝", async () => {
    const { client } = stubClient();
    const app = mkApp(client);
    await expect(app.createBank("  ")).rejects.toThrow("题库名不能为空");
  });
});
