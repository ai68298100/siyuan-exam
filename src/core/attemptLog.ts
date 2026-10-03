// ============================================================
// 作答流水：append-only 事件集合 + 批量落盘（docs/02 §3.1 修订版）
// 存储经 StorageAdapter 抽象（renderer=plugin.loadData/saveData，测试=内存）
// 语义：事件只追加；同 eid 重复写入被幂等吸收；落盘按节流批量执行
// ============================================================
import type { AttemptEvent } from "./types";
import { SCHEMA_VERSION } from "./types";
import { newDeviceId, newEventId } from "./ids";
import { DATA_SCHEMA_VERSION, migrateAttemptLog } from "./migrations";

export interface StorageAdapter {
  load(key: string): Promise<unknown>;
  save(key: string, value: unknown): Promise<void>;
}

export class MemoryStorage implements StorageAdapter {
  readonly map = new Map<string, unknown>();
  async load(key: string) { return this.map.get(key); }
  async save(key: string, value: unknown) { this.map.set(key, value); }
}

export interface AppendInput {
  qid: string;
  kind: AttemptEvent["kind"];
  mode: string;
  verdict: AttemptEvent["verdict"];
  myAnswer: string | null;
  sessionId: string;
  queue?: AttemptEvent["queue"];
  timeMs?: number;
  selfRating?: number;
  examId?: string | null;
  changes?: number;
  confidence?: AttemptEvent["confidence"];
}

export class AttemptLog {
  private events: AttemptEvent[] = [];
  private seen = new Set<string>();
  private device = "";
  private seq = 0;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** 写入协调（37-03）：串行 flush + 代次检查——写入期间追加的事件不会被误标已保存 */
  private flushing = false;
  private generation = 0;
  /** 最近一次后台落盘失败摘要（重试语义：dirty 保持，直到成功） */
  lastFlushError = "";
  /** 时钟回拨检测：事件 ts 相对上一条倒退超过 60s 计为异常（保留事件，不丢弃） */
  clockAnomalies = 0;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly key = "attempts/log",
    private readonly now: () => number = () => Date.now(),
    private readonly flushLimit = 10,
    private readonly flushDelayMs = 30_000,
  ) {}

  /** 启动加载：v1 裸数组 / v2 信封均接受（migrateAttemptLog 迁移）；坏结构行丢弃并计数 */
  async load(deviceId?: string): Promise<{ loaded: number; badLines: number }> {
    this.device = deviceId ?? this.readOrCreateDeviceId();
    let badLines = 0;
    const raw = await this.storage.load(this.key);
    const m = migrateAttemptLog(raw);
    if (m.kind === "envelope") {
      if (m.v > DATA_SCHEMA_VERSION) this.versionTooNew = true;   // 更高版本：不降级丢数据，仅标记告警
      for (const e of m.events as AttemptEvent[]) {
        if (this.isValid(e)) {
          if (!this.seen.has(e.eid)) {
            this.detectClockAnomaly(e.ts);
            this.seen.add(e.eid);
            this.events.push(e);
            this.seq = Math.max(this.seq, e.seq ?? 0);
          }
        } else badLines++;
      }
    } else if (m.kind === "invalid") badLines++;
    return { loaded: this.events.length, badLines };
  }

  /** 载荷版本高于当前实现（新版插件写的数据被旧版读到）：数据完整保留，功能可能不识别新字段 */
  versionTooNew = false;

  private isValid(e: unknown): e is AttemptEvent {
    const o = e as Record<string, unknown>;
    return !!o && typeof o.eid === "string" && typeof o.qid === "string" && typeof o.ts === "number";
  }

  private detectClockAnomaly(ts: number) {
    const last = this.events[this.events.length - 1];
    if (last && ts < last.ts - 60_000) this.clockAnomalies++;
  }

  private readOrCreateDeviceId(): string {
    // device id 存独立 key；无法读 localStorage 的环境由调用方传入
    return this.device || newDeviceId();
  }

  get deviceId() { return this.device; }

  get size() { return this.events.length; }

  /** 追加一条作答事件（同 eid 幂等）；触发节流落盘 */
  append(input: AppendInput): AttemptEvent {
    const e: AttemptEvent = {
      v: SCHEMA_VERSION,
      eid: newEventId(),
      ts: this.now(),
      qid: input.qid,
      kind: input.kind,
      mode: input.mode,
      verdict: input.verdict,
      myAnswer: input.myAnswer,
      selfRating: input.selfRating,
      timeMs: input.timeMs,
      sessionId: input.sessionId,
      examId: input.examId ?? null,
      queue: input.queue ?? "normal",
      device: this.device,
      seq: ++this.seq,
      changes: input.changes,
      confidence: input.confidence,
    };
    if (this.seen.has(e.eid)) return e;
    this.detectClockAnomaly(e.ts);
    this.seen.add(e.eid);
    this.events.push(e);
    this.generation++;
    this.dirty = true;
    if (this.events.length % this.flushLimit === 0) void this.flush().catch(() => { /* 后台节流失败：dirty 保持，由下次 flush 重试 */ });
    else if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush().catch(() => { /* 同上 */ }), this.flushDelayMs);
    return e;
  }

  /** 立即落盘（会话结束/面板切走时调用）。37-03 在途协调：
   * - 快照写入：保存的是触发时刻的事件副本，写入期间新增事件不受影响
   * - 串行化：已在途时直接返回（新增事件由代次检查触发在途完成后的补写）
   * - 失败：dirty 保持 true（待保存标记不清），可重试；后台调用失败静默等重试
   * - 载荷为 v2 信封 { v, events }（0 组 schemaVersion；读回经 migrateAttemptLog 兼容 v1） */
  async flush(): Promise<void> {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.flushing) return;
    if (!this.dirty) return;
    this.flushing = true;
    const genAtStart = this.generation;
    const snapshot = { v: DATA_SCHEMA_VERSION, events: this.events.slice() };
    try {
      await this.storage.save(this.key, snapshot);
      this.lastFlushError = "";
    } catch (e) {
      this.lastFlushError = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      this.flushing = false;
    }
    if (this.generation === genAtStart) {
      this.dirty = false;
    } else if (this.dirty) {
      await this.flush();   // 写入期间有新增 → 补写（快照里已含新事件引用之外的部分）
    }
  }

  all(): readonly AttemptEvent[] { return this.events; }

  /** 卸载栅栏（27 组）：清掉节流定时器，防 unload 后仍触发 saveData */
  dispose(): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.dirty = false;
  }
}
