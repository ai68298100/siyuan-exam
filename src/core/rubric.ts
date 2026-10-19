// ============================================================
// 55-05 主观采分点与自评（Subjective Rubric Self-Assessment）
// 1) 作者为简答/论述题配置 2–5 个采分点（各自权重与满意度等级），用户交卷后逐项自评。
// 2) 自评分由采分点权重与等级换算，每一分都能回到具体采分点（breakdown 结构化）。
// 3) 未评 / 部分满足 / 最终自评分三者严格分开：未评项以 null 计入，绝不当作 0 分；
//    全部采分点评完前不给「最终自评分」，只给已评部分的得分率。
// 4) 旧成绩冻结当时的 rubric 版本（快照携带 revision），改 rubric 不改历史自评分。
//
// 诚实边界（55-05 验收要求）：自评是学习者对自己作答的判断，不是官方阅卷结论。
// 界面与导出不得把自评分写成官方成绩，也不由 AI 决定最终分。纯函数无 IO。
// ============================================================

export const RUBRIC_VERSION = 1;

/** 采分点满意度等级：full=完全满足、partial=部分满足、none=未达标。
 *  unknown 不是等级，而是「未评」——它不参与得分计算，也不折成 0 分。 */
export type CriterionRating = "full" | "partial" | "none" | "unknown";

/** 可配置的等级键（不含 unknown：未评不是可配置档位，而是缺省态） */
export type RubricLevelKey = Exclude<CriterionRating, "unknown">;

export interface RubricLevel {
  /** 等级标识（用于自定义等级覆盖默认 full/partial/none） */
  key: RubricLevelKey;
  label: string;
  /** 该等级占该采分点满分的比例 0-1 */
  ratio: number;
}

/** 默认三档（part 档比例可被作者自定义；unknown 恒为未评不在此列表） */
export const DEFAULT_RUBRIC_LEVELS: readonly RubricLevel[] = [
  { key: "full", label: "完全满足", ratio: 1 },
  { key: "partial", label: "部分满足", ratio: 0.5 },
  { key: "none", label: "未达标", ratio: 0 },
];

export interface RubricCriterion {
  /** 采分点标识（c1、c2…；用户修订 rubric 时保持稳定以便历史对照） */
  id: string;
  /** 采分点描述（自评依据，也是「每分回到采分点」的落点） */
  label: string;
  /** 权重 0-1；写入前经 normalizeRubricWeights 归一到合计 1 */
  weight: number;
  /** 可选：作者提供的参考要点/示例（不参与计分，仅供自评参考） */
  example?: string;
  /** 可选：该采分点自定义等级表（缺省用 DEFAULT_RUBRIC_LEVELS） */
  levels?: RubricLevel[];
}

export interface RubricSpec {
  v: 1;
  kind: "rubric";
  /** 该题满分（用于把权重换算为分数；缺省时由调用方传入题目分值） */
  fullScore: number;
  criteria: RubricCriterion[];
  /** 作者修订 rubric 时递增；旧成绩冻结当时的值（55-05 冻结版本要求） */
  revision?: number;
}

export const RUBRIC_MIN_CRITERIA = 2;
export const RUBRIC_MAX_CRITERIA = 5;

// ---------- 解析与校验 ----------

/** 块属性 JSON → RubricSpec（宽容解析：版本/形状不符 → undefined，按无 rubric 处理） */
export function parseRubricAttr(raw: string | undefined): RubricSpec | undefined {
  if (!raw) return undefined;
  try {
    const obj = JSON.parse(raw) as {
      v?: number;
      kind?: string;
      criteria?: unknown;
      fullScore?: unknown;
      revision?: unknown;
    };
    if (!obj || obj.v !== RUBRIC_VERSION || obj.kind !== "rubric") return undefined;
    if (!Array.isArray(obj.criteria)) return undefined;
    const criteria = obj.criteria
      .map((c) => c as Partial<RubricCriterion>)
      .filter((c) => c && typeof c.label === "string" && c.label.trim().length > 0)
      .map((c, i) => ({
        id: typeof c.id === "string" && c.id ? c.id : `c${i + 1}`,
        label: String(c.label).trim(),
        weight: Number.isFinite(c.weight) ? Math.max(0, Number(c.weight)) : 1,
        example: c.example ? String(c.example) : undefined,
        levels: Array.isArray(c.levels)
          ? (c.levels as RubricLevel[])
              .filter((l) => l && (l.key === "full" || l.key === "partial" || l.key === "none") && Number.isFinite(l.ratio))
              .map((l) => ({ key: l.key, label: String(l.label ?? l.key), ratio: Math.max(0, Math.min(1, l.ratio)) }))
          : undefined,
      }));
    if (!criteria.length) return undefined;
    const fullScore = Number.isFinite(obj.fullScore) ? Math.max(0, Number(obj.fullScore)) : 0;
    const revision = Number.isFinite(obj.revision) ? Math.max(0, Number(obj.revision)) : undefined;
    return {
      v: RUBRIC_VERSION,
      kind: "rubric",
      fullScore,
      criteria: normalizeRubricWeights(criteria),
      ...(revision != null ? { revision } : {}),
    };
  } catch {
    return undefined;
  }
}

