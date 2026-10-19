// ============================================================
// 题目修订时间线与生命周期（TODO 43-01 全量，编辑与勘误配套）：
// 每次 updateQuestionContent 成功后落一条全量修订快照（含题干/选项/答案/解析/考点/难度/规格/生命周期），
// 浏览详情可查看时间线、字段差异 Diff，并回滚到指定旧版。
// 恢复不改历史作答；发布前字段清单阻断缺答案/缺题型/孤儿材料。
// 每题上限 MAX_REVISIONS 条（FIFO），存储键 "revisions"。
// ============================================================

import type { Question, QuestionLifecycleStatus, QuestionVersionSnapshot } from "./types";

export type QuestionDiffField = "stem" | "options" | "answer" | "analysis" | "kp" | "difficulty" | "spec" | "status";

export { QuestionLifecycleStatus, QuestionVersionSnapshot };

export const LIFECYCLE_LABELS: Record<QuestionLifecycleStatus, string> = {
  draft: "草稿",
  review: "待审",
  published: "已发布",
  deprecated: "已废弃",
};

/** 43-01 / 55-07 创建作答瞬间的不可变题版快照 */
export function createQuestionVersionSnapshot(
  q: Pick<Question, "hash" | "answer"> & { answerSpec?: Question["answerSpec"] },
  revTs?: number,
): QuestionVersionSnapshot {
  return {
    hash: q.hash,
    answer: q.answer,
    ...(revTs ? { revTs } : {}),
    ...(q.answerSpec ? { specKind: q.answerSpec.kind } : {}),
  };
}

/** 43-01 / 55-07 检出作答事件的冻结题版相对题库现场是否发生修订漂移 */
export function isAttemptVersionDrifted(
  event: { qVersion?: QuestionVersionSnapshot } | undefined | null,
  currentQ: Pick<Question, "hash" | "answer"> | undefined | null,
): boolean {
  if (!event?.qVersion || !currentQ) return false;
  return event.qVersion.hash !== currentQ.hash || event.qVersion.answer !== currentQ.answer;
}

/** 获取题目的生效生命周期状态（缺省默认为 published，确保向后兼容） */
export function getQuestionLifecycle(q: { status?: QuestionLifecycleStatus } | undefined | null): QuestionLifecycleStatus {
  return q?.status ?? "published";
}

export interface QuestionRevision {
  ts: number;
  /** 该次修订后的答案（即当时生效值） */
  answer: string;
  kp?: string;
  /** 本次修订是否改变了判分规格（54 第三刀联动） */
  specChanged?: boolean;
  /** 完整快照：题干 */
  stem?: string;
  /** 完整快照：选项列表 */
  options?: string[];
  /** 完整快照：解析 */
  analysis?: string;
  /** 完整快照：难度；null 表示明确清空，缺失表示旧快照未记录 */
  difficulty?: number | null;
  /** 完整判分规格；null 表示明确清空，缺失表示旧快照未记录 */
  answerSpec?: Question["answerSpec"] | null;
  /** 本次修订发生的字段变更列表 */
  changedFields?: QuestionDiffField[];
  /** 变更摘要（用于快速展示） */
  summary?: string;
  /** 题目作者生命周期状态 (43-01) */
  status?: QuestionLifecycleStatus;
}

export const MAX_REVISIONS = 10;
export const REVISIONS_KEY = "revisions";

export type RevisionStore = Record<string, QuestionRevision[]>;

/** 旧快照缺失的字段保留当前值；新快照的空串/null 必须恢复为清空。 */
export function questionDraftFromRevision(current: Question, revision: QuestionRevision): {
  stem: string;
  options: string[];
  answer: string;
  analysis: string;
  kp: string;
  difficulty?: number;
  answerSpec?: Question["answerSpec"] | null;
  status?: QuestionLifecycleStatus;
} {
  return {
    stem: revision.stem ?? current.stem,
    options: [...(revision.options ?? current.options)],
    answer: revision.answer,
    analysis: revision.analysis ?? current.analysis ?? "",
    kp: revision.kp ?? current.kp ?? "",
    difficulty: revision.difficulty !== undefined ? revision.difficulty ?? undefined : current.difficulty,
    ...(revision.answerSpec !== undefined
      ? { answerSpec: revision.answerSpec ? JSON.parse(JSON.stringify(revision.answerSpec)) : null }
      : {}),
    ...(revision.status !== undefined ? { status: revision.status } : {}),
  };
}

