import { describe, it, expect } from "vitest";
import { assemble, MockSession, type Blueprint, type MockRunSnapshot } from "../src/core/mock";
import { makeQuestion } from "../src/core/blockTemplate";
import type { Question } from "../src/core/types";

const q = (id: string): Question =>
  ({ ...makeQuestion({ type: "single", stem: `题${id}`, options: ["1", "2"], answer: "A" }), id, sourceKind: "mock" as const, kp: "言语" });

const bank: Question[] = [q("a1"), q("a2"), q("a3")];
const bp: Blueprint = {
  id: "bp1", name: "行测", durationS: 1800, passLine: 60,
  shuffleOptions: false, sectionTimed: false,
  sections: [{ name: "言语", count: 3, scoreEach: 1, source: "mixed", types: [] }],
};

const newSession = () => {
  const r = assemble(bp, bank, () => 0);
  return new MockSession(bp, r.paper, { sectionOf: r.sectionOf, scoreOf: r.scoreOf }, 1_000_000);
};

describe("模考真实驻留计时（40-03）", () => {
  it("作答时刻取真实驻留：停留 10s 作答 timeMs=10s，替代固定 +500ms", () => {
    const s = newSession();
    s.setAnswer("a1", "A", 1_010_000);            // 开考后 10s 作答
    expect(s.answers.get("a1")!.timeMs).toBe(10_000);
  });

  it("导航结算上一题；返回同题继续累计不清零；改答累计正确", () => {
    const s = newSession();
    s.setAnswer("a1", "B", 1_005_000);            // 5s 时首答
    expect(s.answers.get("a1")!.timeMs).toBe(5_000);
    s.navigateTo(1, 1_030_000);                   // a1 停留 30s 后切到 a2
    expect(s.dwellOf("a1", 1_030_000)).toBe(30_000);
    s.navigateTo(0, 1_040_000);                   // a2 停 10s，回到 a1
    s.setAnswer("a1", "A", 1_050_000);            // a1 又停 10s → 改答总驻留 40s
    expect(s.answers.get("a1")!.timeMs).toBe(40_000);
    expect(s.answers.get("a1")!.changes).toBe(1);
  });

  it("交卷结算当前题驻留；交卷后驻留冻结", () => {
    const s = newSession();
    const q3 = s.state.qids[2];
    s.navigateTo(2, 1_020_000);
    s.submit(1_050_000);                          // 当前题未作答也结算 30s 驻留
    expect(s.dwellOf(q3, 1_999_999_999)).toBe(30_000);
    s.setAnswer(q3, "A", 1_060_000);              // 交卷后作答（防御）：不崩溃，驻留按结算值
    expect(s.answers.get(q3)!.timeMs).toBe(30_000);
  });

  it("快照往返保留 dwell 与进行中的 currentEnter；旧快照（无 dwell 字段）可恢复", () => {
    const s = newSession();
    s.navigateTo(1, 1_015_000);                   // a1 结算 15s
    const snap = JSON.parse(JSON.stringify(s.toSnapshot("r-d", 1_020_000))) as MockRunSnapshot;
    expect(snap.dwell!.a1).toBe(15_000);
    const back = MockSession.restore(snap, bank).session;
    expect(back.dwellOf("a1", 1_099_999)).toBe(15_000);
    // currentEnter=a2（at=1_015_000）：恢复后继续计时（15s 处切题，剩余 5s 到 20s）
    expect(back.dwellOf("a2", 1_020_000)).toBe(5_000);

    const legacy = { ...snap, dwell: undefined, currentEnter: undefined } as unknown as MockRunSnapshot;
    const back2 = MockSession.restore(legacy, bank).session;   // 旧快照：从 currentEnter 缺省起重新累计
    expect(back2.dwellOf("a1", 1_030_000)).toBe(30_000);       // 首题从 startedAt 起算
  });
});