/** 权重归一：合计化为 1（合计为 0 时等权分配），避免作者手填小数导致的满分漂移 */
export function normalizeRubricWeights(criteria: readonly RubricCriterion[]): RubricCriterion[] {
  const total = criteria.reduce((s, c) => s + (Number.isFinite(c.weight) ? Math.max(0, c.weight) : 0), 0);
  if (!criteria.length) return [];
  if (total <= 0) {
    const even = Math.round((1 / criteria.length) * 1e6) / 1e6;
    return criteria.map((c) => ({ ...c, weight: even }));
  }
  return criteria.map((c) => ({
    ...c,
    weight: Math.round(((Number.isFinite(c.weight) ? Math.max(0, c.weight) : 0) / total) * 1e6) / 1e6,
  }));
}

/** rubric 健康检查：返回人类可读问题清单（空数组=可用）。用于作者录入校验。 */
export function validateRubric(spec: RubricSpec | null | undefined): string[] {
  const issues: string[] = [];
  if (!spec || spec.v !== RUBRIC_VERSION || spec.kind !== "rubric") return ["rubric 结构无效或版本不符"];
  const n = spec.criteria.length;
  if (n < RUBRIC_MIN_CRITERIA) issues.push(`采分点至少需要 ${RUBRIC_MIN_CRITERIA} 个（当前 ${n} 个）`);
  if (n > RUBRIC_MAX_CRITERIA) issues.push(`采分点最多 ${RUBRIC_MAX_CRITERIA} 个（当前 ${n} 个）`);
  const seen = new Set<string>();
  for (const c of spec.criteria) {
    if (!c.label.trim()) issues.push("存在空白采分点描述");
    if (seen.has(c.id)) issues.push(`采分点 id「${c.id}」重复（历史对照将无法定位）`);
    seen.add(c.id);
    if (!Number.isFinite(c.weight) || c.weight < 0) issues.push(`采分点「${c.label}」权重无效`);
  }
  if (spec.fullScore > 0 && !Number.isFinite(spec.fullScore)) issues.push("满分必须为正数");
  return issues;
}

// ---------- 作者文本格式 ⇄ spec（录题工作台用的紧凑格式） ----------

/** 作者录入格式：每行一个采分点 `描述 | 权重 | 参考要点?`；权重可省略（等权）。
 *  以 # 开头为注释、空行忽略。解析失败返回 null，由调用方提示而非静默吞掉。 */
export function parseRubricFromText(text: string, fullScore = 0, revision?: number): RubricSpec | null {
  const criteria: RubricCriterion[] = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("|").map((p) => p.trim());
    const label = parts[0];
    if (!label) continue;
    const weightRaw = parts[1] ?? "";
    const weight = weightRaw === "" ? 1 : Number(weightRaw);
    if (weightRaw !== "" && !Number.isFinite(weight)) return null;
    criteria.push({
      id: `c${criteria.length + 1}`,
      label,
      weight: Math.max(0, weight),
      example: parts[2] || undefined,
    });
  }
  if (!criteria.length) return null;
  return {
    v: RUBRIC_VERSION,
    kind: "rubric",
    fullScore: Number.isFinite(fullScore) ? Math.max(0, fullScore) : 0,
    criteria: normalizeRubricWeights(criteria),
    ...(revision != null ? { revision } : {}),
  };
}

/** spec → 作者录入格式（供录题工作台回填编辑） */
export function formatRubricToText(spec: RubricSpec | null | undefined): string {
  if (!spec || spec.kind !== "rubric") return "";
  return spec.criteria
    .map((c) => [c.label, String(c.weight), c.example ?? ""].join(" | ").replace(/\s*\|\s*$/, ""))
    .join("\n");
}

// ---------- 自评与计分 ----------

export interface CriterionAssessment {
  criterionId: string;
  rating: CriterionRating;
  /** 可选：用户自评依据/备注（不进分数，进入 breakdown 供回看） */
  note?: string;
}

