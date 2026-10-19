import { describe, it, expect } from "vitest";
import {
  emptyLedger,
  recordCall,
  summarizeUsage,
  usageReceipt,
  cancelOutcome,
  completedSlices,
  missingSlices,
  partialResult,
  partialResultReceipt,
  type CallUsage,
  type SliceState,
} from "../src/core/usageLedger";

const call = (over: Partial<CallUsage> = {}): CallUsage => ({
  index: 1,
  charsIn: 4000,
  charsOut: 200,
  outcome: "ok",
  ...over,
});

describe("41-05 取消、部分成果与用量记账", () => {
  describe("summarizeUsage 用量汇总（核心：失败调用不漏账）", () => {
    it("成功调用计入 sent 与 charsOut", () => {
      const t = summarizeUsage([call({ outcome: "ok", charsIn: 4000, charsOut: 400 })]);
      expect(t.sent).toBe(1);
      expect(t.ok).toBe(1);
      expect(t.charsIn).toBe(4000);
      expect(t.charsOut).toBe(400);
      expect(t.approxTokens).toBe(1100);
    });

    it("失败调用仍计入消耗（输入已送出，只是没有输出）", () => {
      const t = summarizeUsage([call({ outcome: "failed", charsIn: 4000, charsOut: 0 })]);
      expect(t.sent).toBe(1);
      expect(t.failed).toBe(1);
      expect(t.ok).toBe(0);
      expect(t.charsIn).toBe(4000);
      expect(t.charsOut).toBe(0);
      expect(t.approxTokens).toBe(1000); // 输入消耗必须计入
    });

    it("取消的调用同样计入 sent 与 charsIn（不能声称未消耗）", () => {
      const t = summarizeUsage([call({ outcome: "cancelled", charsIn: 2000, charsOut: 0 })]);
      expect(t.sent).toBe(1);
      expect(t.cancelled).toBe(1);
      expect(t.charsIn).toBe(2000);
      expect(t.approxTokens).toBe(500);
    });

    it("skipped（未送出）不计入消耗", () => {
      const t = summarizeUsage([call({ outcome: "skipped", charsIn: 9999, charsOut: 0 })]);
      expect(t.sent).toBe(0);
      expect(t.charsIn).toBe(0);
      expect(t.approxTokens).toBe(0);
    });

    it("混合场景：成功+失败+取消+跳过，分类计数与合计均正确", () => {
      const calls = [
        call({ index: 1, outcome: "ok", charsIn: 1000, charsOut: 100 }),
        call({ index: 2, outcome: "failed", charsIn: 1000, charsOut: 0 }),
        call({ index: 3, outcome: "cancelled", charsIn: 1000, charsOut: 0 }),
        call({ index: 4, outcome: "skipped", charsIn: 5000, charsOut: 0 }),
      ];
      const t = summarizeUsage(calls);
      expect(t.calls).toBe(4);
      expect(t.sent).toBe(3); // skipped 不算
      expect(t.ok).toBe(1);
      expect(t.failed).toBe(1);
      expect(t.cancelled).toBe(1);
      expect(t.charsIn).toBe(3000);
      expect(t.charsOut).toBe(100);
      expect(t.approxTokens).toBe(775);
    });

    it("脏数据（负值/NaN 字符数）被夹取为 0，不产生负用量或 NaN", () => {
      const t = summarizeUsage([call({ outcome: "ok", charsIn: -100, charsOut: NaN })]);
      expect(t.charsIn).toBe(0);
      expect(t.charsOut).toBe(0);
      expect(Number.isFinite(t.approxTokens)).toBe(true);
    });

    it("空集合归零", () => {
      expect(summarizeUsage([])).toMatchObject({ sent: 0, charsIn: 0, charsOut: 0, approxTokens: 0 });
    });
  });

  describe("recordCall 账本追加", () => {
    it("逐笔追加并保持不可变（原账本不被改写）", () => {
      const l0 = emptyLedger();
      const l1 = recordCall(l0, call({ index: 1 }));
      const l2 = recordCall(l1, call({ index: 2, outcome: "failed" }));
      expect(l0.calls).toHaveLength(0);
      expect(l1.calls).toHaveLength(1);
      expect(l2.calls).toHaveLength(2);
      expect(l2.totals.sent).toBe(2);
      expect(l2.totals.failed).toBe(1);
    });

    it("空账本合计归零", () => {
      expect(emptyLedger().totals).toMatchObject({ calls: 0, sent: 0, approxTokens: 0 });
    });
  });

  describe("usageReceipt 用量回执", () => {
    it("成功-only 的回执不列出失败/取消项（末尾说明句除外）", () => {
      const r = usageReceipt(recordCall(emptyLedger(), call({ outcome: "ok" })));
      const list = r.split("（")[0]; // 只校验条目部分
      expect(list).toContain("1 次成功");
      expect(list).not.toContain("失败");
      expect(list).not.toContain("取消");
    });

    it("含失败与取消时如实列出，并声明已计入用量", () => {
      let l = emptyLedger();
      l = recordCall(l, call({ outcome: "ok" }));
      l = recordCall(l, call({ outcome: "failed" }));
      l = recordCall(l, call({ outcome: "cancelled" }));
      const r = usageReceipt(l);
      expect(r).toContain("1 次失败");
      expect(r).toContain("1 次因取消中止");
      expect(r).toContain("计入用量");
    });
  });

  describe("cancelOutcome 取消语义（不声称撤回已送出数据）", () => {
    it("未送出前取消：可声称无消耗，且不得静默继续", () => {
      const o = cancelOutcome("before-send");
      expect(o.sent).toBe(false);
      expect(o.canClaimNoUsage).toBe(true);
      expect(o.mayContinueSilently).toBe(false);
    });

    it("在途取消：不可声称无消耗（数据已送出无法撤回）", () => {
      const o = cancelOutcome("in-flight");
      expect(o.sent).toBe(true);
      expect(o.canClaimNoUsage).toBe(false);
      expect(o.note).toContain("无法撤回");
      expect(o.mayContinueSilently).toBe(false);
    });

    it("响应后取消：用量已计入，取消只影响后续处理", () => {
      const o = cancelOutcome("after-response");
      expect(o.sent).toBe(true);
      expect(o.canClaimNoUsage).toBe(false);
      expect(o.note).toContain("已计入");
    });

    it("任何阶段取消都不得静默继续批准后续分片", () => {
      for (const p of ["before-send", "in-flight", "after-response"] as const) {
        expect(cancelOutcome(p).mayContinueSilently).toBe(false);
      }
    });
  });

  describe("分片成果与缺口", () => {
    const slices: SliceState[] = [
      { index: 0, status: "done" },
      { index: 1, status: "failed" },
      { index: 2, status: "done" },
      { index: 3, status: "cancelled" },
      { index: 4, status: "pending" },
    ];

    it("保留已完成分片（失败/取消不丢弃已成功成果）", () => {
      expect(completedSlices(slices)).toEqual([0, 2]);
    });

    it("重试只补缺片（failed/cancelled/pending）", () => {
      expect(missingSlices(slices)).toEqual([1, 3, 4]);
    });

    it("partialResult：保留成果 + 如实标注缺口 + complete=false", () => {
      const bySlice = new Map<number, number[]>([[0, [10, 11]], [2, [20]]]);
      const r = partialResult(slices, bySlice);
      expect(r.items).toEqual([10, 11, 20]);
      expect(r.completed).toEqual([0, 2]);
      expect(r.missing).toEqual([1, 3, 4]);
      expect(r.complete).toBe(false);
      expect(r.cancelled).toBe(false);
    });

    it("全部完成时 complete=true", () => {
      const all: SliceState[] = [{ index: 0, status: "done" }, { index: 1, status: "done" }];
      const bySlice = new Map<number, string[]>([[0, ["a"]], [1, ["b"]]]);
      const r = partialResult(all, bySlice);
      expect(r.complete).toBe(true);
      expect(r.items).toEqual(["a", "b"]);
      expect(r.missing).toEqual([]);
    });

    it("取消场景：成果保留、cancelled 标记为真、complete=false", () => {
      const cancelledSlices: SliceState[] = [
        { index: 0, status: "done" },
        { index: 1, status: "cancelled" },
      ];
      const r = partialResult(cancelledSlices, new Map([[0, ["kept"]]]), true);
      expect(r.items).toEqual(["kept"]);
      expect(r.cancelled).toBe(true);
      expect(r.complete).toBe(false);
    });

    it("部分成果回执如实说明缺口，不把部分说成完整", () => {
      const r = partialResult(slices, new Map([[0, [1]]]));
      const txt = partialResultReceipt(r);
      expect(txt).toContain("已完成 2 片");
      expect(txt).toContain("仍有 3 片待补");
      expect(txt).toContain("重试只补缺片");
    });

    it("完整成果回执宣布完成", () => {
      const all: SliceState[] = [{ index: 0, status: "done" }];
      expect(partialResultReceipt(partialResult(all, new Map([[0, ["x"]]])))).toContain("全部 1 片已完成");
    });

    it("取消场景回执以「已取消」开头（不冒充失败或完成）", () => {
      const r = partialResult([{ index: 0, status: "cancelled" }], new Map(), true);
      expect(partialResultReceipt(r)).toContain("已取消");
    });
  });
});
