import { describe, it, expect, vi } from "vitest";
import { ExamApp, type BankInfo } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";
import { SAMPLE_BANK_NAME, SAMPLE_QUESTION_COUNT, sampleQuestions } from "../src/core/sampleBank";
import type { Question } from "../src/core/types";
import { grade } from "../src/core/answer";
import { questionToMarkdown } from "../src/core/blockTemplate";

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

const mkApp = (client: KernelApiClient, storage = new MemoryStorage()) => {
  const app = new ExamApp({ client, storage, now: () => 1_800_000_000_000 });
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

function sampleClient(opts: { indexLag?: boolean } = {}) {
  const docs = new Map<string, { id: string; markdown: string }>();
  const questions: Question[] = [];
  const createNotebook = vi.fn(async () => "sample-nb");
  const writeQuestions = (docId: string, qs: Question[]) => {
    const doc = [...docs.values()].find((d) => d.id === docId);
    if (!doc) throw new Error("文档不存在");
    questions.push(...qs);
    doc.markdown += "\n" + qs.map(questionToMarkdown).join("\n");
  };
  const appendQuestions = vi.fn(async (docId: string, qs: Question[]) => {
    writeQuestions(docId, qs);
    return qs.map((q) => ({ qid: q.id, blockId: "b-" + q.id }));
  });
  const getBlockKramdown = vi.fn(async (id: string) => [...docs.values()].find((d) => d.id === id)?.markdown ?? "");
  const createDocWithMd = vi.fn(async (_nb: string, path: string, markdown: string) => {
    const id = "doc-" + docs.size;
    docs.set(path, { id, markdown });
    return id;
  });
  const listQuestions = vi.fn(async () => opts.indexLag ? [] : [...questions]);
  const client = {
    createNotebook,
    createDocWithMd,
    sql: async (query: string) => {
      if (opts.indexLag) return [];
      const path = query.match(/hpath='([^']+)'/)?.[1];
      const doc = path ? docs.get(path) : null;
      return doc ? [{ id: doc.id }] : [];
    },
    listQuestions,
    getBlockKramdown,
    appendQuestions,
  } as unknown as KernelApiClient;
  return { client, docs, questions, createNotebook, createDocWithMd, appendQuestions, writeQuestions, getBlockKramdown, listQuestions };
}

/** 模拟插件磁盘存储，重启时不与旧应用共享可变引用。 */
class SnapshotStorage extends MemoryStorage {
  override async load(key: string) { return structuredClone(await super.load(key)); }
  override async save(key: string, value: unknown) { await super.save(key, structuredClone(value)); }
}

