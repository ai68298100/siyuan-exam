import { describe, it, expect } from "vitest";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";
import { parseExcelRows, autoMapExcel, type DuplicateStrategy } from "../src/importer/pipeline";
import { makeQuestion } from "../src/core/blockTemplate";

const CSV_HEADER = "题型,题干,选项A,选项B,答案,解析,知识点";
const row = (stem: string, answer: string, analysis = "") =>
  `单选,${stem},甲,乙,${answer},${analysis},资料`;

const parse = (lines: string[], strategy?: DuplicateStrategy) => {
  const header = lines[0].split(",");
  const { map } = autoMapExcel(header);
  const rows = lines.slice(1).map((l) => l.split(","));
  return parseExcelRows(rows, map, { duplicateStrategy: strategy });
};

describe("38-03 更新式重导：parse 更新通道（四八批）", () => {
  it("默认 skip：重复行计入 duplicates；update 策略：进 updates 且不进 ok/duplicates", () => {
    const lines = [CSV_HEADER, row("题干甲", "A"), row("题干甲", "B", "新解析")];
    const skip = parse(lines);
    expect(skip.ok).toHaveLength(1);
    expect(skip.duplicates).toBe(1);
    expect(skip.updates).toHaveLength(0);

    const upd = parse(lines, "update");
    expect(upd.ok).toHaveLength(1); // 第一行正常入库
    expect(upd.duplicates).toBe(0);
    expect(upd.updates).toHaveLength(1);
    expect(upd.updates![0].q.answer).toBe("B"); // 新答案
    expect(upd.updates![0].q.analysis).toBe("新解析");
  });

  it("批内两行同指纹（update 策略）：第一行进 ok，第二行进 updates", () => {
    const lines = [CSV_HEADER, row("题干乙", "A"), row("题干乙", "B")];
    const r = parse(lines, "update");
    expect(r.ok).toHaveLength(1);
    expect(r.updates).toHaveLength(1);
    expect(r.updates![0].q.answer).toBe("B");
  });
});

describe("38-03 applyAnswerUpdates（四八批）", () => {
  const existingStem = "题干甲";
  const existing = {
    ...makeQuestion({ type: "single", stem: existingStem, options: ["甲", "乙"], answer: "A" }),
    blockId: "b-exist",
  };
  // 同指纹新答案：hash 只含题干+选项，不含答案 → 命中
  const incoming = {
    ...makeQuestion({ type: "single", stem: existingStem, options: ["甲", "乙"], answer: "B", analysis: "新解析" }),
    blockId: "b-new",
  };
  expect(existing.hash).toBe(incoming.hash); // 前提：指纹不含答案

  const mkApp = (client: Partial<KernelApiClient>) => {
    const app = new ExamApp({ client: client as KernelApiClient, storage: new MemoryStorage(), now: () => 1_800_000_000_000 });
    app.kernelOnline = true;
    return app;
  };

  it("按 hash 定位库内题，setExamAttrs 只写答案/解析/别名；逐题回执", async () => {
    const attrCalls: Record<string, Record<string, string>> = {};
    const app = mkApp({
      setExamAttrs: async (id: string, attrs: Record<string, string>) => {
        attrCalls[id] = attrs;
      },
    });
    const r = await app.applyAnswerUpdates([{ row: 2, q: incoming }], [existing]);
    expect(r).toEqual({ ok: 1, failed: 0, missing: 0 });
    expect(attrCalls["b-exist"]["exam-answer"]).toBe("B");
    expect(attrCalls["b-exist"]["exam-analysis"]).toBe("新解析");
  });

  it("库内找不到（已删除）计 missing 不猜测；内核写失败计 failed", async () => {
    const app = mkApp({
      setExamAttrs: async () => {
        throw new Error("kernel write failed");
      },
    });
    const r = await app.applyAnswerUpdates([{ row: 2, q: incoming }], []); // 空库 → missing
    expect(r.missing).toBe(1);
    const r2 = await app.applyAnswerUpdates([{ row: 2, q: incoming }], [existing]);
    expect(r2.failed).toBe(1);
  });
});
