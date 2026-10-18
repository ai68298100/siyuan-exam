// ============================================================
// 52-06 顽固题处理而非无限回流（Stubborn Question Remediation）
// 1) 达到失败/耗时阈值（如 wrongCount >= 3 且 streak=0）后识别为顽固题。
// 2) 提供暂缓（snooze）、归档（archive）、拆题/前置建议与争议排查，防止计划被少数极端题吞噬。
// 3) 归档题目不进日常刷题/每日计划/错题重练，但历史作答与统计完好保留，支持随时恢复。
// ============================================================

import type { WrongItem } from "./types";

export interface StubbornThreshold {
  minWrongCount?: number; // 默认 3 次
  extremeTimeMs?: number; // 极端耗时门槛（默认 120 秒）
}

export type RemediationAction = "snooze" | "archive" | "prerequisite" | "dispute";

export interface StubbornRemediation {
  isStubborn: boolean;
  wrongCount: number;
  streakCorrect: number;
  primaryAction: RemediationAction;
  suggestedActions: RemediationAction[];
  reasonText: string;
}

export const DEFAULT_STUBBORN_MIN_WRONGS = 3;
export const DEFAULT_EXTREME_TIME_MS = 120_000;

export const REMEDIATION_LABELS: Record<RemediationAction, string> = {
  snooze: "暂缓复习",
  archive: "封存归档",
  prerequisite: "补前置考点",
  dispute: "排查争议",
};

/** 52-06 纯函数：判定单道错题是否为顽固题 */
export function isStubbornWrong(
  w: WrongItem,
  opts?: {
    avgTimeMs?: number;
    threshold?: StubbornThreshold;
  },
): boolean {
  const minWrong = opts?.threshold?.minWrongCount ?? DEFAULT_STUBBORN_MIN_WRONGS;
  const extremeTime = opts?.threshold?.extremeTimeMs ?? DEFAULT_EXTREME_TIME_MS;

  // 1. 错次达标且未建立消灭连击
  if (w.wrongCount >= minWrong && w.streakCorrect === 0) {
    return true;
  }

  // 2. 耗时极端严重且错误率高
  if (typeof opts?.avgTimeMs === "number" && opts.avgTimeMs >= extremeTime && w.wrongCount >= 2 && w.streakCorrect === 0) {
    return true;
  }

  return false;
}

/** 52-06 纯函数：根据错题情况生成处置建议 */
export function getStubbornRemediation(
  w: WrongItem,
  opts?: {
    avgTimeMs?: number;
    threshold?: StubbornThreshold;
  },
): StubbornRemediation {
  const stubborn = isStubbornWrong(w, opts);
  if (!stubborn) {
    return {
      isStubborn: false,
      wrongCount: w.wrongCount,
      streakCorrect: w.streakCorrect,
      primaryAction: "snooze",
      suggestedActions: [],
      reasonText: "尚未达到顽固题处置门槛",
    };
  }

  const suggested: RemediationAction[] = ["snooze", "archive", "prerequisite", "dispute"];
  let primaryAction: RemediationAction = "snooze";
  let reasonText = `已累计做错 ${w.wrongCount} 次且未消灭，建议暂缓 7 天冷却或封存归档`;

  if (w.wrongCount >= 5) {
    primaryAction = "archive";
    reasonText = `反复做错达到 ${w.wrongCount} 次，疑似超出当前备考阶段或题干存疑，建议直接归档或排查争议`;
  } else if (typeof opts?.avgTimeMs === "number" && opts.avgTimeMs >= DEFAULT_EXTREME_TIME_MS) {
    primaryAction = "prerequisite";
    reasonText = `平均耗时超过 ${(opts.avgTimeMs / 1000).toFixed(0)} 秒且反复出错，建议补充前置知识点或拆分子题`;
  }

  return {
    isStubborn: true,
    wrongCount: w.wrongCount,
    streakCorrect: w.streakCorrect,
    primaryAction,
    suggestedActions: suggested,
    reasonText,
  };
}

/** 52-06 纯函数：从错题列表中筛选出所有顽固题 */
export function filterStubbornWrongs(
  items: readonly WrongItem[],
  timeMap?: ReadonlyMap<string, number>,
  threshold?: StubbornThreshold,
): WrongItem[] {
  return items.filter((w) => isStubbornWrong(w, { avgTimeMs: timeMap?.get(w.qid), threshold }));
}
