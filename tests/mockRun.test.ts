import { describe, it, expect } from "vitest";
import { assemble, MockSession, type Blueprint, type MockRunSnapshot } from "../src/core/mock";
import { makeQuestion } from "../src/core/blockTemplate";
import type { Question } from "../src/core/types";

const q = (id: string): Question & { blockId?: string } => ({
  ...makeQuestion({ type: "single", stem: `题${id}`, options: ["1", "2"], answer: "A" }),
  id,
  sourceKind: "mock" as const,
  kp: "言语",
});

const bank: Question[] = [q("a1"), q("a2"), q("a3"), q("a4")];

const bp: Blueprint = {
  id: "bp1",
  name: "行测",
  durationS: 1800,
  passLine: 60,
  shuffleOptions: false,
  sectionTimed: true,
  sections: [{ name: "言语", count: 4, scoreEach: 1, source: "mixed", types: [] }],
};

const newSession = () => {
  const r = assemble(bp, bank, () => 0);
  return { r, s: new MockSession(bp, r.paper, { sectionOf: r.sectionOf, scoreOf: r.scoreOf }, 1_000_000) };
};

describe("模考运行快照（U18/U19/U20 最小切片）", () => {
  it("toSnapshot → JSON 往返 → restore：答案/标旗/游标/切屏/段起始原样回填", () => {
    const { r, s } = newSession();
    s.setAnswer("a1", "A", 1_010_000);
    s.setAnswer("a2", "B", 1_020_000);
    s.setAnswer("a2", "A", 1_030_000); // 改答
    s.toggleFlag("a3");
    s.navigateTo(2, 1_040_000);
    s.screenSwitches = 3;
    const snap = JSON.parse(JSON.stringify(s.toSnapshot("r-abc", 1_050_000))) as MockRunSnapshot;
    expect(snap.runId).toBe("r-abc");
    expect(snap.qids).toEqual(r.paper.map((x) => x.id));

    const back = MockSession.restore(snap, bank);
    expect(back.missingQids).toEqual([]);
    expect(back.alreadySubmitted).toBe(false);
    const rs = back.session;
    expect(rs.answers.get("a1")?.answer).toBe("A");
    expect(rs.answers.get("a2")?.changes).toBe(1);
    expect(rs.flags.has("a3")).toBe(true);
    expect(rs.cursor).toBe(2);
    expect(rs.screenSwitches).toBe(3);
    // wall clock：恢复后剩余时间按原 startedAt 继续流逝（休眠不清零）
    expect(rs.remaining(1_050_000)).toBe(s.remaining(1_050_000));
    // 判分确定性：恢复后结算与原会话一致
    expect(rs.score().total).toBe(s.score().total);
  });

  it("卷面缺失题如实剔除并报告，不用其他题顶替（U18）", () => {
    const { s } = newSession();
    s.setAnswer("a1", "A", 1_010_000);
    const snap = s.toSnapshot("r-x", 1_050_000);
    const shrunkenBank = bank.filter((x) => x.id !== "a1"); // a1 被删
    const back = MockSession.restore(snap, shrunkenBank);
    expect(back.missingQids).toEqual(["a1"]);
    expect(back.session.state.qids).toHaveLength(3);
    expect(back.session.state.qids).not.toContain("a1");
  });

  it("已交卷快照恢复：submitted=true、finishedAt 回填，不重开考试（U20）", () => {
    const { s } = newSession();
    s.setAnswer("a1", "A", 1_010_000);
    s.submit(1_100_000);
    const snap = s.toSnapshot("r-y", 1_100_500);
    const back = MockSession.restore(snap, bank);
    expect(back.alreadySubmitted).toBe(true);
    expect(back.session.submitted).toBe(true);
    expect(back.session.state.finishedAt).toBe(1_100_000);
    expect(back.session.shouldAutoSubmit(1_200_000)).toBe(false); // 幂等：不再触发二次交卷
  });

  it("过期恢复：剩余时间为负 → shouldAutoSubmit 触发唯一一次自动交卷（U19）", () => {
    const { s } = newSession();
    s.setAnswer("a1", "A", 1_010_000);
    const snap = JSON.parse(JSON.stringify(s.toSnapshot("r-z", 1_050_000))) as MockRunSnapshot;
    const back = MockSession.restore(snap, bank);
    const now = 1_000_000 + 1800_000 + 5_000; // 截止后 5s
    expect(back.session.shouldAutoSubmit(now)).toBe(true);
    back.session.submit(now);
    expect(back.session.shouldAutoSubmit(now + 1000)).toBe(false);
    expect(back.session.score().total).toBe(1); // 答案保留
  });
});
