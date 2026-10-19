// 39-07：掌握度独立题口径/覆盖率/证据时间测试
import { describe, expect, it } from "vitest";
import { masteryByKp } from "../src/core/report";
import { makeQuestion } from "../src/core/blockTemplate";
import type { AttemptEvent, Question } from "../src/core/types";

const NOW = 1_800_000_000_000;
let seq = 0;
function ev(qid: string, verdict: "correct" | "wrong", ts: number): AttemptEvent {
  return {
    v: 2, eid: `e-${++seq}`, ts, qid, kind: "practice", mode: "daily",
    verdict, myAnswer: "A", sessionId: "s", queue: "normal", device: "t", seq,
  };
}
function qs(kp: string, ids: string[]): Question[] {
  return ids.map((id) => makeQuestion({ type: "single", stem: id, options: ["1", "2"], answer: "A", kp }));
}

describe("masteryByKp 39-07 扩展（独立题/覆盖率/证据时间）", () => {
  it("同题重复三次：作答数 3 但独立题 1", () => {
    const questions = qs("代数/方程", ["q1"]);
    const events = [ev(questions[0].id, "correct", NOW - 3000), ev(questions[0].id, "wrong", NOW - 2000), ev(questions[0].id, "correct", NOW - 1000)];
    const mast = masteryByKp(questions, new Map(), events, NOW);
    expect(mast[0].total).toBe(3); // 作答题数（旧行为保留）
    expect(mast[0].uniqueQids).toBe(1); // 独立题=1
    expect(mast[0].independentCorrect).toBe(1); // 最近判定 correct
    expect(mast[0].evidenceAt).toBe(NOW - 1000);
  });

  it("同题重复 3 次不等于掌握（独立题 < 2 或库内题数 >1 且仅练单题）", () => {
    const questions = qs("代数/方程", ["q1", "q2"]); // 考点共 2 题，但只练了 q1
    const events = [
      ev(questions[0].id, "correct", NOW - 3000),
      ev(questions[0].id, "correct", NOW - 2000),
      ev(questions[0].id, "correct", NOW - 1000),
    ];
    const mast = masteryByKp(questions, new Map(), events, NOW);
    expect(mast.length).toBe(1);
    expect(mast[0].uniqueQids).toBe(1);
    expect(mast[0].independentCorrect).toBe(1);
    expect(mast[0].coverage).toBeCloseTo(1 / 2);
    expect(mast[0].mastery).toBe(-1); // 样本不足：独立题只有 1 道，不宣称掌握
    expect(mast[0].algorithm).toBe("insufficient-samples");
  });

  it("练单题不整体刷新考点记忆（effectiveEvidenceAt 为各题平均最后时刻）", () => {
    const questions = qs("代数/方程", ["q1", "q2", "q3"]);
    const events = [
      ev(questions[0].id, "correct", NOW - 5000),
      ev(questions[1].id, "wrong", NOW - 4000),
      ev(questions[2].id, "correct", NOW - 3000),
    ];
    const mast = masteryByKp(questions, new Map(), events, NOW);
    expect(mast.length).toBe(1);
    expect(mast[0].uniqueQids).toBe(3);
    // effectiveEvidenceAt = (NOW-5000 + NOW-4000 + NOW-3000)/3 = NOW - 4000
    expect(mast[0].effectiveEvidenceAt).toBe(NOW - 4000);
    expect(mast[0].evidenceAt).toBe(NOW - 3000); // evidenceAt 仍为最新单次作答时刻
  });

  it("覆盖率计算正确：已练独立题 / 该考点全部题数", () => {
    const questions = qs("民法", ["q1", "q2", "q3"]);
    const events = [ev(questions[0].id, "correct", NOW - 1000)];
    const mast = masteryByKp(questions, new Map(), events, NOW);
    expect(mast[0].coverage).toBeCloseTo(1 / 3);
  });

  it("题库无该考点题时 coverage=-1（未知）", () => {
    const questions: Question[] = [];
    const events = [ev("external-q", "correct", NOW - 1000)];
    const mast = masteryByKp(questions, new Map(), events, NOW);
    expect(mast).toHaveLength(0); // 外部题目无 kpOf 映射，不产生幻影考点
  });
});
