import { describe, it, expect } from "vitest";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";

/** 38-05 multipart 重写 + 38-06 lite 自动登记（三八批） */
function mkApp(opts: { notebooks: { id: string; name: string; closed?: boolean }[] }) {
  const storage = new MemoryStorage();
  const uploaded: string[] = [];
  const client = {
    sql: async () => [],
    importSyUpload: async (_file: Blob, filename: string) => {
      uploaded.push(filename);
    },
    listNotebooks: async () => opts.notebooks.filter((n) => !n.closed), // 与真实 client 一致：closed 不返回
  } as unknown as KernelApiClient;
  const app = new ExamApp({ client, storage, now: () => 1_800_000_000_000 });
  return { app, storage, uploaded };
}

describe("原生包导入与自动登记（38-05/38-06 lite，三八批）", () => {
  it("导入调用 multipart 上传；只登记「题库/」命名空间的新库（前缀剥离）；普通笔记本不收", async () => {
    const { app, uploaded } = mkApp({
      notebooks: [
        { id: "nb-new", name: "题库/导入的新库" },
        { id: "nb-other", name: "普通笔记本" },
        { id: "nb-closed", name: "题库/已关闭", closed: true },
      ],
    });
    (app as unknown as { banks: { id: string; name: string; createdAt: number }[] }).banks.push({
      id: "nb-known",
      name: "已有",
      createdAt: 1,
    });
    const r = await app.importBankSyZip(new Blob(["zip"]), "x.sy.zip");
    expect(uploaded).toEqual(["x.sy.zip"]);
    expect(r.registered).toEqual(["题库/导入的新库"]);
    expect(app.listBanks().map((b) => b.name)).toContain("导入的新库"); // 题库/ 前缀剥离
    expect(app.listBanks().some((b) => b.id === "nb-other")).toBe(false); // 非题库命名空间不收
    expect(app.listBanks().some((b) => b.id === "nb-closed")).toBe(false); // closed 笔记本不收
    expect(app.listBanks().some((b) => b.id === "nb-known")).toBe(true); // 已知库保持
  });

  it("同名覆盖导入（无新库）→ registered 为空但不抛错", async () => {
    const { app } = mkApp({ notebooks: [{ id: "nb-1", name: "题库/同名" }] });
    (app as unknown as { banks: { id: string; name: string; createdAt: number }[] }).banks.push({
      id: "nb-1",
      name: "同名",
      createdAt: 1,
    });
    const r = await app.importBankSyZip(new Blob(["zip"]));
    expect(r.registered).toEqual([]);
    expect(app.listBanks()).toHaveLength(1);
  });
});
