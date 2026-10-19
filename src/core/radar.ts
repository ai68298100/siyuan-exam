// ============================================================
// 63-04 知识点掌握度能力雷达图（Knowledge Radar Chart）
// 1) 提取考点树顶层前 3-8 个核心维度，计算多边形顶点坐标、同心轴网格与标签方位。
// 2) 极坐标 (r, theta) 转换为直角坐标 (x, y)，自适应 12 点钟方向顺时针展开。
// 3) 纯函数无 IO，无任何外部库依赖；提供结构化数据表与 CSV 文本等价物（45-08 契约）。
// ============================================================

import type { KpMastery } from "./report";

export interface RadarDimension {
  label: string; // 考点名称
  score: number; // 0-100 综合得分（掌握度百分比或正确率）
  accuracy: number; // 0-100
  coverage: number; // 0-100
  totalAttempts: number;
}

export interface RadarPoint {
  x: number;
  y: number;
}

export interface RadarAxis {
  label: string;
  from: RadarPoint;
  to: RadarPoint;
  labelPoint: RadarPoint;
  anchor: "middle" | "start" | "end";
}

export interface RadarWebRing {
  level: number; // 0.25, 0.5, 0.75, 1
  label: string;
  pointsString: string;
}

export interface RadarChartModel {
  centerX: number;
  centerY: number;
  radius: number;
  dimensions: RadarDimension[];
  axes: RadarAxis[];
  rings: RadarWebRing[];
  polygonPointsString: string;
  points: RadarPoint[];
}

export const RADAR_MIN_DIMENSIONS = 3;
export const RADAR_MAX_DIMENSIONS = 8;

/** 从 KpMastery 列表提取雷达图所需的顶层维度（取前 3-8 个维度） */
export function extractRadarDimensions(
  masteryList: readonly KpMastery[],
  maxDims = RADAR_MAX_DIMENSIONS,
): RadarDimension[] {
  const filtered = masteryList.filter((m) => m.root && m.root.trim().length > 0);
  const candidates = filtered.slice(0, maxDims);
  if (candidates.length < RADAR_MIN_DIMENSIONS) return [];

  return candidates.map((m) => {
    // 若数据不足（mastery < 0），得分记为 0，保留维度
    const score = m.mastery >= 0 ? Math.round(m.mastery * 100) : 0;
    const accuracy = Math.round(m.accuracy * 100);
    const coverage = m.coverage >= 0 ? Math.round(m.coverage * 100) : 0;
    return {
      label: m.root,
      score: Math.max(0, Math.min(100, score)),
      accuracy,
      coverage,
      totalAttempts: m.total,
    };
  });
}

/** 63-04 纯函数：计算雷达图直角几何坐标模型 */
export function buildRadarChartModel(
  dimensions: readonly RadarDimension[],
  opts?: {
    size?: number; // SVG 画布边长（默认 320）
    radius?: number; // 外圈半径（默认 110）
  },
): RadarChartModel | null {
  const n = dimensions.length;
  if (n < RADAR_MIN_DIMENSIONS) return null;

  const size = opts?.size ?? 320;
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = opts?.radius ?? 110;

  // 1. 同心网格环（25%, 50%, 75%, 100%）
  const ringLevels = [0.25, 0.5, 0.75, 1.0];
  const rings: RadarWebRing[] = ringLevels.map((lvl) => {
    const ringRadius = radius * lvl;
    const ringPts: RadarPoint[] = [];
    for (let i = 0; i < n; i++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
      ringPts.push({
        x: Math.round((centerX + ringRadius * Math.cos(angle)) * 10) / 10,
        y: Math.round((centerY + ringRadius * Math.sin(angle)) * 10) / 10,
      });
    }
    return {
      level: lvl,
      label: `${Math.round(lvl * 100)}%`,
      pointsString: ringPts.map((p) => `${p.x},${p.y}`).join(" "),
    };
  });

  // 2. 各维度轴线与文字标注
  const axes: RadarAxis[] = [];
  const valuePoints: RadarPoint[] = [];

  for (let i = 0; i < n; i++) {
    const d = dimensions[i];
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // 轴线终点（外圈 100% 处）
    const toX = Math.round((centerX + radius * cos) * 10) / 10;
    const toY = Math.round((centerY + radius * sin) * 10) / 10;

    // 标签文字坐标（向外扩展 18px）
    const labelDist = radius + 20;
    const labelX = Math.round((centerX + labelDist * cos) * 10) / 10;
    const labelY = Math.round((centerY + labelDist * sin + 4) * 10) / 10;

    // 文本对齐依据：位于左右两侧分别用 start/end，顶部底部用 middle
    let anchor: "middle" | "start" | "end" = "middle";
    if (cos > 0.25) anchor = "start";
    else if (cos < -0.25) anchor = "end";

    axes.push({
      label: d.label,
      from: { x: centerX, y: centerY },
      to: { x: toX, y: toY },
      labelPoint: { x: labelX, y: labelY },
      anchor,
    });

    // 实际数值多边形顶点（按 score 0-100 映射半径，最低保留 3% 以防聚为完全单点）
    const scoreRatio = Math.max(0.03, Math.min(1.0, d.score / 100));
    const valRadius = radius * scoreRatio;
    valuePoints.push({
      x: Math.round((centerX + valRadius * cos) * 10) / 10,
      y: Math.round((centerY + valRadius * sin) * 10) / 10,
    });
  }

  const polygonPointsString = valuePoints.map((p) => `${p.x},${p.y}`).join(" ");

  return {
    centerX,
    centerY,
    radius,
    dimensions: [...dimensions],
    axes,
    rings,
    polygonPointsString,
    points: valuePoints,
  };
}

/** 45-08 文本等价物：导出雷达图能力矩阵为 CSV */
export function exportRadarDimensionsCsv(dimensions: readonly RadarDimension[]): string {
  const rows: string[] = ["核心考点,综合掌握度,正确率,覆盖率,作答次数"];
  for (const d of dimensions) {
    const escLabel = `"${d.label.replace(/"/g, '""')}"`;
    rows.push(`${escLabel},${d.score}%,${d.accuracy}%,${d.coverage}%,${d.totalAttempts}`);
  }
  return "\uFEFF" + rows.join("\r\n");
}
