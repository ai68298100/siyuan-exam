import { describe, it, expect } from "vitest";
import { wrongbookToMarkdown } from "../src/core/exportMd";
import { makeQuestion } from "../src/core/blockTemplate";
import type { WrongItem } from "../src/core/types";
import { ExamApp, type MockRecord } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import { KernelApiClient } from "../src/kernel/client";
import type { KernelTransport } from "../src/kernel/client";
import type { MockRunSnapshot } from "../src/core/mock";

const q = makeQuestion({
  type: "single",
  stem: "1+1等于几？",
  options: ["1", "2"],
  answer: "B",
  analysis: "基础加法。",
  kp: "算术",
  source: "测试卷 2026",
});
const wrong: WrongItem = {
  qid: q.id,
  firstWrongAt: 1,
  wrongCount: 3,
  streakCorrect: 0,
  reason: "careless",
  myAnswer: "A",
  status: "active",
};

describe("错题册导出 Markdown", () => {
  it("含标题/计数/题面/选项/双方答案/解析/错因", () => {
    const md = wrongbookToMarkdown([{ wrong, q }], { bankName: "公考题库", exportedAt: new Date(2026, 9, 2) });
    expect(md).toContain("# 错题册 · 公考题库");
    expect(md).toContain("共 1 题");
    expect(md).toContain("1+1等于几？");
    expect(md).toContain("- A. 1");
    expect(md).toContain("✕ 我的答案：A");
    expect(md).toContain("✓ 正确答案：B");
    expect(md).toContain("💡 基础加法");
    expect(md).toContain("错因：粗心");
    expect(md).toContain("错 3 次");
  });
  it("空错题册", () => {
    const md = wrongbookToMarkdown([], { bankName: "X", exportedAt: new Date() });
    expect(md).toContain("错题本为空");
  });
});

describe("模考成绩持久化", () => {
  const setup = async () => {
    const transport: KernelTransport = {
      async post() {
        throw new Error("offline");
      },
    };
    const app = new ExamApp({ client: new KernelApiClient(transport), storage: new MemoryStorage() });
    await app.init("d-t");
    return app;
  };
  it("save/list 往返 + FIFO 上限", async () => {
    const app = await setup();
    for (let i = 1; i <= 205; i++) {
      const rec: MockRecord = {
        id: "bp",
        name: "卷" + i,
        startedAt: i,
        total: i,
        full: 100,
        percent: i,
        pass: i >= 60,
      };
      await app.saveMockResult(rec);
    }
    const list = await app.listMockResults();
    expect(list).toHaveLength(200);
    expect(list[0].name).toBe("卷6"); // 最老的被挤出
    expect(list[199].name).toBe("卷205");
  });
  it("空历史", async () => {
    const app = await setup();
    expect(await app.listMockResults()).toEqual([]);
  });

  it("同一 run 重试保存会更新成绩而不重复占历史", async () => {
    const app = await setup();
    const rec: MockRecord = { id: "bp", runId: "run-1", name: "卷", startedAt: 1, total: 6, full: 10, percent: 60, pass: true };
    await app.saveMockResult(rec);
    await app.saveMockResult({ ...rec, total: 7, percent: 70 });
    const list = await app.listMockResults();
    expect(list).toHaveLength(1);
    expect(list[0].total).toBe(7);
  });

  it("并发快照写入按顺序落盘，保留最新状态", async () => {
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    let holdFirst = true;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    class DelayedStorage extends MemoryStorage {
      override async save(key: string, value: unknown) {
        if (key === "mock/run" && holdFirst) {
          holdFirst = false;
          markFirstStarted();
          await firstGate;
        }
        await super.save(key, value);
      }
    }
    const transport: KernelTransport = { async post() { throw new Error("offline"); } };
    const storage = new DelayedStorage();
    const app = new ExamApp({ client: new KernelApiClient(transport), storage });
    await app.init("d-t");
    const snapshot = (savedAt: number): MockRunSnapshot => ({
      v: 1,
      runId: "run-1",
      bp: { id: "bp", name: "卷", durationS: 3600, passLine: 60, shuffleOptions: false, sectionTimed: false, sections: [] },
      qids: [], sectionOf: {}, scoreOf: {}, indefinite: [], startedAt: 1, savedAt,
      answers: [], flags: [], cursor: 0, sectionStart: {}, screenSwitches: 0,
    });
    const first = app.saveMockRun(snapshot(1));
    await firstStarted;
    const latest = app.saveMockRun(snapshot(2));
    releaseFirst();
    await Promise.all([first, latest]);
    expect((await storage.load("mock/run") as MockRunSnapshot).savedAt).toBe(2);
  });

  it("清除快照等待先前写入完成，避免结束后恢复已结束的模考", async () => {
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    class DelayedStorage extends MemoryStorage {
      private delayFirst = true;
      override async save(key: string, value: unknown) {
        if (key === "mock/run" && this.delayFirst) {
          this.delayFirst = false;
          markFirstStarted();
          await firstGate;
        }
        await super.save(key, value);
      }
    }
    const transport: KernelTransport = { async post() { throw new Error("offline"); } };
    const storage = new DelayedStorage();
    const app = new ExamApp({ client: new KernelApiClient(transport), storage });
    await app.init("d-t");
    const snapshot: MockRunSnapshot = {
      v: 1,
      runId: "run-1",
      bp: { id: "bp", name: "卷", durationS: 3600, passLine: 60, shuffleOptions: false, sectionTimed: false, sections: [] },
      qids: [], sectionOf: {}, scoreOf: {}, indefinite: [], startedAt: 1, savedAt: 1,
      answers: [], flags: [], cursor: 0, sectionStart: {}, screenSwitches: 0,
    };
    const first = app.saveMockRun(snapshot);
    await firstStarted;
    const clear = app.clearMockRun();
    releaseFirst();
    await Promise.all([first, clear]);
    expect(await storage.load("mock/run")).toBeNull();
  });
});
