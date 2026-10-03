import { describe, it, expect } from "vitest";
import { AttemptLog, MemoryStorage } from "../src/core/attemptLog";
import type { StorageAdapter } from "../src/core/attemptLog";
import { DATA_SCHEMA_VERSION, migrateAttemptLog } from "../src/core/migrations";
import type { AttemptEvent } from "../src/core/types";

/** 可控存储：save 由外部放行，可注入失败与延迟 */
class GatedStorage implements StorageAdapter {
  readonly map = new Map<string, unknown>();
  saves = 0;
  release: () => void = () => {};
  failNext = false;
  private gate: Promise<void> | null = null;
  async load(key: string) {
    return this.map.get(key);
  }
  async save(key: string, value: unknown) {
    if (this.gate) await this.gate;
    this.saves++;
    if (this.failNext) {
      this.failNext = false;
      throw new Error("disk full");
    }
    this.map.set(key, value);
  }
  hold() {
    this.gate = new Promise<void>((r) => (this.release = r));
  }
  unhold() {
    this.release();
    this.gate = null;
  }
}

const log = (storage: StorageAdapter) => new AttemptLog(storage, "attempts/log", () => 1_000_000, 10_000, 60_000);

/** 读回持久化载荷的 events（v2 信封） */
const persisted = (s: GatedStorage | MemoryStorage) =>
  ((s.map.get("attempts/log") as { v: number; events: unknown[] }) ?? { v: 0, events: [] }).events;

describe("AttemptLog 写入协调（37-03）", () => {
  it("写入期间追加的事件保持 dirty：快照已落盘，新增由补写持久化", async () => {
    const s = new GatedStorage();
    const a = log(s);
    a.append({ qid: "q1", kind: "practice", mode: "m", verdict: "correct", myAnswer: null, sessionId: "s" });
    s.hold();
    const p = a.flush(); // 在途写入（快照=1 条）
    a.append({ qid: "q2", kind: "practice", mode: "m", verdict: "wrong", myAnswer: null, sessionId: "s" }); // 写入期间新增
    s.unhold();
    await p;
    // 第一份快照只有 q1；新增使 dirty 保持，由 flush 内部补写第二份（两条齐全）
    expect(s.saves).toBeGreaterThanOrEqual(2);
    expect(persisted(s)).toHaveLength(2);
  });

  it("在途时再次 flush 合并为一次补写，不并发双写", async () => {
    const s = new GatedStorage();
    const a = log(s);
    a.append({ qid: "q1", kind: "practice", mode: "m", verdict: "correct", myAnswer: null, sessionId: "s" });
    s.hold();
    const p1 = a.flush();
    const p2 = a.flush(); // 在途 → 只置 flushAgain
    s.unhold();
    await Promise.all([p1, p2]);
    expect(a.dirty).toBe(false);
    expect(persisted(s)).toHaveLength(1);
  });

  it("落盘失败：flush 抛出、dirty 保持（待保存标记不清），重试成功后数据完整", async () => {
    const s = new GatedStorage();
    const a = log(s);
    a.append({ qid: "q1", kind: "practice", mode: "m", verdict: "correct", myAnswer: null, sessionId: "s" });
    s.failNext = true;
    await expect(a.flush()).rejects.toThrow("disk full");
    expect(a.dirty).toBe(true);
    expect(a.lastFlushError).toBe("disk full");
    await a.flush(); // 重试
    expect(a.dirty).toBe(false);
    expect(persisted(s)).toHaveLength(1);
  });

  it("后台节流调用失败不产生未处理拒绝（void flush().catch）", async () => {
    const s = new GatedStorage();
    const a = new AttemptLog(s, "k", () => 1, 2, 60_000); // flushLimit=2：第 2 条触发后台 flush
    s.failNext = true;
    a.append({ qid: "q1", kind: "practice", mode: "m", verdict: "correct", myAnswer: null, sessionId: "s" });
    await Promise.resolve(); // 让微任务跑完
    a.append({ qid: "q2", kind: "practice", mode: "m", verdict: "wrong", myAnswer: null, sessionId: "s" });
    await new Promise((r) => setTimeout(r, 10));
    expect(a.dirty).toBe(true); // 失败后待保存标记保留
    s.failNext = false;
    await a.flush();
    expect(a.dirty).toBe(false);
  });
});

describe("attempts 落盘 v2 信封与迁移（TODO 0 组 schemaVersion）", () => {
  const ev = (i: number): AttemptEvent => ({
    v: 1,
    eid: `e${i}`,
    ts: 1_000 + i,
    qid: "q",
    kind: "practice",
    mode: "m",
    verdict: "correct",
    myAnswer: null,
    sessionId: "s",
    examId: null,
    queue: "normal",
    device: "d",
    seq: i,
  });

  it("新写入为 { v, events } 信封；读回完整", async () => {
    const s = new MemoryStorage();
    const a = log(s);
    a.append({ qid: "q1", kind: "practice", mode: "m", verdict: "correct", myAnswer: null, sessionId: "s" });
    await a.flush();
    const raw = s.map.get("attempts/log") as { v: number; events: unknown[] };
    expect(raw.v).toBe(DATA_SCHEMA_VERSION);
    expect(raw.events).toHaveLength(1);
    const b = log(s);
    await b.load("d1");
    expect(b.size).toBe(1);
  });

  it("v1 裸数组（旧版数据）读回迁移，不丢事件", async () => {
    const s = new MemoryStorage();
    s.map.set("attempts/log", [ev(1), ev(2)]);
    const a = log(s);
    const r = await a.load("d1");
    expect(r.loaded).toBe(2);
    expect(a.versionTooNew).toBe(false);
  });

  it("更高版本载荷：事件完整保留并置 versionTooNew 告警标记（不降级丢数据）", async () => {
    const s = new MemoryStorage();
    s.map.set("attempts/log", { v: DATA_SCHEMA_VERSION + 1, events: [ev(1)] });
    const a = log(s);
    await a.load("d1");
    expect(a.size).toBe(1);
    expect(a.versionTooNew).toBe(true);
  });

  it("migrateAttemptLog：空/裸数组/信封/坏结构 四分支", () => {
    expect(migrateAttemptLog(null).kind).toBe("empty");
    expect(migrateAttemptLog([ev(1)]).kind).toBe("envelope");
    expect(migrateAttemptLog({ v: 2, events: [ev(1)] }).kind).toBe("envelope");
    expect(migrateAttemptLog("garbage").kind).toBe("invalid");
  });
});
