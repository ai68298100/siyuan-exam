// ============================================================
// 数据体检（TODO 69-06 lite，只读）：损坏/异常流水检测，不修复不删除
// 检出项：重复 eid / 字段非法事件 / 时钟漂移（未来事件）/ 孤儿 qid（题不在任何已加载库）
// 边界（69-06）：只读检测；修复/备份/导出归后续切片，不静默删除任何记录。
// ============================================================
import type { AttemptEvent } from "./types";

const VALID_KINDS = new Set(["practice", "recite", "mock", "card"]);
const VALID_VERDICTS = new Set(["correct", "wrong", "not_attempted"]);
const FUTURE_TOLERANCE_MS = 5 * 60_000; // 时钟漂移容忍（设备间秒级偏差不算异常）

export interface DataAuditReport {
  /** 流水事件总数 */
  events: number;
  /** 重复 eid 数（超出首次出现的次数；幂等回放的锚点字段不可重复） */
  duplicateEids: number;
  /** 字段非法事件数（缺 qid / 非法 kind / verdict / v 缺失） */
  badEvents: number;
  /** 未来事件数（ts 超过当前时间 + 容差 → 设备时钟漂移） */
  futureEvents: number;
  /** 孤儿 qid 事件数（题目不在任何已加载题库；删除题的流水属预期，仅提示） */
  orphanEvents: number;
  /** 检出问题总数（重复+非法+未来；孤儿单列不计入硬问题） */
  problemCount: number;
}

export function auditAttemptEvents(
  events: readonly AttemptEvent[],
  knownQids: Set<string>,
  now: number = Date.now(),
): DataAuditReport {
  const seen = new Set<string>();
  let duplicateEids = 0;
  let badEvents = 0;
  let futureEvents = 0;
  let orphanEvents = 0;
  for (const e of events) {
    if (!e || typeof e !== "object") {
      badEvents++;
      continue;
    }
    const bad =
      !e.eid || !e.qid || !VALID_KINDS.has(e.kind) || !VALID_VERDICTS.has(e.verdict) || typeof e.v !== "number";
    if (bad) badEvents++;
    if (e.eid) {
      if (seen.has(e.eid)) duplicateEids++;
      else seen.add(e.eid);
    }
    if (typeof e.ts === "number" && e.ts > now + FUTURE_TOLERANCE_MS) futureEvents++;
    if (e.qid && knownQids.size > 0 && !knownQids.has(e.qid)) orphanEvents++;
  }
  return {
    events: events.length,
    duplicateEids,
    badEvents,
    futureEvents,
    orphanEvents,
    problemCount: duplicateEids + badEvents + futureEvents,
  };
}
