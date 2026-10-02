// ============================================================
// 作答流水：append-only 事件集合 + 批量落盘（docs/02 §3.1 修订版）
// 存储经 StorageAdapter 抽象（renderer=plugin.loadData/saveData，测试=内存）
// 语义：事件只追加；同 eid 重复写入被幂等吸收；落盘按节流批量执行
// ============================================================
import type { AttemptEvent } from "./types";
import { SCHEMA_VERSION } from "./types";
import { newDeviceId, newEventId } from "./ids";

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
  /** 时钟回拨检测：事件 ts 相对上一条倒退超过 60s 计为异常（保留事件，不丢弃） */
  clockAnomalies = 0;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly key = "attempts/log",
    private readonly now: () => number = () => Date.now(),
    private readonly flushLimit = 10,
    private readonly flushDelayMs = 30_000,
  ) {}

  /** 启动加载：坏结构（非数组/元素缺 eid）行丢弃并计数 */
  async load(deviceId?: string): Promise<{ loaded: number; badLines: number }> {
    this.device = deviceId ?? this.readOrCreateDeviceId();
    let badLines = 0;
    const raw = await this.storage.load(this.key);
    if (Array.isArray(raw)) {
      for (const e of raw as AttemptEvent[]) {
        if (this.isValid(e)) {
          if (!this.seen.has(e.eid)) {
            this.detectClockAnomaly(e.ts);
            this.seen.add(e.eid);
            this.events.push(e);
            this.seq = Math.max(this.seq, e.seq ?? 0);
          }
        } else badLines++;
      }
    } else if (raw != null) badLines++;
    return { loaded: this.events.length, badLines };
  }

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
    this.dirty = true;
    if (this.events.length % this.flushLimit === 0) void this.flush();
    else if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), this.flushDelayMs);
    return e;
  }

  /** 立即落盘（会话结束/面板切走时调用） */
  async flush(): Promise<void> {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (!this.dirty) return;
    await this.storage.save(this.key, this.events);
    this.dirty = false;
  }

  all(): readonly AttemptEvent[] { return this.events; }

  /** 卸载栅栏（27 组）：清掉节流定时器，防 unload 后仍触发 saveData */
  dispose(): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.dirty = false;
  }
}
