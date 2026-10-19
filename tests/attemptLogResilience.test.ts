import { describe, it, expect } from "vitest";
import { AttemptLog, type StorageAdapter, type AppendInput } from "../src/core/attemptLog";
import { migrateAttemptLog } from "../src/core/migrations";
import { auditAttemptEvents } from "../src/core/dataAudit";
import type { AttemptEvent } from "../src/core/types";

class FlakyStorage implements StorageAdapter {
  private files = new Map<string, unknown>();
  public failSavesRemaining = 0;
  public failLoadsRemaining = 0;
  public saveDelaysMs = 0;

  async load(key: string): Promise<unknown> {
    if (this.failLoadsRemaining > 0) {
      this.failLoadsRemaining--;
      throw new Error("EIO: load failed due to transient disk error");
    }
    return this.files.get(key) ?? null;
  }

  async save(key: string, value: unknown): Promise<void> {
    if (this.saveDelaysMs > 0) {
      await new Promise((r) => setTimeout(r, this.saveDelaysMs));
    }
    if (this.failSavesRemaining > 0) {
      this.failSavesRemaining--;
      throw new Error("EIO: disk I/O write error");
    }
    this.files.set(key, value);
  }

  get(key: string): unknown {
    return this.files.get(key);
  }

  set(key: string, value: unknown): void {
    this.files.set(key, value);
  }
}

function makeEvent(overrides: Partial<AppendInput> = {}): AppendInput {
  return {
    qid: "q-101",
    kind: "practice",
    mode: "standard",
    verdict: "correct",
    myAnswer: "A",
    sessionId: "sess-1",
    ...overrides,
  };
}

describe("AttemptLog 存储异常与数据读写韧性", () => {
  it("数据文件缺失时（新用户或未创建），load() 安全初始化为空且不报错", async () => {
    const storage = new FlakyStorage();
    const log = new AttemptLog(storage, "exam-attempt-log-test", () => Date.now(), 10, 30_000);

    const loaded = await log.load("device-brand-new");
    expect(loaded).toEqual({ loaded: 0, badLines: 0 });
    expect(log.events).toHaveLength(0);
    expect(log.dirty).toBe(false);

    // 后续可正常追加并写出
    log.append(makeEvent({ qid: "q-first" }));
    await log.flush();
    expect(storage.get("exam-attempt-log-test")).toBeDefined();
  });

  it("底层存储读取抛出瞬态 IO 异常时，load() 安全透传或可重试捕获", async () => {
    const storage = new FlakyStorage();
    storage.failLoadsRemaining = 1;
    const log = new AttemptLog(storage, "exam-attempt-log-faulty");

    // 第一次读取遭遇瞬态异常
    await expect(log.load("device-faulty")).rejects.toThrow("EIO: load failed");

    // 重试后成功加载
    const retryLoaded = await log.load("device-faulty");
    expect(retryLoaded).toEqual({ loaded: 0, badLines: 0 });
  });

  it("瞬态写失败时维持 dirty 状态，恢复后重试 flush 零丢失刷盘", async () => {
    const storage = new FlakyStorage();
    const log = new AttemptLog(storage, "exam-attempt-log-failover");
    await log.load("device-test");

    log.append(makeEvent({ qid: "q-1" }));
    log.append(makeEvent({ qid: "q-2" }));
    expect(log.dirty).toBe(true);
    expect(log.events).toHaveLength(2);

    // 模拟接下来 1 次写入失败（例如磁盘繁忙）
    storage.failSavesRemaining = 1;

    // 第一次 flush 抛出异常
    await expect(log.flush()).rejects.toThrow("EIO: disk I/O write error");

    // 核心健壮性契约：脏状态必须保持，事件绝对不能从内存中丢失
    expect(log.dirty).toBe(true);
    expect(log.events).toHaveLength(2);

    // 在故障恢复后重新调用 flush()
    await log.flush();
    expect(log.dirty).toBe(false);

    // 验证底层存储实际收到了完整的 2 个事件
    const saved = storage.get("exam-attempt-log-failover") as any;
    expect(saved.events).toHaveLength(2);
    expect(saved.events.map((e: any) => e.qid)).toEqual(["q-1", "q-2"]);
  });

  it("正在写入期间并发追加新事件，触发递归补写（catch-up flush）确保全部入盘", async () => {
    const storage = new FlakyStorage();
    storage.saveDelaysMs = 25; // 写入耗时 25ms
    const log = new AttemptLog(storage, "exam-attempt-log-concurrent");
    await log.load("device-concurrent");

    log.append(makeEvent({ qid: "event-1" }));

    // 启动第一次写入（在后台执行中）
    const flushPromise = log.flush();

    // 在写入期间连续追加 2 个新事件
    log.append(makeEvent({ qid: "event-2" }));
    log.append(makeEvent({ qid: "event-3" }));

    await flushPromise;

    // 验证递归补写机制：第一次 flush 完成后发现 dirty/generation 不一致，自动补写
    expect(log.dirty).toBe(false);
    expect(log.events).toHaveLength(3);

    const saved = storage.get("exam-attempt-log-concurrent") as any;
    expect(saved.events).toHaveLength(3);
    expect(saved.events.map((e: any) => e.qid)).toEqual(["event-1", "event-2", "event-3"]);
  });

  it("高频写入触发自动批处理上限（flushLimit=5）自动刷盘", async () => {
    const storage = new FlakyStorage();
    const log = new AttemptLog(storage, "exam-attempt-log-batch", () => Date.now(), 5, 10_000);
    await log.load("device-batch");

    // 追加 4 条（未达 flushLimit=5，处于节流状态）
    for (let i = 0; i < 4; i++) {
      log.append(makeEvent({ qid: `q-${i}` }));
    }
    expect(log.dirty).toBe(true);

    // 追加第 5 条（触发 flushLimit，立即触发 flush）
    log.append(makeEvent({ qid: "q-4" }));

    // 等待微任务/异步调度清空
    await new Promise((r) => setTimeout(r, 20));

    expect(log.dirty).toBe(false);
    expect(storage.get("exam-attempt-log-batch")).toBeDefined();
  });
});

