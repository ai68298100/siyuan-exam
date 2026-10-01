import { describe, it, expect } from "vitest";
import { ExamApp } from "../src/app";
import { KernelApiClient } from "../src/kernel/client";
import type { KernelTransport } from "../src/kernel/client";
import { MemoryStorage } from "../src/core/attemptLog";

describe("writeScoreDoc + recordAiUsage", () => {
  async function setup() {
    const transport: KernelTransport = {
      async post(endpoint) {
        if (endpoint === "/api/system/version") return { code: 0, msg: "", data: { version: "t" } };
        if (endpoint === "/api/lute/md2html") return { code: 0, msg: "", data: { html: "x" } };
        if (endpoint === "/api/query/sql") return { code: 0, msg: "", data: [{ id: "doc1" }] };
        if (endpoint === "/api/filetree/createDocWithMd") return { code: 0, msg: "", data: "doc1" };
        return { code: 0, msg: "", data: null };
      },
    };
    const app = new ExamApp({ client: new KernelApiClient(transport), storage: new MemoryStorage() });
    await app.init("d-t");
    return app;
  }

  it("writeScoreDoc 返回文档 id", async () => {
    const app = await setup();
    const docId = await app.writeScoreDoc("nb1", "# 成绩单\n总分 80");
    expect(docId).toBe("doc1");
  });

  it("recordAiUsage 累计 token 与调用次数", async () => {
    const app = await setup();
    await app.recordAiUsage("siyuan", 500, 2);
    await app.recordAiUsage("openai", 300, 1);
    const usage = (await (app as any).deps.storage.load("ai/usage")) as any;
    expect(usage.totalTokens).toBe(800);
    expect(usage.totalCalls).toBe(3);
  });
});

describe("exportWrongbook（过滤路径）", () => {
  async function setup() {
    const transport: KernelTransport = {
      async post(endpoint) {
        if (endpoint === "/api/system/version") return { code: 0, msg: "", data: { version: "t" } };
        if (endpoint === "/api/lute/md2html") return { code: 0, msg: "", data: { html: "x" } };
        if (endpoint === "/api/query/sql") return { code: 0, msg: "", data: [{ id: "doc1" }] };
        if (endpoint === "/api/notebook/createNotebook") return { code: 0, msg: "", data: { notebook: "nb1" } };
        if (endpoint === "/api/filetree/createDocWithMd") return { code: 0, msg: "", data: "doc1" };
        if (endpoint === "/api/block/insertBlock") return { code: 0, msg: "", data: [{ doOperations: [] }] };
        return { code: 0, msg: "", data: null };
      },
    };
    const app = new ExamApp({ client: new KernelApiClient(transport), storage: new MemoryStorage() });
    await app.init("d-t");
    return app;
  }

  it("空错题也能生成文档（无过滤）", async () => {
    const app = await setup();
    const docId = await app.exportWrongbook("nb1", "测试库");
    expect(docId).toBe("doc1");
  });
  it("带过滤选项（kpRoot/reason/sinceDays）不抛错", async () => {
    const app = await setup();
    const docId = await app.exportWrongbook("nb1", "测试库", { kpRoot: "资料", reason: "careless", sinceDays: 30 });
    expect(docId).toBe("doc1");
  });
});
