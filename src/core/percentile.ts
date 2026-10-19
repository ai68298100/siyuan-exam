// ============================================================
// 63-05 备考虚拟排名与百分位模拟（Mock Percentile Curve）
// 1) 用正态分布模型把模考得分率换算为参考池中的百分位与 Top N% 排名。
// 2) 参考池优先由用户自己的历史模考成绩估计参数；样本不足时回退到
//    显式标注的通用虚拟模型——绝不把虚拟池当作真实考生数据。
// 3) 纯函数无 IO，无外部依赖；提供 PDF/CDF 曲线点、分数段分布与 CSV 文本等价物
//    （45-08 契约：图形、数据表与导出取同一模型快照）。
//
// 诚实边界（63-05 验收要求）：本项目没有真实考生样本，任何排名都是模型演算值。
// 界面、CSV 与导出必须同时给出模型来源与样本量，不使用「击败了 xx% 考生」这类
// 暗示真实人群的措辞。样本不足时 confidence 降级，调用方据此弱化展示。
// ============================================================

/** 参考池参数来源：history=用户历史模考成绩估计；synthetic=通用虚拟模型 */
export type PercentilePoolSource = "history" | "synthetic";

/** 置信等级：modeled=虚拟模型（无真实样本）；indicative=由个人历史样本估计，波动较大 */
export type PercentileConfidence = "indicative" | "modeled";

export interface PercentilePoolModel {
  source: PercentilePoolSource;
  /** 池内得分率均值（百分制 0-100） */
  mean: number;
  /** 池内得分率标准差（百分制点数） */
  sd: number;
  /** 参与参数估计的样本场次（synthetic 恒为 0） */
  sampleSize: number;
  /** history 来源时保留实际分数（升序），供分位点核对与导出 */
  scores?: number[];
}

/** 用历史建模所需的最低场次；低于此值不估计参数（避免 2 场考试推出假分布） */
export const PERCENTILE_MIN_SAMPLES = 5;

/** 通用虚拟模型：百分制考试的经验分布（均值 60、标准差 15），与真实数据无关 */
export const SYNTHETIC_POOL_MEAN = 60;
export const SYNTHETIC_POOL_SD = 15;

/** 标准差下限：低于此值视为退化为单点分布，改用虚拟标准差，避免除零与无限陡峭 */
export const PERCENTILE_MIN_SD = 1;

/** 误差函数 erf（Abramowitz & Stegun 7.1.26 近似，绝对误差 ≤ 1.5e-7）；纯函数。 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const t = 1 / (1 + p * ax);
  const poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;
  const y = 1 - poly * Math.exp(-ax * ax);
  return sign * y;
}

/** 正态分布累积分布函数 P(X ≤ x)，返回 0-1；sd ≤ 0 时返回阶跃值。 */
export function normalCdf(x: number, mean: number, sd: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  if (!Number.isFinite(sd) || sd <= 0) return x < mean ? 0 : 1;
  const z = (x - mean) / (sd * Math.SQRT2);
  const cdf = 0.5 * (1 + erf(z));
  return Math.min(1, Math.max(0, cdf));
}

/** 正态分布概率密度函数（PDF），用于曲线绘制。 */
export function normalPdf(x: number, mean: number, sd: number): number {
  if (!Number.isFinite(sd) || sd <= 0) return 0;
  const z = (x - mean) / sd;
  return (Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI)));
}

/** 样本标准差（总体口径，n 作分母）；n < 2 时返回 0。 */
export function standardDeviation(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
  return Math.sqrt(variance);
}

/**
 * 构建参考池模型。
 * - history 来源：样本 ≥ PERCENTILE_MIN_SAMPLES 且得分率有波动时，用样本均值与标准差；
 *   样本不足或标准差退化（全员同分）时回退虚拟模型，并如实报告 sampleSize。
 * - synthetic：恒定通用模型，sampleSize=0。
 * 只接受有限数值，脏数据（NaN/Infinity）在入口剔除。
 */