describe("migrateAttemptLog 数据迁移与残缺数据容错", () => {
  it("空值安全识别为 empty，损坏结构识别为 invalid", () => {
    expect(migrateAttemptLog(null)).toEqual({ kind: "empty" });
    expect(migrateAttemptLog(undefined)).toEqual({ kind: "empty" });
    expect(migrateAttemptLog("not json string")).toEqual({ kind: "invalid" });
    expect(migrateAttemptLog(12345)).toEqual({ kind: "invalid" });
    expect(migrateAttemptLog({})).toEqual({ kind: "invalid" });
  });

  it("支持 v1 裸数组自动无缝向上迁移为 v2 信封结构", () => {
    const v1LegacyArray = [
      { eid: "legacy-1", qid: "q-1", kind: "practice", verdict: "correct", ts: 500, v: 1 },
    ];
    const res = migrateAttemptLog(v1LegacyArray);
    expect(res).toEqual({
      kind: "envelope",
      v: 1,
      events: v1LegacyArray,
    });
  });

  it("对合法 v2 信封结构正确提取版本与事件数组", () => {
    const validEnvelope = {
      v: 2,
      events: [
        { eid: "e-1", qid: "q-1", kind: "practice", verdict: "correct", ts: 1000, v: 2 },
      ],
    };
    const res = migrateAttemptLog(validEnvelope);
    expect(res).toEqual({
      kind: "envelope",
      v: 2,
      events: validEnvelope.events,
    });
  });
});

describe("auditAttemptEvents 流水数据体检与坏记录隔离", () => {
  const baseTime = 1_700_000_000_000;
  const knownQids = new Set(["q-exist-1", "q-exist-2"]);

  it("健康数据集检测全绿：零重复、零非法、零未来、零孤儿", () => {
    const cleanEvents: AttemptEvent[] = [
      { eid: "e1", qid: "q-exist-1", kind: "practice", verdict: "correct", ts: baseTime - 1000, v: 1 },
      { eid: "e2", qid: "q-exist-2", kind: "recite", verdict: "wrong", ts: baseTime - 500, v: 1 },
    ];
    const report = auditAttemptEvents(cleanEvents, knownQids, baseTime);
    expect(report.events).toBe(2);
    expect(report.problemCount).toBe(0);
    expect(report.duplicateEids).toBe(0);
    expect(report.badEvents).toBe(0);
    expect(report.futureEvents).toBe(0);
    expect(report.orphanEvents).toBe(0);
  });

  it("精确检测重复 eid、非法结构事件、时钟漂移与孤儿题", () => {
    const dirtyEvents: any[] = [
      // 正常事件
      { eid: "e1", qid: "q-exist-1", kind: "practice", verdict: "correct", ts: baseTime - 1000, v: 1 },
      // 重复 eid 事件
      { eid: "e1", qid: "q-exist-2", kind: "mock", verdict: "correct", ts: baseTime - 900, v: 1 },
      // 坏事件：null
      null,
      // 坏事件：缺少 qid
      { eid: "e2", kind: "practice", verdict: "correct", ts: baseTime - 800, v: 1 },
      // 坏事件：非法 verdict
      { eid: "e3", qid: "q-exist-1", kind: "practice", verdict: "half-correct", ts: baseTime - 700, v: 1 },
      // 未来事件（超出 5 分钟容差）
      { eid: "e4", qid: "q-exist-1", kind: "practice", verdict: "correct", ts: baseTime + 10 * 60_000, v: 1 },
      // 孤儿事件（题目已被删除，不在题库）
      { eid: "e5", qid: "q-deleted-999", kind: "practice", verdict: "correct", ts: baseTime - 600, v: 1 },
    ];

    const report = auditAttemptEvents(dirtyEvents, knownQids, baseTime);
    expect(report.events).toBe(7);
    expect(report.duplicateEids).toBe(1);
    expect(report.badEvents).toBe(3); // null + 缺 qid + 非法 verdict
    expect(report.futureEvents).toBe(1);
    expect(report.orphanEvents).toBe(1);
    // problemCount 仅汇总硬性问题（重复 + 非法 + 未来 = 1 + 3 + 1 = 5）
    expect(report.problemCount).toBe(5);
    // 孤儿事件不计入 problemCount，属于软性警告
    expect(report).not.toHaveProperty("problemCount", 6);
  });
});
