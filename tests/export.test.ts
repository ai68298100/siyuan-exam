import { describe, it, expect } from "vitest";
import { wrongbookToMarkdown } from "../src/core/exportMd";
import { makeQuestion } from "../src/core/blockTemplate";
import type { WrongItem } from "../src/core/types";
import { ExamApp, type MockRecord } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import { KernelApiClient } from "../src/kernel/client";
import type { KernelTransport } from "../src/kernel/client";

const q = makeQuestion({
  type: "single", stem: "1+1等于几？", options: ["1", "2"], answer: "B",
  analysis: "基础加法。", kp: "算术", source: "测试卷 2026",
});
const wrong: WrongItem = {
  qid: q.id, firstWrongAt: 1, wrongCount: 3, streakCorrect: 0,
  reason: "careless", myAnswer: "A", status: "active",
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
    const transport: KernelTransport = { async post() { throw new Error("offline"); } };
    const app = new ExamApp({ client: new KernelApiClient(transport), storage: new MemoryStorage() });
    await app.init("d-t");
    return app;
  };
  it("save/list 往返 + FIFO 上限", async () => {
    const app = await setup();
    for (let i = 1; i <= 205; i++) {
      const rec: MockRecord = { id: "bp", name: "卷" + i, startedAt: i, total: i, full: 100, percent: i, pass: i >= 60 };
      await app.saveMockResult(rec);
    }
    const list = await app.listMockResults();
    expect(list).toHaveLength(200);
    expect(list[0].name).toBe("卷6");     // 最老的被挤出
    expect(list[199].name).toBe("卷205");
  });
  it("空历史", async () => {
    const app = await setup();
    expect(await app.listMockResults()).toEqual([]);
  });
});
