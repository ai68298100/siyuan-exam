// ============================================================
// 可重建临时练习集引擎（65-04 / 61-01 / 55-03）
// 纯函数领域层：
// 1. 保存查询声明、题库身份、生成时点与随机种子（不复制题目实体，只存声明）
// 2. 基于声明的确定性重建（同种子 + 同题库版本 = 完全可复现）
// 3. 重建差异比对（新增题、已移除/删除题、内容已修订题）
// 4. 删除视图绝不删除原题；明确写回策略（preview 不写回 / practice 写正常流）
// 规则：严格无外部宿主依赖（禁 import "siyuan"），严禁类型强转。
// ============================================================

import type { Question } from "./types";
import { seededPickN } from "./random";
import { sha1like } from "./answer";

export type PracticeSetWritePolicy = "preview" | "practice";

export interface PracticeSetFilterSpec {
  /** 关键词（题干/选项/解析/考点） */
  keyword?: string;
  /** 题型筛选 */
  types?: Question["type"][];
  /** 考点前缀 */
  kpPrefix?: string;
  /** 来源（real/mock/缺来源） */
  sourceKind?: "real" | "mock";
  /** 仅错题 */
  onlyWrong?: boolean;
  /** 仅收藏 */
  onlyFav?: boolean;
}

export interface AssignmentPackMetadata {
  /** 教师姓名/出卷人 */
  authorName?: string;
  /** 作业/测验建议时长（分钟） */
  targetDurationMinutes?: number;
  /** 及格线分数（默认 60） */
  passLine?: number;
  /** 作业要求与交卷说明 */
  instructions?: string;
  /** 是否防泄密模式（学生在交卷前隐藏答案和解析） */
  strictExamMode?: boolean;
}

/** 可重建练习集声明（版本化信封 v1） */
export interface PracticeSetSpec {
  v: 1;
  id: string;
  name: string;
  bankId: string;
  createdAt: number;
  filter: PracticeSetFilterSpec;
  /** 抽取数量上限 */
  limit: number;
  /** 随机种子（确定性复现） */
  seed: string;
  /** 生成时题库内容指纹（用于版本比对） */
  bankFingerprint: string;
  /** 生成时命中的 qid 与题面指纹（用于重建差异比对） */
  snapshot: { qid: string; hash: string }[];
  /** 写回策略：preview=只看不写；practice=正常练习写流水 */
  writePolicy: PracticeSetWritePolicy;
  /** 教师分发作业包元数据（可选） */
  assignment?: AssignmentPackMetadata;
}

export interface PracticeSetDiff {
  retained: string[];
  added: string[];
  removed: string[];
  revised: string[];
  summary: string;
}

export interface RebuildResult {
  questions: Question[];
  diff: PracticeSetDiff;
  writePolicy: PracticeSetWritePolicy;
  receipt: string;
}

/** 计算题库内容指纹（题目 qid + hash 排序后聚合散列） */
export function computeBankFingerprint(questions: readonly Question[]): string {
  const joined = [...questions]
    .map((q) => `${q.id}:${q.hash}`)
    .sort()
    .join("|");
  return sha1like(joined);
}

/** 过滤谓词：判定题目是否命中临时练习集声明 */
export function matchesPracticeSetFilter(
  q: Question,
  filter: PracticeSetFilterSpec,
  ctx: { wrongQids?: ReadonlySet<string> } = {},
): boolean {
  const kw = filter.keyword?.trim().toLowerCase();
  if (kw) {
    const hay = `${q.stem} ${q.options.join(" ")} ${q.analysis ?? ""} ${q.kp ?? ""} ${q.source ?? ""}`.toLowerCase();
    if (!hay.includes(kw)) return false;
  }
  if (filter.types?.length && !filter.types.includes(q.type)) return false;
  if (filter.kpPrefix && !(q.kp === filter.kpPrefix || q.kp?.startsWith(filter.kpPrefix + "/"))) return false;
  if (filter.sourceKind) {
    const kind = q.sourceKind ?? "mock";
    if (kind !== filter.sourceKind) return false;
  }
  if (filter.onlyWrong && !ctx.wrongQids?.has(q.id)) return false;
  if (filter.onlyFav && !q.fav) return false;
  return true;
}

