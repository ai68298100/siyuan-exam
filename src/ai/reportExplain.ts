// ============================================================
// 报告解读（TODO 117-01，docs/18 T11）：只解释已有确定性统计——
// 分子/分母/时间窗/样本量/条件/缺口全部来自 report.ts 的既有输出，
// AI 不得自行重算或引入新数字（验收红线入 system）。
// 纯函数无 IO；样本不足处显式标注（与 UI 44-02「样本不足不下结论」同口径）。
// ============================================================
import type { AiMessage } from "./client";
import type { CalibrationReport, DelayedRecallReport, ExposureStats } from "../core/report";

/** 报告事实包（全部由确定性聚合产出，AI 的唯一信息来源） */
export interface ReportFactsInput {
  windowLabel: string; // "全部" / "今日" / "近 7 天" / "近 30 天"
  attempts: number; // 客观判分作答数（分母）
  correct: number;
  accuracy: number | null; // 百分比整数；分母 0 → null
  trend: { date: string; attempts: number }[]; // 窗口内逐日
  calibration: CalibrationReport;
  exposure: ExposureStats;
  delayed: DelayedRecallReport;
  weakKp: { kp: string; accuracy: number; attempts: number }[]; // 弱项 top（可为空）
}

export const SMALL_SAMPLE = 20; // 总体样本量警示线
const TIER_MIN = 3; // 校准单档下结论最低样本（44-02 口径）

/** 事实行：每一行都带分子/分母或显式「缺样本」；无任何编造空间 */
export function reportFactLines(f: ReportFactsInput): string[] {
  const lines: string[] = [];
  const acc = f.attempts > 0 && f.correct >= 0 ? Math.round((f.correct / f.attempts) * 100) : null;
  lines.push(
    `统计窗口：${f.windowLabel}；客观判分作答 ${f.attempts} 题，答对 ${f.correct}（正确率 ${acc == null ? "无分母" : acc + "%"}）` +
      (f.attempts > 0 && f.attempts < SMALL_SAMPLE ? `；样本量 <${SMALL_SAMPLE}，比例波动大` : ""),
  );
  const activeDays = f.trend.filter((d) => d.attempts > 0).length;
  const peak = f.trend.reduce((m, d) => Math.max(m, d.attempts), 0);
  lines.push(
    f.trend.length
      ? `逐日：窗口 ${f.trend.length} 天中有作答 ${activeDays} 天；单日最多 ${peak} 题${f.trend.length < 7 ? "；窗口不足 7 天" : ""}`
      : "逐日：窗口内无逐日数据",
  );

  const tierName = { sure: "确定", fuzzy: "模糊", guess: "蒙" } as Record<string, string>;
  if (f.calibration.rows.length) {
    for (const r of f.calibration.rows) {
      lines.push(
        `信心校准〔${tierName[r.confidence] ?? r.confidence}〕：${r.correct}/${r.attempts}（${r.accuracy}%）` +
          (r.assisted ? `，其中受助 ${r.assisted}` : "") +
          (r.attempts < TIER_MIN ? `；样本 <${TIER_MIN} 不下结论` : ""),
      );
    }
    lines.push(`未报信心的客观作答：${f.calibration.unreported}`);
    lines.push(
      f.calibration.spread == null
        ? "校准差（确定−蒙）：样本不足，未计算"
        : `校准差（确定−蒙）：${Math.round(f.calibration.spread * 100) / 100} 个百分点`,
    );
  } else {
    lines.push("信心校准：窗口内无可统计作答");
  }

  lines.push(
    `暴露口径（互不混算）：独立 ${f.exposure.independent} / 受助 ${f.exposure.assisted} / 先回忆 ${f.exposure.recallFirst}（共 ${f.exposure.attempts}）`,
  );
  lines.push(
    f.delayed.pairs === 0
      ? "延迟独立回忆：暂无隔日复测样本（错题后隔日 ≥1 天的首次作答才计入）"
      : `延迟独立回忆：复测 ${f.delayed.pairs} 次，独立回忆通过 ${f.delayed.independentRecall}${f.delayed.assistedCorrect ? `，受助答对 ${f.delayed.assistedCorrect}（单列不计入独立）` : ""}，仍错 ${f.delayed.stillWrong}；独立回忆率 ${f.delayed.rate == null ? "无分母" : Math.round(f.delayed.rate * 100) + "%"}`,
  );
  if (f.weakKp.length) {
    for (const w of f.weakKp) {
      lines.push(`弱项考点〔${w.kp}〕：${w.attempts} 题中未掌握比例 ${w.accuracy}%${w.attempts < 5 ? "；样本 <5 仅作线索" : ""}`);
    }
  } else {
    lines.push("弱项考点：窗口内无可列项");
  }
  lines.push("——以上为全部分母事实；解释只能引用这些数字。");
  return lines;
}

export function buildReportExplainMessages(f: ReportFactsInput): AiMessage[] {
  const system = [
    "你是学习数据解读助手，中文、简洁。只解释给定统计，输出严格三段——",
    "【概览】两三句：整体作答量与正确率怎么读；",
    "【值得注意】2-3 条，每条必须引用给定统计的分子/分母与样本量；样本不足的条目明说「不下结论」；",
    "【下一步】1-2 条可执行建议，只能基于给定统计。",
    "红线：不得自行重算、不得引入未给出的数字；不得预测考试通过率/排名；受助作答与独立表现不得混为一谈；先回忆作答不是独立掌握证据。",
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: reportFactLines(f).join("\n") },
  ];
}
