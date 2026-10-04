// ============================================================
// 题库健康（TODO 2.2）：重复检测（精确哈希 + 相似度）与字段缺失清单
// 纯函数、离线可用（题库读不到时上层按守卫降级，本层不做 IO）。
// 相似度：中英混合友好 —— 字符 2-gram Jaccard，题干+选项合并比较。
// ============================================================
import type { Question } from "./types";

export interface DupCluster {
  ids: string[];
  similarity: number; // 0-1（精确重复=1）
  sampleStem: string; // 展示用：首题题干截断
}

export interface MissingFieldRow {
  field: string; // answer | analysis | kp | source | options | groupOfMaterial
  count: number;
  qids: string[]; // 上限内命中的题目 id（截断见 LIMIT_PER_FIELD）
}

export interface BankHealthReport {
  total: number;
  clusters: DupCluster[]; // 全部重复簇（similarity=1 即精确重复）
  missing: MissingFieldRow[];
}

const LIMIT_PER_FIELD = 50; // 清单截断：UI 显示 count 全量、qid 只带前 50
const FUZZY_THRESHOLD = 0.82;
const MAX_FUZZY_SCAN = 3000; // 超大题库退化为只查精确重复（万题 O(n²) 不可接受）

// ---------- 相似度 ----------

function bigrams(s: string): Set<string> {
  const t = s.toLowerCase().replace(/\s+/g, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out.size ? out : new Set([t]);
}

export function jaccard(a: string, b: string): number {
  const A = bigrams(a),
    B = bigrams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

function stemFingerprint(q: Question): string {
  return (q.stem + "\u0000" + q.options.join("\u0001")).replace(/\s+/g, "");
}

// ---------- 重复检测 ----------

/** 精确重复（哈希一致）先归组；组内再与 2-gram 相似度合并为簇（阈值 FUZZY_THRESHOLD） */
export function duplicateClusters(qs: Question[], threshold = FUZZY_THRESHOLD): DupCluster[] {
  const exact = new Map<string, Question[]>();
  for (const q of qs) {
    // 精确归组用空白归一指纹：仅排版差异（空格/换行）视为重复；q.hash 保留原导入语义不覆盖
    const key = stemFingerprint(q);
    const arr = exact.get(key) ?? [];
    arr.push(q);
    exact.set(key, arr);
  }
  const clusters: DupCluster[] = [];
  const consumed = new Set<string>();
  for (const group of exact.values()) {
    if (group.length > 1) {
      clusters.push(clusterOf(group, 1));
      group.forEach((q) => consumed.add(q.id));
    }
  }
  // 模糊簇：仅未进入精确组的题参与（避免簇重复计数）；超大库跳过
  if (qs.length <= MAX_FUZZY_SCAN) {
    const rest = qs.filter((q) => !consumed.has(q.id));
    const used = new Set<string>();
    for (let i = 0; i < rest.length; i++) {
      if (used.has(rest[i].id)) continue;
      const group = [rest[i]];
      used.add(rest[i].id);
      for (let j = i + 1; j < rest.length; j++) {
        if (used.has(rest[j].id)) continue;
        const sim = jaccard(stemFingerprint(rest[i]), stemFingerprint(rest[j]));
        if (sim >= threshold) {
          group.push(rest[j]);
          used.add(rest[j].id);
        }
      }
      if (group.length > 1) clusters.push(clusterOf(group, threshold));
    }
  }
  return clusters;
}

function clusterOf(group: Question[], similarity: number): DupCluster {
  return {
    ids: group.map((q) => q.id),
    similarity,
    sampleStem: group[0].stem.slice(0, 60),
  };
}

// ---------- 字段缺失清单 ----------

const CHOICE_TYPES = new Set(["single", "multiple"]);

/** 按题型体检：选择题必须有 ≥2 选项与答案；全部题型要求解析/考点/出处（缺计缺失） */
export function missingFields(qs: Question[]): MissingFieldRow[] {
  const miss = (field: string, ids: string[]): MissingFieldRow => ({
    field,
    count: ids.length,
    qids: ids.slice(0, LIMIT_PER_FIELD),
  });
  const noAnalysis: string[] = [],
    noKp: string[] = [],
    noSource: string[] = [];
  const noOptions: string[] = [],
    noAnswer: string[] = [];
  for (const q of qs) {
    if (!q.analysis?.trim()) noAnalysis.push(q.id);
    if (!q.kp?.trim()) noKp.push(q.id);
    if (!q.source?.trim()) noSource.push(q.id);
    if (CHOICE_TYPES.has(q.type)) {
      if (q.options.filter((o) => o.trim()).length < 2) noOptions.push(q.id);
      if (!q.answer.trim()) noAnswer.push(q.id);
    }
  }
  const rows = [
    miss("analysis", noAnalysis),
    miss("kp", noKp),
    miss("source", noSource),
    miss("options", noOptions),
    miss("answer", noAnswer),
  ];
  return rows.filter((r) => r.count > 0);
}

export function bankHealthReport(qs: Question[]): BankHealthReport {
  return {
    total: qs.length,
    clusters: duplicateClusters(qs),
    missing: missingFields(qs),
  };
}

// ---------- 生产者覆盖概览（TODO 43-04 lite）：题型/来源/考点覆盖 + 内容缺陷，UI 逐项可跳过滤列表 ----------

export interface CoverageStats {
  byType: { type: string; count: number }[];
  /** distinct 来源数 / 缺来源题数 */
  sources: number;
  sourceMissing: number;
  /** 考点顶层覆盖（/ 分层首段） */
  kpTops: { top: string; count: number }[];
  kpMissing: number;
  /** 内容缺陷：短解析（有解析但 <10 字）题数 */
  shortAnalysis: number;
  /** 51-03 lite：有题考点数 / 已学考点数（至少一题作答过；attemptedQids 未注入时 null） */
  kpCovered: number;
  kpLearned: number | null;
}

export function coverageStats(qs: Question[], attemptedQids?: Set<string>): CoverageStats {
  const byType = new Map<string, number>();
  const sources = new Set<string>();
  let sourceMissing = 0;
  const kpTops = new Map<string, number>();
  const kpTopsAttempted = new Set<string>();
  let kpMissing = 0;
  let shortAnalysis = 0;
  for (const q of qs) {
    byType.set(q.type, (byType.get(q.type) ?? 0) + 1);
    const src = (q.source ?? "").trim();
    if (src) sources.add(src);
    else sourceMissing++;
    const kp = (q.kp ?? "").trim();
    if (kp) {
      const top = kp.split("/")[0].trim();
      kpTops.set(top, (kpTops.get(top) ?? 0) + 1);
      // 51-03 lite：已学覆盖=该考点下至少有一题作答过（attemptedQids 由调用方注入）
      if (attemptedQids?.has(q.id)) kpTopsAttempted.add(top);
    } else kpMissing++;
    const analysis = (q.analysis ?? "").trim();
    if (analysis.length > 0 && analysis.length < 10) shortAnalysis++;
  }
  return {
    byType: [...byType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    sources: sources.size,
    sourceMissing,
    kpTops: [...kpTops.entries()].map(([top, count]) => ({ top, count })).sort((a, b) => b.count - a.count),
    kpMissing,
    shortAnalysis,
    /** 51-03：有题考点 / 已学考点（有题且至少一题作答过）；attemptedQids 未注入时 learned 为 null */
    kpCovered: kpTops.size,
    kpLearned: attemptedQids ? kpTopsAttempted.size : null,
  };
}

// ---------- 67-03 lite：答案分布异常 + 未审校比例 ----------

export interface AnswerDistribution {
  /** 字母 → 选择题答案计数（仅单选/多选；多选逐字母计） */
  counts: Record<string, number>;
  total: number; // 参与分布统计的答案字母总数
  /** 异常判定（样本 ≥10 才判定，55-04 公平性口径）：skewed=单一字母占比 >60% */
  skewed: string | null;
  skewedRatio: number | null; // 0-100
  /** 零次字母（A..最大出现字母全集中从未出现的） */
  starved: string[];
}

const DIST_MIN_SAMPLE = 10;
const SKEW_RATIO = 60;

/** 选择题答案字母分布与异常检测（公平比较：答案可猜测性来自分布偏斜）。
 *  零次字母参照系=选择题的选项字母全集（取题库内最大选项数，≤J）。 */
export function answerDistribution(qs: readonly Question[]): AnswerDistribution {
  const counts: Record<string, number> = {};
  let total = 0;
  let maxOptions = 4;
  for (const q of qs) {
    if (q.type !== "single" && q.type !== "multiple") continue;
    maxOptions = Math.max(maxOptions, q.options.length);
    for (const ch of q.answer.toUpperCase()) {
      if (!/^[A-Z]$/.test(ch)) continue;
      counts[ch] = (counts[ch] ?? 0) + 1;
      total++;
    }
  }
  let skewed: string | null = null;
  let skewedRatio: number | null = null;
  const starved = new Set<string>();
  if (total >= DIST_MIN_SAMPLE) {
    for (const [letter, n] of Object.entries(counts)) {
      const ratio = Math.round((n / total) * 100);
      if (ratio > SKEW_RATIO) {
        skewed = letter;
        skewedRatio = ratio;
      }
    }
    const universe = Math.min(maxOptions, 26);
    for (let c = 65; c < 65 + universe; c++) {
      const letter = String.fromCharCode(c);
      if (!counts[letter]) starved.add(letter);
    }
  }
  return { counts, total, skewed, skewedRatio, starved: [...starved].sort() };
}

/** 未审校比例：AI 生成且 review=pending 的题数与占比（67-03 未审校比例口径） */
export function unreviewedStats(qs: readonly Question[]): { count: number; ratio: number | null } {
  const ai = qs.filter((q) => q.origin === "ai");
  if (!ai.length) return { count: 0, ratio: null };
  const pending = ai.filter((q) => (q.review ?? "pending") === "pending").length;
  return { count: pending, ratio: Math.round((pending / ai.length) * 100) };
}