export function buildPoolModel(history: readonly number[] = []): PercentilePoolModel {
  const clean = (Array.isArray(history) ? history : [])
    .filter((v) => Number.isFinite(v))
    .map((v) => Math.min(100, Math.max(0, v)));
  if (clean.length >= PERCENTILE_MIN_SAMPLES) {
    const mean = clean.reduce((s, v) => s + v, 0) / clean.length;
    const sd = standardDeviation(clean);
    if (sd >= PERCENTILE_MIN_SD) {
      return {
        source: "history",
        mean: Math.round(mean * 100) / 100,
        sd: Math.round(sd * 100) / 100,
        sampleSize: clean.length,
        scores: [...clean].sort((a, b) => a - b),
      };
    }
  }
  return {
    source: "synthetic",
    mean: SYNTHETIC_POOL_MEAN,
    sd: SYNTHETIC_POOL_SD,
    sampleSize: 0,
  };
}

/** 模型置信等级：虚拟模型恒为 modeled（无真实样本）；历史模型达最低样本即为 indicative。 */
export function poolConfidence(model: PercentilePoolModel): PercentileConfidence {
  return model.source === "history" ? "indicative" : "modeled";
}

export interface PercentileVerdict {
  /** 百分位 0-100：模型池中低于该得分的比例 */
  percentile: number;
  /** Top N% = 100 - percentile，四舍五入到 0.1；越小越靠前 */
  topPercent: number;
  /** 标准分 z=(percent-mean)/sd，用于解释「高出均值几个标准差」 */
  zScore: number;
  /** 输入得分率（百分制 0-100） */
  percent: number;
  model: PercentilePoolModel;
  confidence: PercentileConfidence;
}

/**
 * 由得分率计算百分位排名。percent 为 0-100 得分率；越界值先夹取到区间内。
 * percentile=「低于该分的池内比例」，topPercent=「排名前 N%」。
 */
export function computePercentile(percent: number, model: PercentilePoolModel): PercentileVerdict {
  const p = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const cdf = normalCdf(p, model.mean, model.sd);
  const percentile = Math.round(cdf * 1000) / 10;
  const topPercent = Math.round((100 - cdf * 100) * 10) / 10;
  const zScore = model.sd > 0 ? Math.round(((p - model.mean) / model.sd) * 100) / 100 : 0;
  return {
    percentile,
    topPercent,
    zScore,
    percent: p,
    model,
    confidence: poolConfidence(model),
  };
}

export interface PercentileCurvePoint {
  /** 得分率 0-100 */
  x: number;
  /** 该点的累积概率（百分位）0-100 */
  cdf: number;
  /** 该点的概率密度 0-1（已按曲线峰值归一说明，原值保留） */
  pdf: number;
  /** 是否为用户当前得分所在点 */
  mine: boolean;
}

export interface PercentileCurve {
  points: PercentileCurvePoint[];
  /** 曲线采样区间（含 padding 的得分率范围） */
  xMin: number;
  xMax: number;
  /** 采样区间内 PDF 峰值，供绘制时归一化高度 */
  pdfPeak: number;
  verdict: PercentileVerdict;
}

/**
 * 生成百分位曲线采样点（CDF + PDF + 自身标记），供 SVG 折线/填充图使用。
 * 采样区间以「均值 ± 3 个标准差」为基础并夹取到 0-100，保证覆盖 ≥99.7% 面积。
 */
