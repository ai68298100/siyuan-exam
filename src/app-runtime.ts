// ============================================================
// renderer 运行时胶水：petal fetchSyncPost / plugin loadData/saveData
// → ExamApp 所需的 KernelTransport 与 StorageAdapter
// ============================================================
import { fetchSyncPost, Plugin } from "siyuan";
import { KernelApiClient, KernelError } from "./kernel/client";
import type { KernelTransport } from "./kernel/client";
import { ExamApp } from "./app";
import type { ExamAppDeps } from "./app";
import type { StorageAdapter } from "./core/attemptLog";
import { SCHEMA_VERSION } from "./core/types";

const KERNEL_TIMEOUT_MS = 12_000;

async function postWithTimeout(url: string, data: unknown): Promise<{ code: number; msg: string; data: unknown }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const race = await Promise.race([
      fetchSyncPost(url, data),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout after ${KERNEL_TIMEOUT_MS}ms`)), KERNEL_TIMEOUT_MS); }),
    ]);
    return race as { code: number; msg: string; data: unknown };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function makeTransport(): KernelTransport {
  return {
    async post(endpoint, payload) {
      try {
        const res = await postWithTimeout(endpoint, payload ?? {});
        if (res.code !== 0) throw new KernelError("fatal", endpoint, res.msg || `code ${res.code}`);
        return res;
      } catch (e) {
        if (e instanceof KernelError) throw e;
        throw new KernelError(/timeout|abort|network|fail/i.test(String(e)) ? "retryable" : "fatal", endpoint, String(e), e);
      }
    },
  };
}

/** plugin 私有存储（data/storage/petal/siyuan-exam/）适配 */
function makeStorage(plugin: Plugin): StorageAdapter {
  return {
    async load(key) {
      try { return await plugin.loadData(`${key}.json`); } catch { return undefined; }
    },
    async save(key, value) {
      await plugin.saveData(`${key}.json`, value);
    },
  };
}

function readOrCreateDeviceId(): string {
  const K = "lv-exam-device-id";
  let id = localStorage.getItem(K);
  if (!id) {
    if (!globalThis.crypto?.randomUUID) throw new Error("[lv-exam] WebCrypto 不可用");
    id = `d-${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
    localStorage.setItem(K, id);
  }
  return id;
}

export async function createExamApp(plugin: Plugin): Promise<ExamApp> {
  const deps: ExamAppDeps = {
    client: new KernelApiClient(makeTransport()),
    storage: makeStorage(plugin),
  };
  const app = new ExamApp(deps);
  await app.init(readOrCreateDeviceId());
  void SCHEMA_VERSION;
  return app;
}