export interface RubricScoreBreakdown {
  criterionId: string;
  label: string;
  weight: number;
  rating: CriterionRating;
  /** 该采分点得分；未评（unknown）→ null，不折成 0 分 */
  earned: number | null;
  /** 该采分点满分 */
  max: number;
  /** 自评等级占比（unknown → null） */
  ratio: number | null;
  note?: string;
  example?: string;
}

export interface RubricScoreResult {
  /** 已评采分点得分之和 */
  earned: number;
  /** 已评采分点满分之和（部分自评的得分率分母，只算已评） */
  ratedMax: number;
  /** 题目满分（全部采分点满分之和） */
  fullScore: number;
  /** 未评采分点数量（显式与 0 分区分） */
  unratedCount: number;
  /** 是否全部采分点已评（false=部分自评，不给最终自评分） */
  complete: boolean;
  /** 已评部分得分率 0-100；无已评项时 null（不显示为 0） */
  ratedPercent: number | null;
  /** 折算到满分的自评分；仅 complete 时非 null（未评完不给最终分） */
  finalScore: number | null;
  /** 逐采分点明细（「每分能回到采分点」） */
  breakdown: RubricScoreBreakdown[];
}

/** 取采分点等级占比：先查该采分点自定义等级，再回退默认三档；unknown → null。 */
export function levelRatioOf(criterion: RubricCriterion, rating: CriterionRating): number | null {
  if (rating === "unknown") return null;
  const table = criterion.levels?.length ? criterion.levels : DEFAULT_RUBRIC_LEVELS;
  const found = table.find((l) => l.key === rating);
  if (found) return Math.max(0, Math.min(1, found.ratio));
  // 自定义等级缺失该档时回退默认表（避免作者只定义 full 就丢分）
  const fallback = DEFAULT_RUBRIC_LEVELS.find((l) => l.key === rating);
  return fallback ? fallback.ratio : null;
}

/**
 * 55-05 纯函数：按采分点自评计算得分。
 * - 未评（unknown/未提供）的采分点 earned=null，且不计入 ratedMax 与 finalScore；
 * - 全部评完才给 finalScore，否则 finalScore=null（只给 ratedPercent 的部分视图）；
 * - fallbackFullScore 在 spec.fullScore ≤ 0 时兜底（通常是题目分值 q.score）。
 */
export function scoreRubric(
  spec: RubricSpec,
  assessments: readonly CriterionAssessment[] = [],
  fallbackFullScore = 0,
): RubricScoreResult {
  const fullScore = spec.fullScore > 0 ? spec.fullScore : Math.max(0, fallbackFullScore);
  const byId = new Map(assessments.map((a) => [a.criterionId, a]));
  let earned = 0;
  let ratedMax = 0;
  let unratedCount = 0;
  const breakdown: RubricScoreBreakdown[] = [];

  for (const c of spec.criteria) {
    const max = Math.round(fullScore * c.weight * 100) / 100;
    const a = byId.get(c.id);
    const rating: CriterionRating = a?.rating ?? "unknown";
    const ratio = levelRatioOf(c, rating);
    if (ratio == null) {
      unratedCount++;
      breakdown.push({ criterionId: c.id, label: c.label, weight: c.weight, rating: "unknown", earned: null, max, ratio: null, note: a?.note, example: c.example });
      continue;
    }
    const itemEarned = Math.round(max * ratio * 100) / 100;
    earned = Math.round((earned + itemEarned) * 100) / 100;
    ratedMax = Math.round((ratedMax + max) * 100) / 100;
    breakdown.push({ criterionId: c.id, label: c.label, weight: c.weight, rating, earned: itemEarned, max, ratio, note: a?.note, example: c.example });
  }

  const complete = breakdown.length > 0 && unratedCount === 0;
  const ratedPercent = ratedMax > 0 ? Math.round((earned / ratedMax) * 1000) / 10 : null;
  return {
    earned,
    ratedMax,
    fullScore: Math.round(fullScore * 100) / 100,
    unratedCount,
    complete,
    ratedPercent,
    finalScore: complete ? earned : null,
    breakdown,
  };
}

// ---------- 历史冻结（55-05：旧成绩固定 rubric 版本） ----------