export function buildPercentileCurve(
  percent: number,
  model: PercentilePoolModel,
  samples = 41,
): PercentileCurve {
  const n = Math.max(2, Math.floor(samples));
  const span = Math.max(model.sd * 3, 10);
  const xMin = Math.max(0, model.mean - span);
  const xMax = Math.min(100, model.mean + span);
  const step = (xMax - xMin) / (n - 1);
  const verdict = computePercentile(percent, model);
  const myX = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));

  const points: PercentileCurvePoint[] = [];
  let pdfPeak = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.round((xMin + step * i) * 100) / 100;
    const cdf = Math.round(normalCdf(x, model.mean, model.sd) * 1000) / 10;
    const pdf = normalPdf(x, model.mean, model.sd);
    if (pdf > pdfPeak) pdfPeak = pdf;
    points.push({ x, cdf, pdf, mine: false });
  }
  // 用户得分可能落在采样网格之间：就近吸附到最近的采样点标记，避免凭空插值
  if (points.length) {
    let nearest = 0;
    let best = Infinity;
    points.forEach((pt, i) => {
      const d = Math.abs(pt.x - myX);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    points[nearest].mine = true;
  }
  return { points, xMin, xMax, pdfPeak: pdfPeak || 1, verdict };
}

export interface ScoreBand {
  /** 段位下界（含） */
  from: number;
  /** 段位上界（不含；末段为 100 含） */
  to: number;
  /** 展示标签，如 "60-70" 或 "≥90" */
  label: string;
  /** 模型下落在该段的理论占比（0-100） */
  share: number;
  /** 用户得分是否落在该段 */
  mine: boolean;
}

/** 生成 10 分一档的分数段分布（0-9 段共 10 档；末段 90-100 含右端点）。
 *  首段下界取 -∞、末段上界取 +∞，使各段占比之和严格为 100%（模型尾部计入两端段，
 *  否则 0 分以下与 100 分以上的概率会凭空丢失，导致分布不足 100%）。 */
export function buildScoreBands(percent: number, model: PercentilePoolModel): ScoreBand[] {
  const p = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const bands: ScoreBand[] = [];
  for (let i = 0; i < 10; i++) {
    const from = i * 10;
    const to = i === 9 ? 100 : from + 10;
    const lower = normalCdf(i === 0 ? -Infinity : from, model.mean, model.sd);
    const upper = normalCdf(i === 9 ? Infinity : to, model.mean, model.sd);
    const share = Math.round((upper - lower) * 1000) / 10;
    const mine = i === 9 ? p >= from : p >= from && p < to;
    bands.push({ from, to, label: i === 9 ? "≥90" : `${from}-${to}`, share, mine });
  }
  return bands;
}

/**
 * 从用户历史模考结果提取得分率序列（脏数据剔除、越界夹取）。
 * history 元素形状与 app.listMockResults() 一致：至少含 percent 数值字段。
 */
export function historyPercents(
  history: readonly { percent?: number | null }[] | null | undefined,
): number[] {
  if (!Array.isArray(history)) return [];
  return history
    .map((h) => (h && typeof h.percent === "number" && Number.isFinite(h.percent) ? h.percent : null))
    .filter((v): v is number => v != null)
    .map((v) => Math.min(100, Math.max(0, v)));
}

/** 45-08 文本等价物：导出百分位模型与分数段分布为 CSV（UTF-8 BOM，严格对齐界面数字）。 */
export function exportPercentileCsv(
  verdict: PercentileVerdict,
  bands: readonly ScoreBand[],
): string {
  const model = verdict.model;
  const sourceLabel = model.source === "history" ? "个人历史模考" : "通用虚拟模型";
  const rows: string[] = [];
  rows.push("小驴考试(内测版) 模考百分位模拟");
  rows.push(`参考池来源,${sourceLabel}`);
  rows.push(`样本场次,${model.sampleSize}`);
  rows.push(`池均值(得分率),${model.mean}%`);
  rows.push(`池标准差,${model.sd}`);
  rows.push(`本次得分率,${verdict.percent}%`);
  rows.push(`估算百分位,${verdict.percentile}%`);
  rows.push(`估算排名(前),${verdict.topPercent}%`);
  rows.push(`标准分 z,${verdict.zScore}`);
  rows.push("");
  rows.push("分数段,模型占比,本次所在");
  for (const b of bands) {
    rows.push(`${b.label},${b.share}%,${b.mine ? "是" : ""}`);
  }
  rows.push("");
  rows.push("说明,此为基于正态分布模型的演算值，不代表真实考生数据");
  return "\uFEFF" + rows.join("\r\n");
}
