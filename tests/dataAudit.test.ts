import { describe, it, expect } from "vitest";
import { auditAttemptEvents } from "../src/core/dataAudit";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";
import type { AttemptEvent } from "../src/core/types";

const ev = (over: Partial<AttemptEvent>): AttemptEvent =>
  ({
    v: 2, eid: "e1", ts: 1_000, qid: "q1", kind: "practice", mode: "single",
    verdict: "correct", myAnswer: "A", sessionId: "s1", queue: "normal", device: "d", seq: 1,
    ...over,
  }) as AttemptEvent;

describe("数据体检（69-06 lite 只读，三十批）", () => {
  it("正常流水零问题；重复 eid/非法字段/未来事件分别计数", () => {
    const ok = [ev({}), ev({ eid: "e2", qid: "q2", verdict: "wrong" })];
    expect(auditAttemptEvents(ok, new Set(["q1", "q2"]), 5_000).problemCount).toBe(0);

    const bad = [
      ev({}),                                  // 正常
      ev({ eid: "dup" }),                      // 首次
      ev({ eid: "dup" }),                      // 重复 +1
      ev({ eid: "bad1", kind: "unknown" as unknown as AttemptEvent["kind"] }), // 非法 kind
      ev({ eid: "bad2", qid: "" }),            // 缺 qid
      ev({ eid: "fut", ts: 99_000_000 }),      // 未来事件（时钟漂移）
    ];
    const r = auditAttemptEvents(bad, new Set(["q1"]), 5_000);
    expect(r.events).toBe(6);
    expect(r.duplicateEids).toBe(1);
    expect(r.badEvents).toBe(2);
    expect(r.futureEvents).toBe(1);
    expect(r.problemCount).toBe(4);
  });

  it("孤儿事件单列不计入硬问题；已知 qid 集为空时跳过孤儿检测", () => {
    const r1 = auditAttemptEvents([ev({ qid: "ghost" })], new Set(["q1"]), 5_000);
    expect(r1.orphanEvents).toBe(1);
    expect(r1.problemCount).toBe(0); // 删除题的流水属预期
    const r2 = auditAttemptEvents([ev({ qid: "ghost" })], new Set(), 5_000);
    expect(r2.orphanEvents).toBe(0); // 未加载任何库 → 无法判定，不误报
  });
});

describe("存储占用/数据出库（69-01/58-01 lite，三十批）", () => {
  const mkApp = () => {
    const storage = new MemoryStorage();
    const client = {
      sql: async () => [],
      listQuestions: async () => [],
    } as unknown as KernelApiClient;
    const app = new ExamApp({ client, storage, now: () => 1_800_000_000_000 });
    app.kernelOnline = false;
    return { app, storage };
  };

  it("storageUsage：已知键逐个盘点（无数据=0/present=false）", async () => {
    const { app, storage } = mkApp();
    await storage.save("banks", [{ id: "b1", name: "行测", createdAt: 1 }]);
    const rows = await app.storageUsage();
    expect(rows.find((r) => r.key === "banks")).toMatchObject({ present: true });
    expect((rows.find((r) => r.key === "banks")!.bytes) ?? 0).toBeGreaterThan(0);
    expect(rows.find((r) => r.key === "mock/results")).toMatchObject({ present: false, bytes: 0 });
    expect(rows.length).toBeGreaterThanOrEqual(15);
  });

  it("exportAllData：schema 信封 + 核心资产齐备；不含 AI Key 类字段", async () => {
    const { app, storage } = mkApp();
    await storage.save("banks", [{ id: "b1", name: "行测", createdAt: 1 }]);
    await storage.save("wrongbook/overlays", { q1: { status: "mastered", at: 1, wrongCount: 2 } });
    await app.init(); // banks 注册表进内存
    const json = JSON.parse(await app.exportAllData());
    expect(json.schema).toBe("lv-exam.export/1");
    expect(json.banks).toHaveLength(1);
    expect(json.attempts.v).toBe(2);
    expect(json.wrongbookOverlays.q1.status).toBe("mastered");
    expect(JSON.stringify(json)).not.toContain("apiKey");
  });
});
