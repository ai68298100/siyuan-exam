// ============================================================
// renderer 运行时胶水：petal fetchSyncPost / plugin loadData/saveData
// → ExamApp 所需的 KernelTransport 与 StorageAdapter
// ============================================================
import { fetchSyncPost, Plugin } from "siyuan";
import { KernelApiClient, KernelError } from "./kernel/client";
import type { KernelTransport, RequestOptions } from "./kernel/client";
import { ExamApp } from "./app";
import type { ExamAppDeps } from "./app";
import type { StorageAdapter } from "./core/attemptLog";

const KERNEL_TIMEOUT_MS = 12_000;

async function postWithTimeout(url: string, data: unknown, options: RequestOptions = {}): Promise<{ code: number; msg: string; data: unknown }> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    abortHandler = () => {
      ctrl.abort(options.signal?.reason);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (options.signal?.aborted) abortHandler();
    else options.signal?.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    const race = await Promise.race([
      // fetchSyncPost 的同步请求尾参数支持 AbortSignal；把超时控制器传入
      // 内核请求，避免 Promise.race 超时后底层写请求继续执行。
      fetchSyncPost(url, data, undefined, undefined, ctrl.signal),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => {
          ctrl.abort();
          rej(new Error(`timeout after ${options.timeoutMs ?? KERNEL_TIMEOUT_MS}ms`));
        }, options.timeoutMs ?? KERNEL_TIMEOUT_MS);
      }),
      aborted,
    ]);
    return race as { code: number; msg: string; data: unknown };
  } finally {
    if (timer) clearTimeout(timer);
    if (abortHandler) options.signal?.removeEventListener("abort", abortHandler);
  }
}

function makeTransport(onConnectionChange?: (ok: boolean, error?: KernelError) => void): KernelTransport {
  let down = false; // 只在状态翻转时回调，避免每次失败都刷 UI
  const mark = (ok: boolean, error?: KernelError) => {
    if (down === !ok) return;
    down = !ok;
    onConnectionChange?.(ok, error);
  };
  const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(done, ms);
    function done() { signal?.removeEventListener("abort", abort); resolve(); }
    function abort() { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new DOMException("Aborted", "AbortError")); }
    signal?.addEventListener("abort", abort, { once: true });
  });
  const run = async (endpoint: string, payload: unknown, options: RequestOptions): Promise<{ code: number; msg: string; data: unknown }> => {
    const retries = options.retryable === false ? 0 : Math.min(3, Math.max(0, options.retries ?? 1));
    let last: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (options.signal?.aborted) throw new KernelError("retryable", endpoint, "请求已取消", options.signal.reason);
      try {
        const res = await postWithTimeout(endpoint, payload, options);
        if (res.code !== 0) {
          if (res.code === 429) throw new KernelError("retryable", endpoint, "HTTP 429 限流，稍后重试", undefined, res.code);
          throw new KernelError("fatal", endpoint, res.msg || `code ${res.code}`, undefined, res.code);
        }
        // A kernel-level error envelope may be returned with HTTP 200; the
        // host request itself is reachable, so auth/permission failures must
        // not poison the connection status as offline.
        mark(true);
        return res;
      } catch (e) {
        last = e;
        const kind = e instanceof KernelError ? e.kind : /timeout|abort|network|fail/i.test(String(e)) ? "retryable" : "fatal";
        if (options.signal?.aborted || kind === "fatal" || attempt === retries) {
          const error = e instanceof KernelError ? e : new KernelError(kind, endpoint, String(e), e);
          if (kind === "fatal") {
            // Kernel-level errors (auth, permission, validation, missing
            // endpoint) prove the host responded. Keep connection online but
            // retain the category for a useful recovery message.
            const wasDown = down;
            mark(true, error);
            if (!wasDown) onConnectionChange?.(true, error);
          } else {
            mark(false, error);
          }
          throw error;
        }
        await wait(300 * (attempt + 1), options.signal);
      }
    }
    throw last;
  };
  return {
    async post(endpoint, payload, options = {}) {
      return run(endpoint, payload ?? {}, options);
    },
    async postForm(endpoint, file, filename, options = {}) {
      // fetchSyncPost 对 FormData 原生使用 multipart/form-data；不要传普通对象，
      // 否则会按 JSON 序列化。也不要手工设置 Content-Type，让宿主补 boundary。
      const form = new FormData();
      form.append("file", file, filename);
      return run(endpoint, form, options);
    },
  };
}

/** plugin 私有存储（data/storage/petal/siyuan-exam/）适配 */
function makeStorage(plugin: Plugin): StorageAdapter {
  return {
    async load(key) {
      const v = await plugin.loadData(`${key}.json`);
      // 思源 loadData 对不存在的文件返回 ""；只有这个明确哨兵归一化为空，其他异常必须上抛，
      // 否则暂时的权限/IO 失败会被误当成空数据并在下一次写入时覆盖原文件。
      return v === "" || v == null ? undefined : v;
    },
    async save(key, value) {
      await plugin.saveData(`${key}.json`, value);
    },
  };
}

function readOrCreateDeviceId(): string {
  const K = "lv-exam-device-id";
  try {
    let id = localStorage.getItem(K);
    if (id) return id;
    if (!globalThis.crypto?.randomUUID) throw new Error("[lv-exam] WebCrypto 不可用");
    id = `d-${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
    localStorage.setItem(K, id);
    return id;
  } catch {
    // 隐私模式/宿主策略禁止 localStorage 时仍允许插件启动；本次会话使用临时设备标识。
    return `volatile-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
  }
}

export async function createExamApp(plugin: Plugin): Promise<ExamApp> {
  // 运行时连接标记：retryable 失败翻离线、成功翻回在线（离线横幅与降级提示依赖它；
  // 启动初值仍由 init 的能力探针设定）
  let appRef: ExamApp | null = null;
  const deps: ExamAppDeps = {
    client: new KernelApiClient(makeTransport((ok, error) => {
      if (ok) {
        appRef?.setKernelOnline(true);
        if (error) appRef?.setKernelError(error);
      }
      else if (error) appRef?.setKernelError(error);
      else appRef?.setKernelOnline(false);
    })),
    storage: makeStorage(plugin),
  };
  const app = new ExamApp(deps);
  appRef = app;
  await app.init(readOrCreateDeviceId());
  return app;
}
