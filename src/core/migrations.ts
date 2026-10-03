// ============================================================
// 持久化 schema 版本与迁移器骨架（TODO 0 组）
// 约定：每个持久化载荷带 v 字段；版本链逐级升级，未知更高版本
// 原样保留不降级（宁可不识别，不丢数据），由调用方告警。
// v1：attempts/log 为裸事件数组（≤0.6.0-dev 第五批）
// v2：attempts/log 为 { v, events } 信封（本版起写入）
// ============================================================

export const DATA_SCHEMA_VERSION = 2;

export interface AttemptLogEnvelope {
  v: number;
  events: unknown[];
}

export type MigrateResult =
  | { kind: "envelope"; v: number; events: unknown[] }
  | { kind: "empty" }
  | { kind: "invalid" };

/** attempts/log 读回迁移：v1 裸数组 → v2 信封；结构不符 → invalid（调用方按坏行告警） */
export function migrateAttemptLog(raw: unknown): MigrateResult {
  if (raw == null) return { kind: "empty" };
  if (Array.isArray(raw)) return { kind: "envelope", v: 1, events: raw };
  if (typeof raw === "object" && Array.isArray((raw as { events?: unknown }).events)) {
    const env = raw as { v?: number; events: unknown[] };
    return { kind: "envelope", v: env.v ?? DATA_SCHEMA_VERSION, events: env.events };
  }
  return { kind: "invalid" };
}
