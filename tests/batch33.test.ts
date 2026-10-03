import { describe, it, expect } from "vitest";
import { assemble, type Blueprint } from "../src/core/mock";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";
import { makeQuestion } from "../src/core/blockTemplate";
import type { Question } from "../src/core/types";

describe("55-02 lite 考点配额组卷（三三批）", () => {
  const q = (id: string, kp: string): Question =>
    ({ ...makeQuestion({ type: "single", stem: id, options: ["1", "2"], answer: "A" }), id, kp, sourceKind: "mock" as const });

  const bank = [q("a1", "资料/比重"), q("a2", "资料/增长"), q("a3", "言语/主旨"), q("a4", "言语/细节")];

  const bp = (sections: Blueprint["sections"]): Blueprint => ({
    id: "bp-q", name: "配额卷", durationS: 1800, passLine: 60,
    shuffleOptions: false, sectionTimed: false, sections,
  });

  it("考点前缀命中：资料段只出资料题，言语段不受影响", () => {
    const r = assemble(
      bp([
        { name: "资料", count: 2, scoreEach: 1, source: "mixed", types: [], kp: "资料" },
        { name: "言语", count: 2, scoreEach: 1, source: "mixed", types: [] },
      ]),
      bank,
      () => 0,
    );
    expect(r.paper.filter((x) => r.sectionOf.get(x.id) === "资料").every((x) => x.kp?.startsWith("资料"))).toBe(true);
    expect(r.shortages).toHaveLength(0);
  });

  it("配额缺口显式短缺：kp 池不足不用其他考点补齐（55-02 验收）", () => {
    const r = assemble(bp([{ name: "资料", count: 5, scoreEach: 1, source: "mixed", types: [], kp: "资料" }]), bank, () => 0);
    expect(r.paper).toHaveLength(2); // 资料池只有 2 题
    expect(r.shortages).toEqual([{ name: "资料", need: 5, have: 2, filledFromMixed: 0 }]);
  });

  it("无 kp 配额的段行为不变（mixed 补齐逻辑不回归）", () => {
    const r = assemble(bp([{ name: "全库", count: 6, scoreEach: 1, source: "mixed", types: [] }]), bank, () => 0);
    expect(r.paper).toHaveLength(4); // 库只有 4 题，短缺如实
    expect(r.shortages[0]).toMatchObject({ need: 6, have: 4 });
  });
});

describe("52-06 lite 顽固题暂缓（三三批）", () => {
  it("暂缓 7 天：在册隐藏 → 到期回册；期间再错立即回册", async () => {
    let now = 1_800_000_000_000;
    const storage = new MemoryStorage();
    const client = { sql: async () => [] } as unknown as KernelApiClient;
    const app = new ExamApp({ client, storage, now: () => now });
    // 两次错误 → 错题在册
    app.recordAttempt({ qid: "q1", kind: "practice", mode: "single", verdict: "wrong", myAnswer: "A", sessionId: "s1", queue: "normal" });
    app.recordAttempt({ qid: "q1", kind: "practice", mode: "wrong", verdict: "wrong", myAnswer: "B", sessionId: "s1", queue: "wrong" });
    expect(app.wrongItems()).toHaveLength(1);

    await app.snoozeWrong("q1", 7);
    expect(app.wrongItems()).toHaveLength(0); // 暂缓期隐藏

    now += 8 * 86_400_000; // 到期
    app.invalidate();
    expect(app.wrongItems()).toHaveLength(1); // 自动回册

    // 期间再错 → 立即回册（wrongCount 增长清覆盖）
    now = 1_800_000_000_000 + 1000;
    app.recordAttempt({ qid: "q1", kind: "practice", mode: "single", verdict: "wrong", myAnswer: "C", sessionId: "s2", queue: "normal" });
    expect(app.wrongItems()).toHaveLength(1);
  });
});
