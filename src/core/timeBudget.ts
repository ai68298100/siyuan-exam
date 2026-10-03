// ============================================================
// 每日时间预算（TODO 53-01 lite）：按题型历史用时估计今日计划耗时
// 口径：practice/mock 事件的 timeMs 中位数（极端驻留截断）；无历史题型用默认值
// 并如实标注 sourced=false（53-01 验收：缺历史时说明默认值，不承诺精准完成时间）。
// ============================================================
import type { AttemptEvent, Question } from "./types";

/** 无历史时的题型默认用时（毫秒）；材料题读题成本单独加权 */
export const DEFAULT_TYPE_MS: Record<string, number> = {
  single: 45_000,
  multiple: 70_000,
  judge: 30_000,
  fill: 60_000,
  short: 100_000,
  material: 120_000,
};

const MATERIAL_FACTOR = 1.6; // 材料组子题：读材料成本（53-01：长材料与短判断成本不同）
const MS_CAP = 10 * 60_000; // 单事件用时截断（挂机/切走产生的超长驻留不进统计）

/** 历史平均用时：qid→题型 由调用方注入（题库可能只加载了部分库）；样本 <2 的题型不产出 */
export function avgMsByType(
  events: readonly AttemptEvent[],
  typeOf: (qid: string) => string | undefined,
): Record<string, number> {
  const byType = new Map<string, number[]>();
  for (const e of events) {
    if (e.timeMs == null || e.timeMs <= 0) continue;
    const t = typeOf(e.qid);
    if (!t) continue;
    const arr = byType.get(t) ?? [];
    arr.push(Math.min(e.timeMs, MS_CAP));
    byType.set(t, arr);
  }
  const out: Record<string, number> = {};
  for (const [t, arr] of byType) {
    if (arr.length < 2) continue; // 单样本不可信
    arr.sort((a, b) => a - b);
    out[t] = arr[Math.floor(arr.length / 2)]; // 中位数抗挂机离群
  }
  return out;
}

export interface TimeEstimate {
  /** 中位估计（分钟，向上取整） */
  minutes: number;
  /** 快速下界/慢速上界（分钟）：逐题最快/最慢口径 */
  low: number;
  high: number;
  /** false = 部分或全部题型缺历史，含默认值（UI 必须说明） */
  sourced: boolean;
}

export function estimatePlanMinutes(
  queue: Question[],
  avgByType: Record<string, number>,
  defaults: Record<string, number> = DEFAULT_TYPE_MS,
): TimeEstimate {
  let mid = 0;
  let low = 0;
  let high = 0;
  let sourced = true;
  for (const q of queue) {
    const hist = avgByType[q.type];
    const base = hist ?? defaults[q.type] ?? defaults.single;
    if (!hist) sourced = false;
    const factor = q.type === "material" || q.group ? MATERIAL_FACTOR : 1;
    mid += base * factor;
    low += base * 0.6 * factor;
    high += base * 1.8 * factor;
  }
  const toMin = (ms: number) => Math.max(1, Math.round(ms / 60_000));
  return { minutes: toMin(mid), low: toMin(low), high: toMin(high), sourced };
}