/** 作答事件中的自评快照（随流水 append-only，不因后续改 rubric 被重算） */
export interface RubricAssessmentSnapshot {
  v: 1;
  /** 快照当时的 rubric 修订号（作者后续改 rubric 时用于漂移提示） */
  rubricRevision?: number;
  criteria: {
    criterionId: string;
    label: string;
    weight: number;
    rating: CriterionRating;
    earned: number | null;
    max: number;
  }[];
  earned: number;
  ratedMax: number;
  fullScore: number;
  unratedCount: number;
  complete: boolean;
  ratedPercent: number | null;
  finalScore: number | null;
}

/** 由评分结果生成不可变快照（作答瞬间冻结） */
export function createRubricAssessmentSnapshot(
  result: RubricScoreResult,
  spec: RubricSpec,
): RubricAssessmentSnapshot {
  return {
    v: 1,
    ...(spec.revision != null ? { rubricRevision: spec.revision } : {}),
    criteria: result.breakdown.map((b) => ({
      criterionId: b.criterionId,
      label: b.label,
      weight: b.weight,
      rating: b.rating,
      earned: b.earned,
      max: b.max,
    })),
    earned: result.earned,
    ratedMax: result.ratedMax,
    fullScore: result.fullScore,
    unratedCount: result.unratedCount,
    complete: result.complete,
    ratedPercent: result.ratedPercent,
    finalScore: result.finalScore,
  };
}

/** 快照是否因作者后续修订 rubric 而漂移（历史自评分保持冻结，界面显式标注而非静默重算） */
export function isRubricDrifted(spec: RubricSpec | null | undefined, snapshot: RubricAssessmentSnapshot | null | undefined): boolean {
  if (!snapshot || !spec) return false;
  if ((spec.revision ?? 0) !== (snapshot.rubricRevision ?? 0)) return true;
  const live = new Map(spec.criteria.map((c) => [c.id, c]));
  return snapshot.criteria.some((s) => {
    const c = live.get(s.criterionId);
    return !c || Math.abs(c.weight - s.weight) > 1e-6 || c.label !== s.label;
  });
}

// ---------- 导出（45-08 文本等价物） ----------

/** 自评明细 CSV（UTF-8 BOM）：逐采分点得分可核对 */
export function exportRubricBreakdownCsv(result: RubricScoreResult): string {
  const rows: string[] = [];
  rows.push("小驴考试(内测版) 主观题自评明细");
  rows.push(`题目满分,${result.fullScore}`);
  rows.push(`已评得分,${result.earned}`);
  rows.push(`已评满分,${result.ratedMax}`);
  rows.push(`已评得分率,${result.ratedPercent == null ? "无已评项" : result.ratedPercent + "%"}`);
  rows.push(`最终自评分,${result.finalScore == null ? "未评完" : result.finalScore}`);
  rows.push(`未评采分点数,${result.unratedCount}`);
  rows.push("");
  rows.push("采分点,权重,自评等级,得分,满分,自评依据");
  for (const b of result.breakdown) {
    const ratingLabel = b.rating === "unknown" ? "未评" : (DEFAULT_RUBRIC_LEVELS.find((l) => l.key === b.rating)?.label ?? b.rating);
    rows.push([
      `"${b.label.replace(/"/g, '""')}"`,
      b.weight,
      ratingLabel,
      b.earned == null ? "未评" : b.earned,
      b.max,
      `"${(b.note ?? "").replace(/"/g, '""')}"`,
    ].join(","));
  }
  rows.push("");
  rows.push("说明,自评是学习者对自己作答的判断，不是官方阅卷结论");
  return "\uFEFF" + rows.join("\r\n");
}

/** 自评摘要（复盘/Markdown 导出）：未评与 0 分显式区分 */
export function rubricSummaryText(result: RubricScoreResult): string {
  const lines: string[] = ["【主观题采分点自评】"];
  if (result.finalScore != null) {
    lines.push(`最终自评分：${result.finalScore} / ${result.fullScore}`);
  } else {
    lines.push(`部分自评：${result.earned} / ${result.ratedMax}（已评 ${result.ratedPercent ?? 0}%）· 尚有 ${result.unratedCount} 个采分点未评，未给出最终自评分`);
  }
  for (const b of result.breakdown) {
    const ratingLabel = b.rating === "unknown" ? "未评" : (DEFAULT_RUBRIC_LEVELS.find((l) => l.key === b.rating)?.label ?? b.rating);
    const score = b.earned == null ? "—" : `${b.earned}/${b.max}`;
    lines.push(`- ${b.label}（${ratingLabel}）${score}${b.note ? ` · ${b.note}` : ""}`);
  }
  lines.push("> 自评结果由学习者本人给出，不代表官方阅卷。");
  return lines.join("\n");
}