export interface QuestionFieldDiff {
  field: QuestionDiffField;
  from: string;
  to: string;
  label: string;
}

const FIELD_LABELS: Record<QuestionDiffField, string> = {
  stem: "题干",
  options: "选项",
  answer: "答案",
  analysis: "解析",
  kp: "考点",
  difficulty: "难度",
  spec: "判分规格",
  status: "状态",
};

/** 计算题目编辑前后的字段差异列表 */
export function diffQuestion(
  before: Partial<{
    stem: string;
    options: readonly string[];
    answer: string;
    analysis?: string;
    kp?: string;
    difficulty?: number;
    answerSpec?: unknown;
    status?: QuestionLifecycleStatus;
  }>,
  after: Partial<{
    stem: string;
    options: readonly string[];
    answer: string;
    analysis?: string;
    kp?: string;
    difficulty?: number;
    answerSpec?: unknown;
    status?: QuestionLifecycleStatus;
  }>,
): QuestionFieldDiff[] {
  const diffs: QuestionFieldDiff[] = [];

  // 1. stem
  const stemBefore = (before.stem ?? "").trim();
  const stemAfter = (after.stem ?? "").trim();
  if (stemBefore !== stemAfter) {
    diffs.push({ field: "stem", from: stemBefore, to: stemAfter, label: FIELD_LABELS.stem });
  }

  // 2. options
  const optsBefore = before.options ?? [];
  const optsAfter = after.options ?? [];
  const optsBeforeStr = optsBefore.map((o) => o.trim()).join(" | ");
  const optsAfterStr = optsAfter.map((o) => o.trim()).join(" | ");
  if (optsBeforeStr !== optsAfterStr) {
    diffs.push({ field: "options", from: optsBeforeStr, to: optsAfterStr, label: FIELD_LABELS.options });
  }

  // 3. answer
  const ansBefore = (before.answer ?? "").trim();
  const ansAfter = (after.answer ?? "").trim();
  if (ansBefore !== ansAfter) {
    diffs.push({ field: "answer", from: ansBefore, to: ansAfter, label: FIELD_LABELS.answer });
  }

  // 4. analysis
  const anaBefore = (before.analysis ?? "").trim();
  const anaAfter = (after.analysis ?? "").trim();
  if (anaBefore !== anaAfter) {
    diffs.push({ field: "analysis", from: anaBefore, to: anaAfter, label: FIELD_LABELS.analysis });
  }

  // 5. kp
  const kpBefore = (before.kp ?? "").trim();
  const kpAfter = (after.kp ?? "").trim();
  if (kpBefore !== kpAfter) {
    diffs.push({ field: "kp", from: kpBefore, to: kpAfter, label: FIELD_LABELS.kp });
  }

  // 6. difficulty
  const diffBefore = before.difficulty != null ? String(before.difficulty) : "";
  const diffAfter = after.difficulty != null ? String(after.difficulty) : "";
  if (diffBefore !== diffAfter) {
    diffs.push({ field: "difficulty", from: diffBefore, to: diffAfter, label: FIELD_LABELS.difficulty });
  }

  // 7. answerSpec
  if (before.answerSpec !== undefined || after.answerSpec !== undefined) {
    if (specChanged(before.answerSpec, after.answerSpec)) {
      diffs.push({
        field: "spec",
        from: JSON.stringify(before.answerSpec ?? null),
        to: JSON.stringify(after.answerSpec ?? null),
        label: FIELD_LABELS.spec,
      });
    }
  }

  // 8. status
  const statBefore = before.status ?? "published";
  const statAfter = after.status ?? "published";
  if (statBefore !== statAfter) {
    diffs.push({
      field: "status",
      from: LIFECYCLE_LABELS[statBefore] ?? statBefore,
      to: LIFECYCLE_LABELS[statAfter] ?? statAfter,
      label: FIELD_LABELS.status,
    });
  }

  return diffs;
}

