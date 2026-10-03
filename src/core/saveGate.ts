// ============================================================
// 对象级保存确认协调器（docs/19 Q2 / docs/21 U06 最小切片）
// 语义：
// - 每个保存目标（session/attempt/mock-run/...）独立状态机，不共享"全局已保存"
// - 同一目标在途写入合并（后来者复用同一 Promise，不重复落盘）
// - 超时 → unknown（结果未知 ≠ 失败 ≠ 成功）；底层写入继续，不因超时中断
// - 一个目标的失败不被另一个目标的成功清除（顶栏汇总可定位具体失败对象）
// - 重载后 verify：按目标读回核对，恢复 confirmed/failed 结论
// ============================================================

export type SaveState = "idle" | "pending" | "confirmed" | "failed" | "unknown";

export interface SaveRecord {
  key: string;
  state: SaveState;
  at: number;              // 最近一次状态变更时刻
  error?: string;          // failed 时的错误摘要
}

export interface SaveSummary {
  pending: string[];
  failed: SaveRecord[];
  unknown: string[];
  confirmed: number;
}

export class SaveGate {
  private states = new Map<string, SaveRecord>();
  private inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly timeoutMs = 8_000,
  ) {}

  state(key: string): SaveState {
    return this.states.get(key)?.state ?? "idle";
  }

  record(key: string): SaveRecord | undefined {
    return this.states.get(key);
  }

  all(): SaveRecord[] {
    return [...this.states.values()];
  }

  summary(): SaveSummary {
    const s: SaveSummary = { pending: [], failed: [], unknown: [], confirmed: 0 };
    for (const r of this.states.values()) {
      if (r.state === "pending") s.pending.push(r.key);
      else if (r.state === "failed") s.failed.push(r);
      else if (r.state === "unknown") s.unknown.push(r.key);
      else if (r.state === "confirmed") s.confirmed++;
    }
    return s;
  }

  /** 目标级保存：同 key 在途合并；成功→confirmed；异常→failed；超时→unknown（写入继续） */
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const going = this.inflight.get(key);
    if (going) return going as Promise<T>;
    this.mark(key, "pending");
    const p = this.doRun(key, fn).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async doRun<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      // 结果未知：不能替用户宣称成功或失败；底层写入完成后由 flush 结果覆盖
      if (this.state(key) === "pending") this.mark(key, "unknown");
    }, this.timeoutMs);
    try {
      const out = await fn();
      // 超时后完成：从 unknown 升级为 confirmed（真实结果覆盖猜测）
      this.mark(key, "confirmed");
      return out;
    } catch (e) {
      this.mark(key, "failed", e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      if (timer) { clearTimeout(timer); timer = null; }
    }
  }

  /** 重载/恢复核对：读回并校验，重写该目标结论（docs/21 U06「重载后按目标核对」） */
  async verify<T>(key: string, read: () => Promise<T>, expect: (v: T) => boolean): Promise<boolean> {
    try {
      const ok = expect(await read());
      this.mark(key, ok ? "confirmed" : "failed", ok ? undefined : "读回内容与预期不符");
      return ok;
    } catch (e) {
      this.mark(key, "failed", e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  /** 手动清除（用户放弃该目标时） */
  clear(key: string) { this.states.delete(key); }

  private mark(key: string, state: SaveState, error?: string) {
    const prev = this.states.get(key);
    this.states.set(key, { key, state, at: this.now(), error: error ?? prev?.error });
  }
}