/** 创建可重建练习集声明（只存查询与种子，不复制题面） */
export function createPracticeSetSpec(options: {
  id: string;
  name: string;
  bankId: string;
  questions: readonly Question[];
  filter?: PracticeSetFilterSpec;
  limit?: number;
  seed?: string;
  writePolicy?: PracticeSetWritePolicy;
  nowMs?: number;
  wrongQids?: ReadonlySet<string>;
}): PracticeSetSpec {
  const filter = options.filter ?? {};
  const limit = Math.max(1, options.limit ?? 20);
  const seed = options.seed ?? `seed-${options.nowMs ?? Date.now()}`;

  const matched = options.questions.filter((q) => matchesPracticeSetFilter(q, filter, { wrongQids: options.wrongQids }));
  const picked = seededPickN(matched, limit, seed);

  return {
    v: 1,
    id: options.id,
    name: options.name,
    bankId: options.bankId,
    createdAt: options.nowMs ?? Date.now(),
    filter,
    limit,
    seed,
    bankFingerprint: computeBankFingerprint(options.questions),
    snapshot: picked.map((q) => ({ qid: q.id, hash: q.hash })),
    writePolicy: options.writePolicy ?? "practice",
  };
}

/** 基于声明重建练习集（题库变化时给出新增/移除/修订差异，不静默替换） */
export function rebuildPracticeSet(options: {
  spec: PracticeSetSpec;
  liveQuestions: readonly Question[];
  wrongQids?: ReadonlySet<string>;
}): RebuildResult {
  const { spec, liveQuestions } = options;
  const byId = new Map(liveQuestions.map((q) => [q.id, q]));
  const snapMap = new Map(spec.snapshot.map((s) => [s.qid, s.hash]));

  const retained: string[] = [];
  const removed: string[] = [];
  const revised: string[] = [];
  for (const s of spec.snapshot) {
    const live = byId.get(s.qid);
    if (!live) removed.push(s.qid);
    else if (live.hash !== s.hash) revised.push(s.qid);
    else retained.push(s.qid);
  }

  // 重建：保留顺序优先，新增命中项补入（不静默改变已存在项顺序）
  // 注意：快照外新增项仅在仍有配额时补入，不应超出用户声明的 limit
  const matched = liveQuestions.filter((q) => matchesPracticeSetFilter(q, spec.filter, { wrongQids: options.wrongQids }));
  const remainingQuota = Math.max(0, spec.limit - retained.length - revised.length);
  const added = matched
    .filter((q) => !snapMap.has(q.id))
    .slice(0, remainingQuota)
    .map((q) => q.id);

  const orderedIds = [
    ...spec.snapshot.map((s) => s.qid).filter((id) => byId.has(id)),
    ...added,
  ].slice(0, spec.limit);

  const questions = orderedIds.map((id) => byId.get(id)!).filter(Boolean);

  const summary = [
    `保留 ${retained.length} 题`,
    added.length ? `新增 ${added.length} 题` : "",
    removed.length ? `已删除 ${removed.length} 题` : "",
    revised.length ? `已修订 ${revised.length} 题` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const writeNote =
    spec.writePolicy === "preview"
      ? "预览模式：本次作答不写回任何流水与调度。"
      : "练习模式：作答正常写入流水（不影响其他视图）。";

  return {
    questions,
    diff: { retained, added, removed, revised, summary },
    writePolicy: spec.writePolicy,
    receipt: `练习集「${spec.name}」重建完成：${summary}。${writeNote} 删除视图不会移除题库原题。`,
  };
}

/** 判定声明是否已过期（题库指纹变化或版本升级） */
export function isPracticeSetStale(spec: PracticeSetSpec, liveQuestions: readonly Question[]): boolean {
  if (spec.v !== 1) return true;
  return computeBankFingerprint(liveQuestions) !== spec.bankFingerprint;
}

/**
 * 教师将选定题目封装为学生便携作业集（Assignment Pack）
 */
export function createAssignmentPack(options: {
  id?: string;
  name: string;
  bankId: string;
  questions: readonly Question[];
  metadata?: AssignmentPackMetadata;
}): PracticeSetSpec {
  const spec = createPracticeSetSpec({
    id: options.id ?? `assign-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000).toString(36)}`,
    name: options.name,
    bankId: options.bankId,
    questions: options.questions,
    limit: options.questions.length,
    writePolicy: "practice",
  });
  if (options.metadata) {
    spec.assignment = options.metadata;
  }
  return spec;
}