describe("显式示例题库", () => {
  it("创建独立笔记本和带演示说明的文档，12 题覆盖各题型，不预置作答流水", async () => {
    const { client, docs, questions, createNotebook } = sampleClient();
    const app = mkApp(client);
    const bank = await app.createSampleBank();
    expect(createNotebook).toHaveBeenCalledWith(`题库/${SAMPLE_BANK_NAME}`);
    expect(bank.sampleState).toBe("ready");
    expect([...docs.keys()]).toEqual(["/首页", "/示例题"]);
    expect(docs.get("/首页")?.markdown).toContain("错题本");
    expect(docs.get("/示例题")?.markdown).toContain("不会清理已经产生的作答记录");
    expect(questions).toHaveLength(SAMPLE_QUESTION_COUNT);
    expect(new Set(questions.map((q) => q.type))).toEqual(new Set(["single", "multiple", "judge", "fill", "short"]));
    expect(questions.filter((q) => q.answerSpec?.kind === "numeric")).toHaveLength(1);
    expect(questions.filter((q) => q.answerSpec?.kind === "multiBlank")).toHaveLength(1);
    expect(app.attempts.all()).toHaveLength(0);
    for (const q of questions) {
      expect(q.analysis).toBeTruthy();
      expect(q.source).toContain("示例");
      expect(grade(q, q.answer).verdict).toBe(q.type === "short" ? "not_attempted" : "correct");
    }
  });

  it("并发点击只创建一次，后续打开不覆盖或补回用户删除的示例题", async () => {
    const { client, questions, createNotebook, appendQuestions } = sampleClient();
    const app = mkApp(client);
    const [one, two] = await Promise.all([app.createSampleBank(), app.createSampleBank()]);
    expect(one.id).toBe(two.id);
    expect(createNotebook).toHaveBeenCalledTimes(1);
    questions.splice(0, 1);
    await app.createSampleBank();
    expect(appendQuestions).toHaveBeenCalledTimes(1);
    expect(questions).toHaveLength(SAMPLE_QUESTION_COUNT - 1);
  });

  it("部分写入失败保留题库并报错，再次创建只补缺失题目", async () => {
    const { client, questions, docs, createNotebook, appendQuestions, writeQuestions } = sampleClient();
    appendQuestions.mockImplementationOnce(async (id, qs) => {
      writeQuestions(id, qs.slice(0, 2));
      throw new Error("写入失败");
    });
    const app = mkApp(client);
    await expect(app.createSampleBank()).rejects.toThrow("题目写入尚未完成");
    expect(app.listBanks()[0].sampleState).toBe("pending");
    await app.createSampleBank();
    expect(createNotebook).toHaveBeenCalledTimes(1);
    expect(docs.size).toBe(2);
    expect(appendQuestions.mock.calls[1][1]).toHaveLength(SAMPLE_QUESTION_COUNT - 2);
    expect(questions).toHaveLength(SAMPLE_QUESTION_COUNT);
    expect(new Set(questions.map((q) => q.hash)).size).toBe(SAMPLE_QUESTION_COUNT);
    expect(app.listBanks()[0].sampleState).toBe("ready");
  });

  it("索引仍为空时立即重试：原文已写的题不重复，沿用已保存文档与题目 ID", async () => {
    const { client, questions, createDocWithMd, appendQuestions, writeQuestions, listQuestions } = sampleClient({ indexLag: true });
    const storage = new SnapshotStorage();
    const app = mkApp(client, storage);
    appendQuestions.mockImplementationOnce(async (id, qs) => {
      const saved = (await storage.load("banks") as BankInfo[])[0];
      expect(saved.sampleDocId).toBe(id);
      expect(Object.values(saved.sampleQuestionIds!)).toEqual(qs.map((q) => q.id));
      writeQuestions(id, qs.slice(0, 2));
      throw new Error("写入回执丢失");
    });
    await expect(app.createSampleBank()).rejects.toThrow("写入回执丢失");
    await app.createSampleBank();
    expect(questions).toHaveLength(SAMPLE_QUESTION_COUNT);
    expect(new Set(questions.map((q) => q.id)).size).toBe(SAMPLE_QUESTION_COUNT);
    expect(new Set(questions.map((q) => q.hash)).size).toBe(SAMPLE_QUESTION_COUNT);
    expect(appendQuestions.mock.calls[1][1].map((q) => q.id)).toEqual(appendQuestions.mock.calls[0][1].slice(2).map((q) => q.id));
    expect(createDocWithMd).toHaveBeenCalledTimes(2);
    expect(listQuestions).not.toHaveBeenCalled();
  });

  it("写入后回执丢失且插件重启，读取持久化计划和文档原文后不再插题", async () => {
    const { client, questions, createNotebook, createDocWithMd, appendQuestions, writeQuestions } = sampleClient({ indexLag: true });
    const storage = new SnapshotStorage();
    const app = mkApp(client, storage);
    appendQuestions.mockImplementationOnce(async (id, qs) => {
      writeQuestions(id, qs);
      throw new Error("连接中断");
    });
    await expect(app.createSampleBank()).rejects.toThrow("连接中断");
    const restored = mkApp(client, storage);
    await restored.init("test-device");
    restored.kernelOnline = true;
    await restored.createSampleBank();
    expect(appendQuestions).toHaveBeenCalledTimes(1);
    expect(createNotebook).toHaveBeenCalledTimes(1);
    expect(createDocWithMd).toHaveBeenCalledTimes(2);
    expect(questions).toHaveLength(SAMPLE_QUESTION_COUNT);
    expect(restored.listBanks()[0].sampleState).toBe("ready");
  });

  it("insertBlock 回执不完整但文档已落盘时按回读确认成功", async () => {
    const { client, questions, appendQuestions, writeQuestions } = sampleClient({ indexLag: true });
    appendQuestions.mockImplementationOnce(async (id, qs) => {
      writeQuestions(id, qs);
      return [];
    });
    const app = mkApp(client);
    const bank = await app.createSampleBank();
    expect(bank.sampleState).toBe("ready");
    expect(questions).toHaveLength(SAMPLE_QUESTION_COUNT);
    expect(appendQuestions).toHaveBeenCalledTimes(1);
  });

  it("ready 保存失败后重试只重存状态；直接文档读失败时禁止猜测缺失题目", async () => {
    const { client, questions, appendQuestions, getBlockKramdown } = sampleClient({ indexLag: true });
    const storage = new SnapshotStorage();
    const save = storage.save.bind(storage);
    let failReady = true;
    vi.spyOn(storage, "save").mockImplementation(async (key, value) => {
      if (key === "banks" && (value as BankInfo[])[0]?.sampleState === "ready" && failReady) {
        failReady = false;
        throw new Error("保存失败");
      }
      await save(key, value);
    });
    const app = mkApp(client, storage);
    await expect(app.createSampleBank()).rejects.toThrow("保存失败");
    expect(questions).toHaveLength(SAMPLE_QUESTION_COUNT);
    getBlockKramdown.mockRejectedValueOnce(new Error("原文读取失败"));
    await expect(app.createSampleBank()).rejects.toThrow("原文读取失败");
    expect(appendQuestions).toHaveBeenCalledTimes(1);
    await app.createSampleBank();
    expect(appendQuestions).toHaveBeenCalledTimes(1);
    expect(app.listBanks()[0].sampleState).toBe("ready");
  });

  it("内核离线时明确报错且不创建笔记本", async () => {
    const { client, createNotebook } = sampleClient();
    const app = mkApp(client);
    app.kernelOnline = false;
    await expect(app.createSampleBank()).rejects.toThrow("思源内核未连接");
    expect(createNotebook).not.toHaveBeenCalled();
  });

  it("各次生成使用独立题目 ID，内容指纹稳定以便失败重试去重", () => {
    const first = sampleQuestions();
    const second = sampleQuestions();
    expect(first.map((q) => q.hash)).toEqual(second.map((q) => q.hash));
    expect(first.every((q, i) => q.id !== second[i].id)).toBe(true);
  });
});
