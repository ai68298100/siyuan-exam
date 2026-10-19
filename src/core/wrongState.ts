// ============================================================
// 39-05 错题状态机与手动处置覆盖层时效契约（Wrongbook State & Overlay Semantics）
// 验收要求（TODO 39-05）：
//   1) 错→对→错→对仍在册，错→对→对才消灭；
//   2) 重复 eid 幂等去重不增计；
//   3) 手动处置（已掌握 mastered / 移除 removed / 暂缓 snoozed / 归档 archived）后再错
//      按约定恢复：只要最近一次答错时间（lastWrongAt）晚于手动处置时刻（at），
//      或错次（wrongCount）增加，覆盖层立即失效，错题自动重回活跃列表；
//   4) 刷新与重算一致（纯函数无 IO）。
//
// 既有缺陷根因：此前 app.ts:1053 仅以 `w.wrongCount > o.wrongCount` 判断覆盖时效。
// 但 replayer:102 在消灭后再错时按「新一轮错次」重置为 1（与 replay.test.ts:57 对齐），
// 导致一旦 o.wrongCount >= 1，`1 > o.wrongCount` 恒为 false，手动处置后再错永远无法
// 恢复在册（与 39-05 验收直接违背）。本模块依据 types.ts:116 契约声明：
// 「lastWrongAt: 最近一次答错时间（手动覆盖层时效判断依据）」，引入双保险判定。
// ============================================================

import type { WrongItem } from "./types";

/** 手动处置覆盖记录（持久化在 aux 键 wrongbook/overlays） */
export interface WrongOverlayRecord {
  status: "mastered" | "removed" | "snoozed" | "archived" | string;
  /** 手动处置发生的时间戳（毫秒） */
  at: number;
  /** 处置当时的错次快照 */
  wrongCount: number;
  /** 暂缓（snoozed）到期时间戳（毫秒） */
  until?: number;
}

export type WrongOverlayMap = ReadonlyMap<string, WrongOverlayRecord>;

/**
 * 判断某道题的手动覆盖是否当前依然有效。
 *
 * 核心失效规则（39-05 核心验收：手动处置后再错按约定恢复）：
 *   1) 处置后再次答错（w.lastWrongAt > o.at，允许时钟容差）→ 覆盖立即失效，重回收录；
 *   2) 错次高于处置快照（w.wrongCount > o.wrongCount）→ 覆盖立即失效；
 *   3) snoozed 到期（now >= o.until）→ 覆盖失效，恢复在册。
 * 纯函数无 IO。
 */
export function isOverlayEffective(
  overlay: WrongOverlayRecord | null | undefined,
  item: Pick<WrongItem, "lastWrongAt" | "wrongCount"> | null | undefined,
  now: number = Date.now(),
  clockToleranceMs = 0,
): boolean {
  if (!overlay) return false;

  // 处置后再错按约定恢复：只要发生过晚于处置时刻的答错，或错次递增，覆盖均告失效
  if (item) {
    if (item.lastWrongAt > overlay.at + clockToleranceMs) return false;
    if (item.wrongCount > overlay.wrongCount) return false;
  }

  // 状态分支
  if (overlay.status === "snoozed") {
    return (overlay.until ?? 0) > now;
  }
  if (overlay.status === "mastered" || overlay.status === "removed" || overlay.status === "archived") {
    return true;
  }
  return false;
}

/**
 * 过滤出真正活跃的错题（排除生效中的 mastered/removed/snoozed/archived 覆盖）。
 * 满足 39-05 验收：手动处置后再错的题必然出现在本列表中。
 */
export function filterEffectiveActiveWrongs(
  items: readonly WrongItem[],
  overlays: WrongOverlayMap,
  now: number = Date.now(),
): WrongItem[] {
  if (!overlays.size) return items.filter((w) => w.status === "active");
  return items.filter((w) => {
    if (w.status !== "active") return false;
    const o = overlays.get(w.qid);
    if (!o) return true;
    // 覆盖有效时排除；覆盖失效（如处置后再错）时保留在册
    return !isOverlayEffective(o, w, now);
  });
}

/** 检查某题是否处于手动抑制中（mastered 或 removed，且覆盖依然有效） */
export function isWrongSuppressed(
  overlay: WrongOverlayRecord | null | undefined,
  item: Pick<WrongItem, "lastWrongAt" | "wrongCount"> | null | undefined,
): boolean {
  if (!overlay) return false;
  if (overlay.status !== "mastered" && overlay.status !== "removed") return false;
  return isOverlayEffective(overlay, item);
}

/** 检查某题是否处于暂缓中（snoozed 且未到期、且未再次答错） */
export function isWrongSnoozed(
  overlay: WrongOverlayRecord | null | undefined,
  item: Pick<WrongItem, "lastWrongAt" | "wrongCount"> | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!overlay || overlay.status !== "snoozed") return false;
  return isOverlayEffective(overlay, item, now);
}

/** 检查某题是否处于封存归档中（archived 且未再次答错） */
export function isWrongArchived(
  overlay: WrongOverlayRecord | null | undefined,
  item: Pick<WrongItem, "lastWrongAt" | "wrongCount"> | null | undefined,
): boolean {
  if (!overlay || overlay.status !== "archived") return false;
  return isOverlayEffective(overlay, item);
}

/**
 * 39-05 错题消灭判定纯函数（状态转移）：
 * 错→对→错→对仍在册（streakCorrect=1，未达标）；
 * 错→对→对才消灭（streakCorrect=2 >= threshold）；
 * 中间一旦答错立即归零。
 */
export function nextStreakCorrect(
  prevStreak: number,
  verdict: "correct" | "wrong" | "not_attempted",
): { streak: number; eliminated: boolean; threshold: number } {
  const threshold = 2;
  if (verdict === "wrong") {
    return { streak: 0, eliminated: false, threshold };
  }
  if (verdict === "correct") {
    const next = prevStreak + 1;
    return { streak: next, eliminated: next >= threshold, threshold };
  }
  return { streak: prevStreak, eliminated: prevStreak >= threshold, threshold };
}
