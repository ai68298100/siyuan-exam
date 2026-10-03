// ============================================================
// 考点治理（TODO 51-02 lite）：kp 字符串的同义名/层级改名/空考点/误分隔符
// 纯函数层：盘点（usage）+ 合并计划（借 43-06 批量编辑 kp 维度，dry-run/撤销免费获得）。
// 边界：同名不自动判为同一技能；合并永远走 dry-run 预览 → 用户确认 → applyBatchEdit。
// ============================================================
import type { Question } from "./types";
import { planBatchEdit } from "./batchEdit";

export interface KpEntry {
  kp: string;
  count: number;
  /** 是否命中误分隔符（顿号/逗号/分号/末尾斜杠——多层 kp 约定用半角 /） */
  suspect: boolean;
}

export interface KpAudit {
  /** 按题数降序 */
  entries: KpEntry[];
  /** 空考点题数（可整批设置考点） */
  emptyCount: number;
  /** 层级深度分布（顶层 kp → 题数），供大纲视角 */
  topLevels: { top: string; count: number }[];
}

const SUSPECT_RE = /[、，；,;]|\/$/;

export function kpAudit(questions: (Question & { blockId?: string })[]): KpAudit {
  const counts = new Map<string, number>();
  let emptyCount = 0;
  for (const q of questions) {
    const kp = (q.kp ?? "").trim();
    if (!kp) {
      emptyCount++;
      continue;
    }
    counts.set(kp, (counts.get(kp) ?? 0) + 1);
  }
  const entries: KpEntry[] = [...counts.entries()]
    .map(([kp, count]) => ({ kp, count, suspect: SUSPECT_RE.test(kp) }))
    .sort((a, b) => b.count - a.count);
  const tops = new Map<string, number>();
  for (const [kp, count] of counts) {
    const top = kp.split("/")[0].trim() || "（空）";
    tops.set(top, (tops.get(top) ?? 0) + count);
  }
  return {
    entries,
    emptyCount,
    topLevels: [...tops.entries()].map(([top, count]) => ({ top, count })).sort((a, b) => b.count - a.count),
  };
}

/** 合并 dry-run：fromKp 的题全部改写为 toKp（43-06 planBatchEdit 承担跳过/上限/无块守卫） */
export function planKpMerge(
  questions: (Question & { blockId?: string })[],
  fromKp: string,
  toKp: string,
) {
  const picked = questions.filter((q) => (q.kp ?? "").trim() === fromKp);
  return { picked, plan: planBatchEdit(picked, "kp", toKp) };
}

/** 空考点批量设置 dry-run（51-02：空考点治理） */
export function planEmptyKpFill(questions: (Question & { blockId?: string })[], kp: string) {
  const picked = questions.filter((q) => !((q.kp ?? "").trim()));
  return { picked, plan: planBatchEdit(picked, "kp", kp) };
}
