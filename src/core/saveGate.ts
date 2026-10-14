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
  at: number; // 最近一次状态变更时刻
  error?: string; // failed 时的错误摘要
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
  /**
   * 最新快照队列：`run` 为兼容旧调用保留“同 key 复用当前 Promise”的语义，
   * 需要保存可变对象快照时使用 `runLatest`。在前一个写入完成前到达的调用
   * 会只保留最后一个 fn，并在当前写入结束后执行一次，避免旧快照覆盖新快照。
   */
  private latest = new Map<
    string,
    {
      fn: () => Promise<unknown>;
      waiters: { resolve: (value: unknown) => void; reject: (reason: unknown) => void }[];
    }
  >();

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
    const p = this.doRun(key, fn).finally(() => {
      // A runLatest caller may be waiting for this legacy operation to finish;
      // keep the identity visible until its drain callback starts the latest
      // snapshot. With no queued snapshot, release the key as before.
      if (!this.latest.has(key)) this.inflight.delete(key);
    });
    this.inflight.set(key, p);
    return p;
  }

  /**
   * 保存可变对象的最新快照。
   *
   * 与 `run` 的兼容语义不同：在途期间不会丢掉后续调用，而是合并为一次
   * “当前写入完成后保存最后一个快照”的操作。多个被合并调用的 Promise
   * 都会收到最终写入的结果（或最终写入的异常）。底层写入仍然不可取消，
   * 因而超时仍按 `unknown` 处理；后续快照会在其完成后继续写入。
   */
  runLatest<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const going = this.inflight.get(key);
    if (!going) return this.startLatest(key, fn);

    return new Promise<T>((resolve, reject) => {
      const queued = this.latest.get(key);
      const waiter = { resolve: resolve as (value: unknown) => void, reject };
      if (queued) {
        queued.fn = fn;
        queued.waiters.push(waiter);
      } else {
        this.latest.set(key, { fn, waiters: [waiter] });
        // The in-flight operation may have been started through the legacy
        // `run` API, so it does not have `startLatest`'s drain callback.
        void going.then(() => this.finishLatest(key, going), () => this.finishLatest(key, going));
      }
    });
  }

  private startLatest<T>(key: string, fn: () => Promise<T>): Promise<T> {
    this.mark(key, "pending");
    const p = this.doRun(key, fn);
    this.inflight.set(key, p);
    // Drain the latest queued snapshot after this attempt settles. Do not await
    // here: callers of the current attempt must observe its own result first.
    void p.then(() => this.finishLatest(key, p), () => this.finishLatest(key, p));
    return p;
  }

  private finishLatest(key: string, attempt: Promise<unknown>) {
    // A legacy-run drain callback can run after a latest-run callback already
    // advanced the queue; it must never drain/delete the newer attempt.
    if (this.inflight.get(key) !== attempt) return;
    // The current attempt remains registered until this callback drains the
    // optional latest snapshot. This keeps an unexpected callback harmless.
    const queued = this.latest.get(key);
    if (!queued) {
      this.inflight.delete(key);
      return;
    }
    this.latest.delete(key);
    const next = this.startLatest(key, queued.fn);
    void next.then(
      (nextValue) => queued.waiters.forEach(({ resolve }) => resolve(nextValue)),
      (nextError) => queued.waiters.forEach(({ reject }) => reject(nextError)),
    );
  }

  private async doRun<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
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
      clearTimeout(timer);
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
  clear(key: string) {
    this.states.delete(key);
  }

  private mark(key: string, state: SaveState, error?: string) {
    this.states.set(key, { key, state, at: this.now(), error: state === "failed" ? error : undefined });
  }
}
