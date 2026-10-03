// ============================================================
// 批量编辑（TODO 2.2 / 43-06 lite）：dry-run 计划 → 预览 → 应用 → 可撤销
// 纯函数层：planBatchEdit 产出逐题 from→to 变更清单（dry-run 预览即计划本身），
// invertPlan 生成逆向变更供撤销；写块由 ExamApp.applyBatchEdit 执行。
// 边界：只动 custom-exam-* 文本/数值属性（考点/难度/出处/年份/分值）；不改历史作答流水。
// ============================================================
import type { Question } from "./types";

export type BatchField = "kp" | "difficulty" | "source" | "year" | "score";

/** BatchField → custom-exam-* 属性裸名（app.applyBatchEdit 写块用，两侧共用此映射防漂移） */
export const BATCH_FIELD_ATTR: Record<BatchField, string> = {
  kp: "exam-kp",
  difficulty: "exam-difficulty",
  source: "exam-source",
  year: "exam-year",
  score: "exam-score",
};

const FIELD_LABEL: Record<BatchField, string> = {
  kp: "考点",
  difficulty: "难度",
  source: "出处",
  year: "年份",
  score: "分值",
};

export interface BatchChange {
  qid: string;
  blockId: string;
  field: BatchField;
  from: string;
  to: string;
}

export interface BatchPlan {
  changes: BatchChange[];
  /** 无块 ID（未导入/离线索引缺失）或值不变的题数 */
  skipped: number;
}

const MAX_BATCH = 500; // 单批上限：超过显式截断（46-03 配额护栏语义），UI 提示分批

function currentValue(q: Question, field: BatchField): string {
  switch (field) {
    case "kp":
      return q.kp ?? "";
    case "difficulty":
      return q.difficulty != null ? String(q.difficulty) : "";
    case "source":
      return q.source ?? "";
    case "year":
      return q.year ?? "";
    case "score":
      return q.score != null ? String(q.score) : "";
  }
}

/** dry-run：生成变更计划（值不变的题跳过并计数，不进变更清单） */
export function planBatchEdit(
  questions: (Question & { blockId?: string })[],
  field: BatchField,
  value: string,
  limit = MAX_BATCH,
): BatchPlan {
  const changes: BatchChange[] = [];
  let skipped = 0;
  for (const q of questions) {
    if (!q.blockId) {
      skipped++;
      continue;
    }
    const from = currentValue(q, field);
    if (from === value) {
      skipped++;
      continue;
    }
    if (changes.length >= limit) {
      skipped++;
      continue;
    }
    changes.push({ qid: q.id, blockId: q.blockId, field, from, to: value });
  }
  return { changes, skipped };
}

/** 逆向计划（撤销）：from/to 互换；仅对已应用的变更生成 */
export function invertPlan(changes: readonly BatchChange[]): BatchChange[] {
  return changes.map((c) => ({ ...c, from: c.to, to: c.from }));
}

/** 变更清单的人类可读摘要行（dry-run 预览/回执共用） */
export function describeChange(c: BatchChange, stem: string): string {
  return `${stem.slice(0, 24)} · ${FIELD_LABEL[c.field]}：${c.from || "（空）"} → ${c.to || "（空）"}`;
}
