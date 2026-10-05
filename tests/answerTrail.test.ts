// 63-03：改答轨迹测试（保留首答/每次修改/取消不记/上限截断/报告清单）
import { describe, expect, it } from "vitest";
import {
  startTrail,
  recordEdit,
  trailValue,
  trailChanged,
  withLastEditReason,
  changedAnswerList,
  MAX_TRAIL_EDITS,
} from "../src/core/answerTrail";

describe("改答轨迹（63-03）", () => {
  it("首答 → 修改 → 终答分离", () => {
    let t = startTrail("A");
    expect(trailValue(t)).toBe("A");
    expect(trailChanged(t)).toBe(false);
    t = recordEdit(t, "C", "unsure");
    expect(trailValue(t)).toBe("C");
    expect(trailChanged(t)).toBe(true);
    expect(t.first).toBe("A");
    expect(t.edits).toEqual([{ to: "C", reason: "unsure" }]);
  });

  it("取消/重复不产生轨迹事件；改回首答如实记录但报告口径为未改答", () => {
    let t = startTrail("A");
    t = recordEdit(t, "B");
    t = recordEdit(t, "B"); // 重复值 → 不记
    t = recordEdit(t, ""); // 空值 → 不记
    expect(t.edits).toEqual([{ to: "B" }]);
    t = recordEdit(t, "A"); // 改回首答：如实记录（轨迹完整性）
    expect(t.edits).toEqual([{ to: "B" }, { to: "A" }]);
    expect(trailChanged(t)).toBe(false); // 终答==首答 → 报告口径「未改答」
  });

  it("上限截断并如实标注", () => {
    let t = startTrail("A");
    for (let i = 0; i < MAX_TRAIL_EDITS + 3; i++) t = recordEdit(t, `v${i}`);
    expect(t.edits).toHaveLength(MAX_TRAIL_EDITS);
    expect(t.truncated).toBe(true);
  });

  it("修改后补记原因（弹层选择）", () => {
    let t = startTrail("A");
    t = recordEdit(t, "B");
    t = withLastEditReason(t, "evidence");
    expect(t.edits[0].reason).toBe("evidence");
  });
});

describe("changedAnswerList（报告：首答 vs 终答）", () => {
  it("只列终答≠首答的作答，按时间倒序，原因聚合", () => {
    const list = changedAnswerList([
      { qid: "q1", myAnswer: "C", firstAnswer: "A", edits: [{ to: "B" }, { to: "C", reason: "evidence" }], ts: 100 },
      { qid: "q2", myAnswer: "A", firstAnswer: "A", edits: [], ts: 90 }, // 未改答 → 不列
      { qid: "q3", myAnswer: "对", ts: 80 }, // 无首答（旧事件）→ 不列
      { qid: "q0", myAnswer: "D", firstAnswer: "B", edits: [{ to: "D", reason: "misclick" }], ts: 200 },
    ]);
    expect(list.map((x) => x.qid)).toEqual(["q0", "q1"]);
    expect(list[1].first).toBe("A");
    expect(list[1].final).toBe("C");
    expect(list[1].editCount).toBe(2);
    expect(list[1].reasons).toEqual(["evidence"]);
  });
});
