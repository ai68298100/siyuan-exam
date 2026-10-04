import { describe, it, expect } from "vitest";
import { reportFactLines, buildReportExplainMessages, SMALL_SAMPLE, type ReportFactsInput } from "../src/ai/reportExplain";
import type { CalibrationReport, DelayedRecallReport } from "../src/core/report";

const baseFacts = (over: Partial<ReportFactsInput> = {}): ReportFactsInput => ({
  windowLabel: "近 7 天",
  attempts: 60,
  correct: 42,
  accuracy: 70,
  trend: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-0${i + 1}`, attempts: i === 2 ? 20 : i === 3 ? 0 : 6 })),
  calibration: {
    rows: [
      { confidence: "sure", attempts: 30, correct: 27, accuracy: 90, assisted: 3 },
      { confidence: "guess", attempts: 2, correct: 1, accuracy: 50, assisted: 0 },
    ],
    unreported: 28,
    spread: 40,
  },
  exposure: { attempts: 60, independent: 50, assisted: 7, recallFirst: 3 },
  delayed: { pairs: 5, independentRecall: 2, assistedCorrect: 1, stillWrong: 2, rate: 0.4 },
  weakKp: [{ kp: "资料分析/比重", accuracy: 55, attempts: 8 }],
  ...over,
});

describe("117-01 T11 事实行", () => {
  it("分子/分母/窗口/样本警示逐行如实", () => {
    const lines = reportFactLines(baseFacts()).join("\n");
    expect(lines).toContain("统计窗口：近 7 天；客观判分作答 60 题，答对 42（正确率 70%）");
    expect(lines).toContain("有作答 6 天");
    expect(lines).toContain("单日最多 20 题");
    expect(lines).toContain("未报信心的客观作答：28");
    expect(lines).toContain("校准差（确定−蒙）：40 个百分点");
    expect(lines).toContain("独立 50 / 受助 7 / 先回忆 3（共 60）");
    expect(lines).toContain("独立回忆率 40%");
    expect(lines).toContain("受助答对 1（单列不计入独立）");
    expect(lines).toContain("——以上为全部分母事实");
  });

  it("小样本总体警示 + 校准档样本不足标注", () => {
    const lines = reportFactLines(baseFacts({ attempts: 15, correct: 9 })).join("\n");
    expect(lines).toContain(`样本量 <${SMALL_SAMPLE}，比例波动大`);
    expect(lines).toContain("样本 <3 不下结论"); // guess 档 n=2
  });

  it("空数据形态：无分母/无复测样本/无弱项均显式说明，不编造", () => {
    const lines = reportFactLines(
      baseFacts({
        attempts: 0,
        correct: 0,
        accuracy: null,
        trend: [],
        calibration: { rows: [], unreported: 0, spread: null },
        exposure: { attempts: 0, independent: 0, assisted: 0, recallFirst: 0 },
        delayed: { pairs: 0, independentRecall: 0, assistedCorrect: 0, stillWrong: 0, rate: null },
        weakKp: [],
      }),
    ).join("\n");
    expect(lines).toContain("正确率 无分母");
    expect(lines).toContain("窗口内无逐日数据");
    expect(lines).toContain("信心校准：窗口内无可统计作答");
    expect(lines).toContain("暂无隔日复测样本");
    expect(lines).toContain("弱项考点：窗口内无可列项");
  });

  it("校准差 spread 为 null 时不下结论（rows 非空但样本不足场景）；rate 无分母显式说明", () => {
    const lines = reportFactLines(baseFacts({
      calibration: {
        rows: [{ confidence: "fuzzy", attempts: 2, correct: 1, accuracy: 50, assisted: 0 }],
        unreported: 0,
        spread: null,
      } as CalibrationReport,
      delayed: { pairs: 3, independentRecall: 0, assistedCorrect: 0, stillWrong: 3, rate: null } as DelayedRecallReport,
    })).join("\n");
    expect(lines).toContain("校准差（确定−蒙）：样本不足，未计算");
    expect(lines).toContain("样本 <3 不下结论");
    expect(lines).toContain("独立回忆率 无分母");
  });

  it("弱项样本 <5 标注仅作线索；system 携带红线与三段式", () => {
    const lines = reportFactLines(baseFacts({ weakKp: [{ kp: "数量关系", accuracy: 30, attempts: 3 }] })).join("\n");
    expect(lines).toContain("样本 <5 仅作线索");
    const sys = buildReportExplainMessages(baseFacts())[0].content;
    expect(sys).toContain("不得自行重算");
    expect(sys).toContain("不得预测考试通过率");
    expect(sys).toContain("【概览】");
    expect(sys).toContain("【下一步】");
    const user = buildReportExplainMessages(baseFacts())[1].content;
    expect(user).toContain("统计窗口：近 7 天");
  });
});
