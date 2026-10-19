import { describe, it, expect } from "vitest";
import {
  extractRadarDimensions,
  buildRadarChartModel,
  exportRadarDimensionsCsv,
  RADAR_MIN_DIMENSIONS,
  RADAR_MAX_DIMENSIONS,
  type RadarDimension,
} from "../src/core/radar";
import type { KpMastery } from "../src/core/report";

describe("63-04 知识点掌握度能力雷达图（Radar Chart）", () => {
  const mockMastery = (root: string, mastery: number, accuracy = 0.8, coverage = 0.6, total = 10): KpMastery => ({
    root,
    mastery,
    accuracy,
    coverage,
    total,
    independent: 5,
    streak: 2,
    children: [],
  });

  describe("extractRadarDimensions", () => {
    it("考点少于 3 个时返回空数组（无法构成有效多边形）", () => {
      expect(RADAR_MIN_DIMENSIONS).toBe(3);
      const list = [
        mockMastery("民法", 0.85),
        mockMastery("刑法", 0.70),
      ];
      expect(extractRadarDimensions(list)).toEqual([]);
    });

    it("自动过滤空 root 或空白名称的脏数据", () => {
      const list = [
        mockMastery("民法", 0.85),
        mockMastery("", 0.9),
        mockMastery("   ", 0.5),
        mockMastery("刑法", 0.70),
        mockMastery("行政法", 0.60),
      ];
      const dims = extractRadarDimensions(list);
      expect(dims.length).toBe(3);
      expect(dims.map((d) => d.label)).toEqual(["民法", "刑法", "行政法"]);
    });

    it("超出最大维度数（默认 8）时自动截断前 8 个顶层考点", () => {
      const list = Array.from({ length: 12 }, (_, i) => mockMastery(`考点${i + 1}`, 0.5 + i * 0.03));
      const dims = extractRadarDimensions(list);
      expect(dims.length).toBe(RADAR_MAX_DIMENSIONS);
      expect(dims[0].label).toBe("考点1");
      expect(dims[7].label).toBe("考点8");
    });

    it("正确处理 mastery < 0（数据不足）的考点，得分记为 0 且保留维度", () => {
      const list = [
        mockMastery("宪法", -1, 0, -1, 0),
        mockMastery("经济法", 0.8, 0.8, 0.5, 4),
        mockMastery("诉讼法", 0.6, 0.6, 0.4, 6),
      ];
      const dims = extractRadarDimensions(list);
      expect(dims.length).toBe(3);
      expect(dims[0].score).toBe(0);
      expect(dims[1].score).toBe(80);
      expect(dims[2].score).toBe(60);
    });
  });

  describe("buildRadarChartModel", () => {
    it("少于 3 维度时返回 null", () => {
      expect(buildRadarChartModel([])).toBeNull();
      expect(buildRadarChartModel([{ label: "A", score: 80, accuracy: 80, coverage: 50, totalAttempts: 5 }])).toBeNull();
    });

    it("为 5 维度考点正确生成网格同心环与轴线", () => {
      const dims: RadarDimension[] = [
        { label: "民法", score: 85, accuracy: 85, coverage: 70, totalAttempts: 20 },
        { label: "刑法", score: 60, accuracy: 60, coverage: 50, totalAttempts: 15 },
        { label: "行政法", score: 90, accuracy: 90, coverage: 80, totalAttempts: 18 },
        { label: "商法", score: 40, accuracy: 40, coverage: 30, totalAttempts: 10 },
        { label: "诉讼法", score: 75, accuracy: 75, coverage: 65, totalAttempts: 12 },
      ];
      const model = buildRadarChartModel(dims, { size: 320, radius: 100 });
      expect(model).not.toBeNull();
      if (!model) return;

      expect(model.centerX).toBe(160);
      expect(model.centerY).toBe(160);
      expect(model.radius).toBe(100);

      // 4 层同心网格环（25%, 50%, 75%, 100%）
      expect(model.rings.length).toBe(4);
      expect(model.rings[0].label).toBe("25%");
      expect(model.rings[3].label).toBe("100%");

      // 5 根轴线
      expect(model.axes.length).toBe(5);
      expect(model.axes[0].label).toBe("民法");
      // 第一个点在 12 点钟方向（angle = -PI/2）：x = centerX, y = centerY - radius
      expect(model.axes[0].to.x).toBeCloseTo(160, 1);
      expect(model.axes[0].to.y).toBeCloseTo(60, 1);

      // 5 个顶点构成的多边形 points 字符串
      expect(model.points.length).toBe(5);
      expect(model.polygonPointsString.split(" ").length).toBe(5);
    });

    it("零分或极低分保留最小 3% 半径，避免聚拢退化为看不见的奇点", () => {
      const dims: RadarDimension[] = [
        { label: "A", score: 0, accuracy: 0, coverage: 0, totalAttempts: 0 },
        { label: "B", score: 100, accuracy: 100, coverage: 100, totalAttempts: 10 },
        { label: "C", score: 50, accuracy: 50, coverage: 50, totalAttempts: 5 },
      ];
      const model = buildRadarChartModel(dims, { size: 300, radius: 100 });
      expect(model).not.toBeNull();
      if (!model) return;

      // A 点应在 12 点钟方向，距离中心至少 3px (100 * 0.03)
      const pA = model.points[0];
      const dist = Math.hypot(pA.x - model.centerX, pA.y - model.centerY);
      expect(dist).toBeCloseTo(3, 1);
    });
  });

  describe("exportRadarDimensionsCsv", () => {
    it("输出带 UTF-8 BOM 的规范 CSV，并正确处理引号转义", () => {
      const dims: RadarDimension[] = [
        { label: "民法（物权篇）", score: 85, accuracy: 80, coverage: 70, totalAttempts: 25 },
        { label: '刑法"总则"', score: 90, accuracy: 90, coverage: 85, totalAttempts: 30 },
        { label: "行政法", score: 65, accuracy: 60, coverage: 50, totalAttempts: 10 },
      ];
      const csv = exportRadarDimensionsCsv(dims);
      expect(csv.startsWith("\uFEFF")).toBe(true);
      expect(csv).toContain("核心考点,综合掌握度,正确率,覆盖率,作答次数");
      expect(csv).toContain('"民法（物权篇）",85%,80%,70%,25');
      expect(csv).toContain('"刑法""总则""",90%,90%,85%,30');
    });
  });
});