/** 格式化差异列表为人类可读的单行摘要 */
export function formatDiffSummary(diffs: readonly QuestionFieldDiff[]): string {
  if (!diffs.length) return "无内容变更";
  return diffs
    .map((d) => {
      if (d.field === "stem" || d.field === "analysis" || d.field === "options") {
        return `${d.label}已修改`;
      }
      if (d.field === "status") {
        return `状态: ${d.from} → ${d.to}`;
      }
      return `${d.label}: ${d.from || "空"} → ${d.to || "空"}`;
    })
    .join("；");
}

export const LIFECYCLE_TRANSITIONS: Record<QuestionLifecycleStatus, readonly QuestionLifecycleStatus[]> = {
  draft: ["review", "published", "deprecated"],
  review: ["draft", "published", "deprecated"],
  published: ["review", "deprecated"],
  deprecated: ["review", "draft"],
};

/** 43-01 生命周期状态转换规则校验 */
export function canTransitionLifecycle(
  from: QuestionLifecycleStatus | undefined,
  to: QuestionLifecycleStatus,
): boolean {
  if (!from || from === to) return true;
  const allowed = LIFECYCLE_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : true;
}

export interface PublishGuardResult {
  valid: boolean;
  errors: string[];
}

export interface PublishGuardContext {
  knownGroupIds?: ReadonlySet<string>;
  knownMaterialIds?: ReadonlySet<string>;
}

