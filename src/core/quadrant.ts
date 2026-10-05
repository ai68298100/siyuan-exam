// ============================================================
// 置信度×结果四象限（TODO 63-01，细化 44-02）：
// 区分「确定正确 / 确定错误 / 猜对 / 犹豫但答对」并按题型下钻。
// 验收口径：置信度缺失不补猜测（如实单列）；样本不足显示范围（low-sample 标注）；
// 报告/错题/导出使用同一分母（practice 口径独立作答，mock/recite 不入表）。
// 纯函数无 IO；不把自评当记忆真值——四象限是复习策略信号，不是能力度量。
// ============================================================
import type { AttemptEvent } from "./types";

export type Quadrant = "sureRight" | "sureWrong" | "guessedRight" | "fuzzyRight";

export interface QuadrantCell {
  key: Quadrant | "fuzzyWrong" | "guessedWrong" | "noConfidence";
  count: number;
}

export interface QuadrantByType {
  type: string;
  cells: Record<string, number>;
  total: number;
}

export interface QuadrantReport {
  /** 六格 + 缺失（置信度缺省的作答如实单列，不并入任何象限） */
  cells: Record<string, number>;
  /** 独立作答总分母（practice 且有 verdict 的作答；与各格之和一致） */
  denominator: number;
  /** 按题型下钻（题型 → 格计数） */
  byType: QuadrantByType[];
  /** 样本门槛（< 10 如实标注低样本，UI 显示范围提示） */
  lowSample: boolean;
  /** 时间窗（毫秒截点；0=全部）——与报告页共用同一筛选参数 */
  windowDays: number;
}

const MIN_SAMPLE = 10;

/** 四象限聚合：events=已按时间窗筛选的独立作答事件；typeOf=qid→题型（报告页与题库同源映射） */
export function quadrantReport(
  events: AttemptEvent[],
  typeOf: (qid: string) => string,
  windowDays = 0,
): QuadrantReport {
  const cells: Record<string, number> = {
    sureRight: 0,
    sureWrong: 0,
    fuzzyRight: 0,
    fuzzyWrong: 0,
    guessedRight: 0,
    guessedWrong: 0,
    noConfidence: 0,
  };
  const byTypeMap = new Map<string, Record<string, number>>();
  let denominator = 0;
  for (const e of events) {
    if (e.kind !== "practice") continue; // 同一分母口径：报告四象限只计独立练习作答
    if (e.verdict === "not_attempted") continue;
    const c = e.confidence;
    let key: string;
    if (c === "sure") key = e.verdict === "correct" ? "sureRight" : "sureWrong";
    else if (c === "fuzzy") key = e.verdict === "correct" ? "fuzzyRight" : "fuzzyWrong";
    else if (c === "guess") key = e.verdict === "correct" ? "guessedRight" : "guessedWrong";
    else key = "noConfidence"; // 置信度缺失不补猜测
    cells[key]++;
    denominator++;
    const type = typeOf(e.qid) || "—";
    const row = byTypeMap.get(type) ?? {
      sureRight: 0,
      sureWrong: 0,
      fuzzyRight: 0,
      fuzzyWrong: 0,
      guessedRight: 0,
      guessedWrong: 0,
      noConfidence: 0,
      total: 0,
    };
    row[key]++;
    row.total++;
    byTypeMap.set(type, row);
  }
  const byType: QuadrantByType[] = [...byTypeMap.entries()]
    .map(([type, row]) => ({ type, cells: row, total: row.total }))
    .sort((a, b) => b.total - a.total);
  return {
    cells,
    denominator,
    byType,
    lowSample: denominator < MIN_SAMPLE,
    windowDays,
  };
}

/** 象限 → 复习策略信号（63-01 边界：策略提示，不是能力判定） */
export function quadrantSignals(r: QuadrantReport): string[] {
  const signals: string[] = [];
  if (r.lowSample || r.denominator === 0) return signals;
  const pct = (n: number) => Math.round((n / r.denominator) * 100);
  if (r.cells.sureWrong > 0 && pct(r.cells.sureWrong) >= 10) {
    signals.push("sureWrong"); // 确定但错：易混淆知识点，值得错因复盘
  }
  if (r.cells.guessedRight > 0 && pct(r.cells.guessedRight) >= 15) {
    signals.push("guessedRight"); // 猜对比例偏高：「掌握」可能含运气成分
  }
  if (r.cells.noConfidence >= r.denominator / 2) {
    signals.push("noConfidence"); // 过半作答未记录信心：建议作答前顺手点一下
  }
  return signals;
}
