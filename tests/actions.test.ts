import { describe, it, expect } from "vitest";
import { appendActions, completeAction, cancelAction, openActions, type ActionItem } from "../src/core/actions";

const T0 = 1_790_000_000_000;
const draft = (kind: ActionItem["kind"], qid?: string, detail = "d") => ({ kind, qid, detail });

describe("下一行动（U15 lite：去重/状态机/FIFO）", () => {
  it("同 kind+qid 的 open 行动去重；不同题/不同类型各自保留", () => {
    const r1 = appendActions([], [draft("redo", "q1", "重练：增长率")], T0);
    expect(r1.added).toBe(1);
    const r2 = appendActions(r1.list, [draft("redo", "q1"), draft("redo", "q2"), draft("note", "q1")], T0 + 1);
    expect(r2.added).toBe(2);
    expect(r2.skipped).toBe(1);
    expect(openActions(r2.list)).toHaveLength(3);
  });

  it("完成/取消幂等：仅 open 可转移；完成留证据与时间，取消保留记录", () => {
    const { list } = appendActions([], [draft("probe", "q9")], T0);
    const [a] = list;
    const done = completeAction(list, a.id, "user-confirmed", T0 + 10);
    expect(done[0].status).toBe("done");
    expect(done[0].doneEvidence).toBe("user-confirmed");
    expect(completeAction(done, a.id, "again", T0 + 20)[0].doneAt).toBe(T0 + 10);   // 幂等
    const { list: l2 } = appendActions([], [draft("redo", "q1")], T0);
    const cancelled = cancelAction(l2, l2[0].id, T0 + 5);
    expect(cancelled[0].status).toBe("cancelled");
    expect(openActions(cancelled)).toHaveLength(0);
    expect(cancelled).toHaveLength(1);                                              // 可回看
  });

  it("FIFO 出清已完结项；open 永不出清（全 open 时封顶为软上限）", () => {
    let list: ActionItem[] = [];
    for (let i = 0; i < 199; i++) {
      const r = appendActions(list, [draft("redo", `q${i}`)], T0 + i);
      list = r.list;
    }
    expect(list.length).toBe(199);
    // 完成一个最早的，再补 3 条 → 已完结项被出清；之后全是 open，允许暂时超过 200（open 保护优先）
    const oldest = [...list].sort((a, b) => a.createdAt - b.createdAt)[0];
    list = completeAction(list, oldest.id, "e", T0 + 999);
    for (let i = 0; i < 3; i++) list = appendActions(list, [draft("note", `n${i}`)], T0 + 1000 + i).list;
    expect(list.find((a) => a.id === oldest.id)).toBeUndefined();   // 已完结项被出清
    expect(list.length).toBe(201);                                   // 198 open + 3 新增（软上限）
    const openIds = new Set(openActions(list).map((a) => a.qid));
    for (let i = 0; i < 199; i++) if (`q${i}` !== oldest.qid) expect(openIds.has(`q${i}`)).toBe(true);
  });
});
