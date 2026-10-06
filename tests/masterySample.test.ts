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

  it("覆盖率 = 已练独立题 / 该考点全部题数；未练考点不出现在聚合中", () => {
    const questions = qs("代数/方程", ["q1", "q2", "q3"]); // 考点共 3 题
    const events = [ev(questions[0].id, "correct", NOW - 1000), ev(questions[1].id, "wrong", NOW - 500)];
    const mast = masteryByKp(questions, new Map(), events, NOW);
    expect(mast[0].uniqueQids).toBe(2);
    expect(mast[0].coverage).toBeCloseTo(2 / 3);
  });

  it("最近一次判定 wrong 的题不计入 independentCorrect", () => {
    const questions = qs("代数/方程", ["q1", "q2"]);
    const events = [ev(questions[0].id, "correct", NOW - 2000), ev(questions[0].id, "wrong", NOW - 1000), ev(questions[1].id, "correct", NOW - 500)];
    const mast = masteryByKp(questions, new Map(), events, NOW);
    expect(mast[0].uniqueQids).toBe(2);
    expect(mast[0].independentCorrect).toBe(1); // q1 最近一次为 wrong
  });

  it("题库已删题目的残留作答不产生幻影考点（kpOf 无该 qid → 跳过）", () => {
    const mast = masteryByKp([], new Map(), [ev("deleted-q", "correct", NOW - 1000)], NOW);
    expect(mast).toHaveLength(0);
  });
});
