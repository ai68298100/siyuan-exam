import { describe, it, expect } from "vitest";
import {
  erf,
  normalCdf,
  normalPdf,
  standardDeviation,
  buildPoolModel,
  poolConfidence,
  computePercentile,
  buildPercentileCurve,
  buildScoreBands,
  historyPercents,
  exportPercentileCsv,
  PERCENTILE_MIN_SAMPLES,
  PERCENTILE_MIN_SD,
  SYNTHETIC_POOL_MEAN,
  SYNTHETIC_POOL_SD,
  type PercentilePoolModel,
} from "../src/core/percentile";

describe("63-05 模考虚拟百分位排名（Mock Percentile Curve）", () => {
  const synthetic: PercentilePoolModel = {
    source: "synthetic",
    mean: SYNTHETIC_POOL_MEAN,
    sd: SYNTHETIC_POOL_SD,
    sampleSize: 0,
  };

  describe("erf / normalCdf / normalPdf 数学正确性", () => {
    it("erf 满足奇函数与已知值（erf(0)=0，erf(1)≈0.8427）", () => {
      expect(erf(0)).toBeCloseTo(0, 6);
      expect(erf(1)).toBeCloseTo(0.8427, 3);
      expect(erf(-1)).toBeCloseTo(-erf(1), 9);
    });

    it("normalCdf 在均值处为 0.5、±1σ 约为 0.1587 / 0.8413", () => {
      expect(normalCdf(60, 60, 15)).toBeCloseTo(0.5, 4);
      expect(normalCdf(45, 60, 15)).toBeCloseTo(0.1587, 3);
      expect(normalCdf(75, 60, 15)).toBeCloseTo(0.8413, 3);
    });

    it("normalCdf 在 ±2σ / ±3σ 与查表值一致", () => {
      expect(normalCdf(30, 60, 15)).toBeCloseTo(0.0228, 3);
      expect(normalCdf(90, 60, 15)).toBeCloseTo(0.9772, 3);
    });

    it("normalCdf 对不可用 sd 退化为阶跃、对 ±Infinity 收敛到 0/1", () => {
      expect(normalCdf(59, 60, 0)).toBe(0);
      expect(normalCdf(61, 60, 0)).toBe(1);
      expect(normalCdf(Infinity, 60, 15)).toBe(1);
      expect(normalCdf(-Infinity, 60, 15)).toBe(0);
    });

    it("normalPdf 峰值在均值处、关于均值对称且总面积近似 1", () => {
      const peak = normalPdf(60, 60, 15);
      expect(normalPdf(45, 60, 15)).toBeCloseTo(normalPdf(75, 60, 15), 9);
      expect(peak).toBeGreaterThan(normalPdf(75, 60, 15));
      // 梯形法在 mean±5σ 内积分，验证归一化
      const step = 0.25;
      let area = 0;
      for (let x = 60 - 75; x < 60 + 75; x += step) {
        area += ((normalPdf(x, 60, 15) + normalPdf(x + step, 60, 15)) / 2) * step;
      }
      expect(area).toBeCloseTo(1, 2);
    });

    it("normalPdf 对 sd ≤ 0 返回 0（不产生 NaN/Infinity）", () => {
      expect(normalPdf(60, 60, 0)).toBe(0);
      expect(Number.isFinite(normalPdf(60, 60, -1))).toBe(true);
    });
  });

  describe("standardDeviation 样本统计", () => {
    it("总体标准差口径正确（n 作分母）", () => {
      expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 6);
    });

    it("少于 2 个样本返回 0（不伪造波动）", () => {
      expect(standardDeviation([])).toBe(0);
      expect(standardDeviation([80])).toBe(0);
    });
  });

  describe("buildPoolModel 参考池构建与诚实边界", () => {
    it("样本不足时回退通用虚拟模型，并如实报告 sampleSize=0", () => {
      const model = buildPoolModel([80, 70, 90]);
      expect(PERCENTILE_MIN_SAMPLES).toBe(5);
      expect(model.source).toBe("synthetic");
      expect(model.mean).toBe(SYNTHETIC_POOL_MEAN);
      expect(model.sd).toBe(SYNTHETIC_POOL_SD);
      expect(model.sampleSize).toBe(0);
    });

    it("样本达标且有波动时用历史均值与标准差建模", () => {
      const history = [50, 60, 70, 80, 90];
      const model = buildPoolModel(history);
      expect(model.source).toBe("history");
      expect(model.mean).toBeCloseTo(70, 6);
      expect(model.sd).toBeCloseTo(standardDeviation(history), 2);
      expect(model.sampleSize).toBe(5);
      expect(model.scores).toEqual([50, 60, 70, 80, 90]);
    });

    it("样本达标但全员同分（标准差退化）时回退虚拟模型，不产生无限陡峭分布", () => {
      const model = buildPoolModel([75, 75, 75, 75, 75, 75]);
      expect(model.source).toBe("synthetic");
      expect(model.sampleSize).toBe(0);
      expect(PERCENTILE_MIN_SD).toBeGreaterThan(0);
    });

    it("剔除 NaN/Infinity 脏数据，且越界得分被夹取到 0-100", () => {
      const model = buildPoolModel([NaN, Infinity, -Infinity, 50, 60, 70, 80, 90, 150]);
      expect(model.source).toBe("history");
      // 150 被夹到 100；NaN/Infinity 被剔除 → 6 个有效样本
      expect(model.sampleSize).toBe(6);
      expect(model.scores).toEqual([50, 60, 70, 80, 90, 100]);
    });

    it("空输入与非数组历史都安全回退虚拟模型", () => {
      for (const input of [[], null, undefined] as const) {
        const model = buildPoolModel(input as number[]);
        expect(model.source).toBe("synthetic");
        expect(model.sampleSize).toBe(0);
      }
    });
  });

  describe("computePercentile 百分位换算", () => {
    it("均值得分对应 50 百分位、Top 50%", () => {
      const v = computePercentile(60, synthetic);
      expect(v.percentile).toBeCloseTo(50, 1);
      expect(v.topPercent).toBeCloseTo(50, 1);
      expect(v.zScore).toBeCloseTo(0, 2);
    });

    it("高出 1σ 约为 84.1 百分位、Top 15.9%", () => {
      const v = computePercentile(75, synthetic);
      expect(v.percentile).toBeCloseTo(84.1, 1);
      expect(v.topPercent).toBeCloseTo(15.9, 1);
      expect(v.zScore).toBeCloseTo(1, 2);
    });

    it("百分位与 Top% 之和恒为 100（同一模型快照）", () => {
      for (const p of [0, 25, 60, 88, 100]) {
        const v = computePercentile(p, synthetic);
        expect(v.percentile + v.topPercent).toBeCloseTo(100, 1);
      }
    });

    it("越界与非法得分率被夹取/归零，不产生 NaN", () => {
      expect(computePercentile(150, synthetic).percent).toBe(100);
      expect(computePercentile(-20, synthetic).percent).toBe(0);
      const bad = computePercentile(NaN, synthetic);
      expect(Number.isFinite(bad.percentile)).toBe(true);
      expect(bad.percent).toBe(0);
    });

    it("低分对应低百分位，排名随得分单调靠前", () => {
      const low = computePercentile(30, synthetic);
      const high = computePercentile(90, synthetic);
      expect(low.percentile).toBeLessThan(high.percentile);
      expect(low.topPercent).toBeGreaterThan(high.topPercent);
      expect(high.zScore).toBeGreaterThan(low.zScore);
    });

    it("虚拟机模型置信度为 modeled，历史模型为 indicative", () => {
      expect(computePercentile(60, synthetic).confidence).toBe("modeled");
      const hist = buildPoolModel([50, 60, 70, 80, 90]);
      expect(poolConfidence(hist)).toBe("indicative");
      expect(computePercentile(70, hist).confidence).toBe("indicative");
    });
  });

  describe("buildPercentileCurve 曲线采样", () => {
    it("采样点覆盖均值 ±3σ 区间，CDF 单调不减", () => {
      const curve = buildPercentileCurve(75, synthetic, 41);
      expect(curve.points.length).toBe(41);
      expect(curve.xMin).toBeGreaterThanOrEqual(0);
      expect(curve.xMax).toBeLessThanOrEqual(100);
      for (let i = 1; i < curve.points.length; i++) {
        expect(curve.points[i].cdf).toBeGreaterThanOrEqual(curve.points[i - 1].cdf);
      }
    });

    it("标记用户得分所在采样点且仅一个", () => {
      const curve = buildPercentileCurve(75, synthetic, 41);
      expect(curve.points.filter((p) => p.mine).length).toBe(1);
      expect(curve.verdict.percent).toBe(75);
    });

    it("PDF 峰值 > 0，供绘制归一化不出现除零", () => {
      const curve = buildPercentileCurve(60, synthetic, 21);
      expect(curve.pdfPeak).toBeGreaterThan(0);
      expect(Number.isFinite(curve.pdfPeak)).toBe(true);
    });

    it("采样数过小被夹取到至少 2 个点", () => {
      expect(buildPercentileCurve(60, synthetic, 1).points.length).toBe(2);
      expect(buildPercentileCurve(60, synthetic, 0).points.length).toBe(2);
    });
  });

  describe("buildScoreBands 分数段分布", () => {
    it("生成 10 个档位、末段为 ≥90 且覆盖 0-100", () => {
      const bands = buildScoreBands(75, synthetic);
      expect(bands.length).toBe(10);
      expect(bands[0].label).toBe("0-10");
      expect(bands[9].label).toBe("≥90");
      expect(bands[9].from).toBe(90);
      expect(bands[9].to).toBe(100);
    });

    it("各段占比之和约为 100%（完整概率覆盖，容差=10 段各 0.1% 舍入）", () => {
      const bands = buildScoreBands(60, synthetic);
      const sum = bands.reduce((s, b) => s + b.share, 0);
      // 每段占比显示精度为 0.1%，10 段累计舍入误差上界 0.5%
      expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.5);
    });

    it("恰好标记一个段位为本次所在；边界 90 落在末段", () => {
      const mid = buildScoreBands(75, synthetic);
      expect(mid.filter((b) => b.mine).length).toBe(1);
      expect(mid.find((b) => b.mine)?.label).toBe("70-80");

      const top = buildScoreBands(90, synthetic);
      expect(top.find((b) => b.mine)?.label).toBe("≥90");

      const bottom = buildScoreBands(0, synthetic);
      expect(bottom.filter((b) => b.mine).length).toBe(1);
      expect(bottom.find((b) => b.mine)?.label).toBe("0-10");
    });

    it("均值附近段位占比高于极端段位（钟形分布）", () => {
      const bands = buildScoreBands(60, synthetic);
      const near = bands[5].share + bands[6].share; // 50-60, 60-70
      const tail = bands[0].share + bands[9].share; // 0-10, ≥90
      expect(near).toBeGreaterThan(tail);
    });
  });

  describe("historyPercents 历史提取", () => {
    it("提取 percent 字段并剔除缺字段/非数值项", () => {
      const out = historyPercents([
        { percent: 80 },
        { percent: null },
        {},
        { percent: 62.5 },
      ]);
      expect(out).toEqual([80, 62.5]);
    });

    it("越界值夹取到 0-100，非数组输入返回空", () => {
      expect(historyPercents([{ percent: 130 }, { percent: -5 }])).toEqual([100, 0]);
      expect(historyPercents(null)).toEqual([]);
      expect(historyPercents(undefined)).toEqual([]);
    });
  });

  describe("exportPercentileCsv 文本等价物（45-08）", () => {
    it("导出含 BOM、模型来源、样本量与诚实说明", () => {
      const model = buildPoolModel([50, 60, 70, 80, 90]);
      const verdict = computePercentile(70, model);
      const csv = exportPercentileCsv(verdict, buildScoreBands(70, model));
      expect(csv.startsWith("\uFEFF")).toBe(true);
      expect(csv).toContain("个人历史模考");
      expect(csv).toContain("样本场次,5");
      expect(csv).toContain("估算百分位");
      expect(csv).toContain("不代表真实考生数据");
      expect(csv.split("\r\n").length).toBeGreaterThan(12);
    });

    it("虚拟模型导出标注通用虚拟模型与零样本", () => {
      const verdict = computePercentile(60, synthetic);
      const csv = exportPercentileCsv(verdict, buildScoreBands(60, synthetic));
      expect(csv).toContain("通用虚拟模型");
      expect(csv).toContain("样本场次,0");
    });

    it("CSV 中的百分位与界面渲染取自同一 verdict 快照", () => {
      const verdict = computePercentile(85, synthetic);
      const csv = exportPercentileCsv(verdict, buildScoreBands(85, synthetic));
      expect(csv).toContain(`估算百分位,${verdict.percentile}%`);
      expect(csv).toContain(`估算排名(前),${verdict.topPercent}%`);
    });
  });
});