/** 43-01 发布守卫（Publish Guard）：发布前字段清单阻断缺答案/缺题型/孤儿材料 */
export function checkPublishGuard(
  q: Partial<Question>,
  context?: PublishGuardContext,
): PublishGuardResult {
  const errors: string[] = [];
  const stem = (q.stem ?? "").trim();
  if (!stem) {
    errors.push("题干不可为空");
  }

  const type = q.type;
  if (!type || !["single", "multiple", "judge", "fill", "short", "material"].includes(type)) {
    errors.push("未指定有效的题型");
    return { valid: false, errors };
  }

  // 共用题干材料母块不参与单题判分，只检查材料内容
  if (type === "material") {
    if (!stem) {
      errors.push("材料母块内容不可为空");
    }
  } else if (type === "single") {
    const opts = (q.options ?? []).map((o) => o.trim());
    if (opts.length < 2) {
      errors.push("单选题至少需要 2 个有效选项");
    }
    if (opts.some((o) => !o)) {
      errors.push("存在空选项");
    }
    const ans = (q.answer ?? "").trim().toUpperCase();
    if (!ans) {
      errors.push("单选题未设置答案");
    } else {
      const idx = ans.charCodeAt(0) - 65;
      if (ans.length !== 1 || idx < 0 || idx >= opts.length) {
        errors.push(`单选题答案 ${ans} 超出选项范围（A-${String.fromCharCode(64 + Math.max(1, opts.length))}）`);
      }
    }
  } else if (type === "multiple") {
    const opts = (q.options ?? []).map((o) => o.trim());
    if (opts.length < 2) {
      errors.push("多选题至少需要 2 个有效选项");
    }
    if (opts.some((o) => !o)) {
      errors.push("存在空选项");
    }
    const ans = (q.answer ?? "").trim().toUpperCase();
    if (!ans || ans.length < 2) {
      errors.push("多选题答案至少需要 2 个选项");
    } else {
      for (const ch of ans) {
        const idx = ch.charCodeAt(0) - 65;
        if (idx < 0 || idx >= opts.length) {
          errors.push(`多选题答案包含越界选项 ${ch}`);
        }
      }
    }
  } else if (type === "judge") {
    const ans = (q.answer ?? "").trim();
    if (ans !== "对" && ans !== "错") {
      errors.push("判断题答案必须为 对 或 错");
    }
  } else if (type === "fill") {
    const ans = (q.answer ?? "").trim();
    if (!ans) {
      errors.push("填空题未设置答案");
    }
    if (q.answerSpec && q.answerSpec.kind === "multiBlank") {
      if (!q.answerSpec.blanks || q.answerSpec.blanks.length === 0) {
        errors.push("多空填空规格未包含任何有效填空位");
      } else {
        for (let i = 0; i < q.answerSpec.blanks.length; i++) {
          const b = q.answerSpec.blanks[i];
          if (!b.answers || b.answers.length === 0 || b.answers.every((a) => !a.trim())) {
            errors.push(`多空填空第 ${i + 1} 空未设置有效答案`);
          }
        }
      }
    }
  } else if (type === "short") {
    const ans = (q.answer ?? "").trim();
    if (!ans) {
      errors.push("简答题参考答案不可为空");
    }
  }

  // 孤儿材料检查（共用题干组关联）
  if (q.group && context?.knownGroupIds && !context.knownGroupIds.has(q.group)) {
    errors.push(`关联的材料组【${q.group}】不存在，属于孤儿题目`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/** 43-01 验证生命周期流转及发布守卫 */
export function validateLifecycleTransition(
  currentStatus: QuestionLifecycleStatus | undefined,
  targetStatus: QuestionLifecycleStatus,
  q: Partial<Question>,
  context?: PublishGuardContext,
): { ok: boolean; reason?: string; guardErrors?: string[] } {
  const current = currentStatus ?? "published";
  if (!canTransitionLifecycle(current, targetStatus)) {
    return {
      ok: false,
      reason: `不允许从【${LIFECYCLE_LABELS[current]}】转换为【${LIFECYCLE_LABELS[targetStatus]}】`,
    };
  }
  if (targetStatus === "published") {
    const guard = checkPublishGuard(q, context);
    if (!guard.valid) {
      return {
        ok: false,
        reason: `发布守卫阻断：题目存在未达标项，无法发布到练习池`,
        guardErrors: guard.errors,
      };
    }
  }
  return { ok: true };
}

function isRevisionEqual(a: QuestionRevision, b: QuestionRevision): boolean {
  if (a.answer !== b.answer) return false;
  if (a.kp !== b.kp) return false;
  if (Boolean(a.specChanged) !== Boolean(b.specChanged)) return false;
  if ((a.stem ?? "") !== (b.stem ?? "")) return false;
  if (a.analysis !== b.analysis) return false;
  if (a.difficulty !== b.difficulty) return false;
  if ((a.answerSpec === undefined) !== (b.answerSpec === undefined)) return false;
  if (specChanged(a.answerSpec, b.answerSpec)) return false;
  if ((a.status ?? "") !== (b.status ?? "")) return false;
  const aOpts = JSON.stringify(a.options ?? []);
  const bOpts = JSON.stringify(b.options ?? []);
  if (aOpts !== bOpts) return false;
  return true;
}

/** 追加一条修订：FIFO 截断；与上一条完全相同则不重复记录 */
export function appendRevision(
  store: RevisionStore,
  qid: string,
  entry: QuestionRevision,
): RevisionStore {
  const list = store[qid] ? [...store[qid]] : [];
  const last = list[list.length - 1];
  if (last && isRevisionEqual(last, entry)) return store;
  list.push(entry);
  while (list.length > MAX_REVISIONS) list.shift();
  return { ...store, [qid]: list };
}

/** 规格是否发生变化（键序无关的等价比较；双向缺失视为未变） */
export function specChanged(prev: unknown, next: unknown): boolean {
  const a = stableKey(prev);
  const b = stableKey(next);
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  return a !== b;
}

/** 规格对象 → 稳定键（递归排序对象键；数组顺序保留） */
function stableKey(v: unknown): string | null {
  if (v == null) return null;
  return JSON.stringify(normalizeForKey(v));
}

function normalizeForKey(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizeForKey);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((key) => [key, normalizeForKey((v as Record<string, unknown>)[key])]),
    );
  }
  return v;
}
