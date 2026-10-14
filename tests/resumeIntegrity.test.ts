import { describe, it, expect, vi } from "vitest";
import { PracticeSession } from "../src/core/session";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";
import type { Question, SessionState } from "../src/core/types";
import { makeQuestion } from "../src/core/blockTemplate";

const qs: Question[] = [
  makeQuestion({ type: "single", stem: "Q1", options: ["1", "2"], answer: "A" }),
  makeQuestion({ type: "single", stem: "Q2", options: ["1", "2"], answer: "B" }),
  makeQuestion({ type: "judge", stem: "Q3", answer: "对" }),
];

const NOW = 1_800_000_000_000;
const client = { sql: async () => [] } as unknown as KernelApiClient;
const mkApp = (storage: MemoryStorage) => new ExamApp({ client, storage, now: () => NOW });

describe("练习续做完整性（37-05）", () => {
  it("已答快照与重排集合随 state 持久：恢复后结算/转卡名单一致，错题不二次重排", () => {
    const s = new PracticeSession(qs, "quick", undefined, () => NOW);
    s.submit("A", 1000); // Q1 对
    s.next();
    s.submit("A", 2000); // Q2 错 → 重排队尾
    s.next();
    s.submit("对", 3000); // Q3 对（游标到 Q3）
    expect(s.answered).toHaveLength(3);

    const restored = new PracticeSession(qs, "quick", JSON.parse(JSON.stringify(s.state)) as SessionState, () => NOW);
    expect(restored.answered).toHaveLength(3); // 结算名单一致
    expect(restored.answered[1].grade.verdict).toBe("wrong");
    expect(restored.current?.id).toBe(qs[2].id); // 游标保持
    // 恢复后回到 Q2 再答错：不再次重排（requeued 集合已含，每题至多一次跨重载生效）
    const before = restored.state.qids.length;
    restored.prev(); // 游标回到 Q2（重排队尾那份之前）
    restored.submit("A", 500); // Q2 仍答错
    expect(restored.state.qids.length).toBe(before);
  });

  it("resumeSession：bankId 不匹配不跨库恢复", async () => {
    const storage = new MemoryStorage();
    const app = mkApp(storage);
    const saved: SessionState = {
      id: "s1",
      mode: "quick",
      bankId: "bank-A",
      qids: [qs[0].id],
      cursor: 0,
      drafts: {},
      startedAt: NOW - 1000,
      updatedAt: NOW - 1000,
    };
    await storage.save("session/active", saved);
    const r = await app.resumeSession(async () => qs, "bank-B");
    expect(r).toBeNull();
    const r2 = await app.resumeSession(async () => qs, "bank-A");
    expect(r2).not.toBeNull();
  });

  it("同应用已有活动会话时仍核对当前题库，拒绝跨库续做且保留原会话", async () => {
    const app = mkApp(new MemoryStorage());
    const original = await app.startSession(qs, "quick", "bank-A");
    const loader = vi.fn(async () => qs);
    expect(await app.resumeSession(loader, "bank-B")).toBeNull();
    expect(app.currentSession()).toBe(original);
    expect(await app.resumeSession(loader, "bank-A")).toBe(original);
    expect(loader).not.toHaveBeenCalled();
  });

  it("resumeSession：缺题如实剔除（记 lastResumeMissing），进度分母不含缺失", async () => {
    const storage = new MemoryStorage();
    const app = mkApp(storage);
    await storage.save("session/active", {
      id: "s2",
      mode: "quick",
      qids: [qs[0].id, "q-gone", qs[1].id],
      cursor: 1,
      drafts: {},
      startedAt: NOW - 1000,
      updatedAt: NOW - 1000,
    });
    const r = await app.resumeSession(async (qids) => qs.filter((q) => qids.includes(q.id)), "bank-A");
    expect(r).not.toBeNull();
    expect(app.lastResumeMissing).toEqual(["q-gone"]);
    expect(r!.state.qids).toEqual([qs[0].id, qs[1].id]); // 净化后分母只含真实可读题
  });

  it("前方题目已删除时重映射游标和已答位置，当前题可答且已答题不重复计数", async () => {
    const storage = new MemoryStorage();
    const saved: SessionState = {
      id: "missing-before", mode: "quick", bankId: "bank-A",
      qids: ["q-gone", ...qs.map((q) => q.id)], cursor: 2,
      drafts: { "q-gone": "已删除题草稿", [qs[1].id]: "B" },
      startedAt: NOW - 1000, updatedAt: NOW - 1000,
      answered: [
        { qid: "q-gone", pos: 0, verdict: "correct", myAnswer: "对", timeMs: 100 },
        { qid: qs[0].id, pos: 1, verdict: "correct", myAnswer: "A", timeMs: 200 },
      ],
      requeued: ["q-gone"],
    };
    await storage.save("session/active", saved);
    const app = mkApp(storage);
    const restored = (await app.resumeSession(async () => [...qs].reverse(), "bank-A"))!;
    expect(restored.state.qids).toEqual(qs.map((q) => q.id));
    expect(restored.state.cursor).toBe(1);
    expect(restored.current?.id).toBe(qs[1].id);
    expect(restored.state.answered?.map((a) => a.pos)).toEqual([0]);
    expect(restored.answered.map((a) => a.qid)).toEqual([qs[0].id]);
    expect(restored.state.drafts).toEqual({ [qs[1].id]: "B" });
    expect(restored.state.requeued).toEqual([]);
    expect(restored.advancePastAnswered()).toBe(0);
    expect(restored.submit("B", 300)?.grade.verdict).toBe("correct");
    restored.prev();
    expect(restored.submit("A", 300)).toBeNull();
  });

  it("删除题后的重排重复题保留两个位置；首次已答不阻断队尾重试且不再追加同题", async () => {
    const storage = new MemoryStorage();
    const saved: SessionState = {
      id: "missing-requeued", mode: "quick", bankId: "bank-A",
      qids: ["q-gone", qs[0].id, qs[1].id, qs[1].id], cursor: 3,
      drafts: { [qs[1].id]: "A" }, startedAt: NOW - 1000, updatedAt: NOW - 1000,
      answered: [
        { qid: "q-gone", pos: 0, verdict: "correct", myAnswer: "对", timeMs: 100 },
        { qid: qs[0].id, pos: 1, verdict: "correct", myAnswer: "A", timeMs: 200 },
        { qid: qs[1].id, pos: 2, verdict: "wrong", myAnswer: "A", timeMs: 300 },
      ],
      requeued: [qs[1].id],
    };
    await storage.save("session/active", saved);
    const restored = (await mkApp(storage).resumeSession(async () => qs, "bank-A"))!;
    expect(restored.state.qids).toEqual([qs[0].id, qs[1].id, qs[1].id]);
    expect(restored.state.cursor).toBe(2);
    expect(restored.state.answered?.map((a) => a.pos)).toEqual([0, 1]);
    expect(restored.advancePastAnswered()).toBe(0);
    expect(restored.getDraft(qs[1].id)).toBe("");
    expect(restored.submit("A", 500)?.grade.verdict).toBe("wrong");
    expect(restored.state.qids).toHaveLength(3);
    expect(restored.allAnswered()).toBe(true);
    expect(restored.finish()).toEqual({ total: 3, correct: 1, wrong: 2 });
  });

  it("当前题被删后续做下一道保留题，全部题面缺失时不接受加载器返回的其他题顶替", async () => {
    const storage = new MemoryStorage();
    const saved: SessionState = {
      id: "missing-current", mode: "quick", qids: [qs[0].id, "q-gone", qs[1].id],
      cursor: 1, drafts: {}, startedAt: NOW - 1000, updatedAt: NOW - 1000,
      answered: [{ qid: qs[0].id, pos: 0, verdict: "correct", myAnswer: "A", timeMs: 200 }],
    };
    await storage.save("session/active", saved);
    const restored = (await mkApp(storage).resumeSession(async () => qs))!;
    expect(restored.current?.id).toBe(qs[1].id);
    expect(restored.state.cursor).toBe(1);
    expect(restored.allAnswered()).toBe(false);
    await storage.save("session/active", { ...saved, qids: ["q-gone"], cursor: 0 });
    const app = mkApp(storage);
    expect(await app.resumeSession(async () => qs)).toBeNull();
    expect(app.lastResumeMissing).toEqual(["q-gone"]);
  });

  it("恢复推进：光标跳到首个未答位置（重排队重试位可答），防重复作答双计事件", () => {
    const s = new PracticeSession(qs, "quick", undefined, () => NOW);
    s.submit("A", 1000); // pos0 Q1 对
    s.next();
    s.submit("A", 1000); // pos1 Q2 错 → 重排队尾（pos3）
    s.next();
    s.submit("对", 1000); // pos2 Q3 对
    s.next(); // cursor=pos3（Q2 重试位，未答）
    const state = JSON.parse(JSON.stringify(s.state)) as SessionState;
    // 模拟重载：从 pos0 恢复（旧缺陷会回到开头让用户重答 → 双计）
    state.cursor = 0;
    const restored = new PracticeSession(qs, "quick", state, () => NOW);
    const skipped = restored.advancePastAnswered();
    expect(skipped).toBe(3);
    expect(restored.current?.id).toBe(qs[1].id); // 重试位=Q2
    expect(restored.state.cursor).toBe(3);
    expect(restored.allAnswered()).toBe(false);
    restored.submit("B", 500); // 重试位可正常作答
    expect(restored.allAnswered()).toBe(true);
  });

  it("全部位置已答：allAnswered 为真，恢复直接进结算", () => {
    const s = new PracticeSession(qs, "quick", undefined, () => NOW);
    for (const ans of ["A", "B", "对"]) {
      s.submit(ans, 100);
      s.next();
    }
    const state = JSON.parse(JSON.stringify(s.state)) as SessionState;
    state.cursor = 0;
    const restored = new PracticeSession(qs, "quick", state, () => NOW);
    restored.advancePastAnswered();
    expect(restored.allAnswered()).toBe(true);
  });
});
