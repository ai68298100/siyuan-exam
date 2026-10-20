import { describe, it, expect } from "vitest";
import type { AttemptEvent, Question, WrongItem } from "../src/core/types";
import { auditDataIntegrity, exportIntegrityCsv } from "../src/core/dataIntegrity";

function mkQ(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    type: "single",
    stem: `题干 ${id}`,
    options: ["A", "B", "C"],
    answer: "A",
    score: 1,
    origin: "manual",
    hash: `h-${id}`,
    ...overrides,
  };
}

function mkEvent(qid: string, overrides: Partial<AttemptEvent> = {}): AttemptEvent {
  return {
    v: 1,
    eid: `e-${qid}`,
    ts: 1_700_000_000_000,
    qid,
    kind: "practice",
    mode: "single",
    verdict: "correct",
    myAnswer: "A",
    queue: "normal",
    device: "d1",
    seq: 1,
    sessionId: "s1",
    ...overrides,
  };
}

const NOW = 1_800_000_000_000;

describe("DataIntegrity 数据自检与完整性审计引擎 (45-12 / 72-05)", () => {
  it("健康数据返回 healthy=true 与通过回执", () => {
    const qs = [mkQ("q1"), mkQ("q2")];
    const events = [mkEvent("q1", { seq: 1 }), mkEvent("q2", { seq: 2, eid: "e-q2" })];
    const wrongs: WrongItem[] = [
      { qid: "q1", firstWrongAt: 1, lastWrongAt: 2, wrongCount: 2, streakCorrect: 0, myAnswer: "B", reason: "trap" },
    ];

    const report = auditDataIntegrity({ events, questions: qs, wrongItems: wrongs, nowMs: NOW });
    expect(report.healthy).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(report.issues).toHaveLength(0);
    expect(report.receipt).toContain("数据完整性自检通过");
  });

  it("检出重复 eid、未来时间戳与孤儿事件", () => {
    const qs = [mkQ("q1")];
    const events = [
      mkEvent("q1", { eid: "dup", seq: 1 }),
      mkEvent("q1", { eid: "dup", seq: 2 }),
      mkEvent("q1", { eid: "future", seq: 3, ts: NOW + 3_600_000 }),
      mkEvent("ghost", { eid: "orphan", seq: 4 }),
    ];

    const report = auditDataIntegrity({ events, questions: qs, wrongItems: [], nowMs: NOW });
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain("dup-eid");
    expect(codes).toContain("future-ts");
    expect(codes).toContain("orphan-event");
    expect(report.healthy).toBe(false);
    expect(report.issues.find((i) => i.code === "dup-eid")?.autoFixable).toBe(true);
    expect(report.issues.find((i) => i.code === "orphan-event")?.autoFixable).toBe(false);
  });

  it("检出空 qid、非法 verdict 与设备内序号乱序", () => {
    const events = [
      mkEvent("", { eid: "noqid", seq: 1 }),
      mkEvent("q1", { eid: "bad", seq: 5, verdict: "unknown" as AttemptEvent["verdict"] }),
      mkEvent("q1", { eid: "o1", seq: 10 }),
      mkEvent("q1", { eid: "o2", seq: 7 }),
    ];
    const report = auditDataIntegrity({ events, questions: [mkQ("q1")], wrongItems: [], nowMs: NOW });
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain("empty-qid");
    expect(codes).toContain("bad-verdict");
    expect(codes).toContain("seq-unordered");
  });

  it("检出错题状态机矛盾与非法错因", () => {
    const wrongs: WrongItem[] = [
      { qid: "q1", firstWrongAt: 100, lastWrongAt: 50, wrongCount: 0, streakCorrect: -1, myAnswer: null, reason: "weird" as WrongItem["reason"] },
    ];
    const report = auditDataIntegrity({ events: [], questions: [mkQ("q1")], wrongItems: wrongs, nowMs: NOW });
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain("wrong-state");
    expect(codes).toContain("wrong-reason");
    const stateIssue = report.issues.find((i) => i.code === "wrong-state");
    expect(stateIssue?.count).toBeGreaterThanOrEqual(2);
    expect(stateIssue?.autoFixable).toBe(true);
  });

  it("检出题库内容缺陷：重复 ID、缺答案、答案越界、选项不足", () => {
    const qs: Question[] = [
      mkQ("dup"),
      mkQ("dup"),
      mkQ("noans", { answer: "" }),
      mkQ("range", { answer: "D" }), // 仅 3 个选项
      mkQ("fewopts", { type: "multiple", options: ["只有一项"] }),
    ];
    const report = auditDataIntegrity({ events: [], questions: qs, wrongItems: [], nowMs: NOW });
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain("dup-qid");
    expect(codes).toContain("missing-answer");
    expect(codes).toContain("answer-range");
    expect(codes).toContain("empty-options");
    // 重复 ID 不可自动修复（需人工确认合并目标）
    expect(report.issues.find((i) => i.code === "dup-qid")?.autoFixable).toBe(false);
  });

  it("样本列表截断到 5 条但 count 保留全量", () => {
    const events = Array.from({ length: 12 }, (_, i) => mkEvent("ghost", { eid: `g${i}`, seq: i + 1 }));
    const report = auditDataIntegrity({ events, questions: [mkQ("q1")], wrongItems: [], nowMs: NOW });
    const orphan = report.issues.find((i) => i.code === "orphan-event");
    expect(orphan?.count).toBe(12);
    expect(orphan?.samples).toHaveLength(5);
  });

  it("exportIntegrityCsv 输出带 BOM 的可读清单", () => {
    const events = [mkEvent("ghost", { eid: "x" })];
    const report = auditDataIntegrity({ events, questions: [mkQ("q1")], wrongItems: [], nowMs: NOW });
    const csv = exportIntegrityCsv(report);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("问题代码,严重级别");
    expect(csv).toContain("orphan-event");
  });
});
