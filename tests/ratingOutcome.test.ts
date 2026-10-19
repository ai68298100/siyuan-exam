import { describe, it, expect } from "vitest";
import {
  ratingOutcome,
  classifyWriteError,
  ratingAttemptKey,
  RatingGuard,
  pendingConfirmHint,
  shouldReplay,
  type RatingOutcomeInput,
  type PendingRatingWrite,
} from "../src/core/ratingOutcome";

const input = (over: Partial<RatingOutcomeInput> = {}): RatingOutcomeInput => ({
  hasCard: true,
  kernelOnline: true,
  ratingValid: true,
  writeResult: "ok",
  ...over,
});

describe("39-03 riff 评级结果可恢复（Rating Outcome）", () => {
  describe("ratingOutcome 五态区分", () => {
    it("写回成功 → recorded（终态）", () => {
      const v = ratingOutcome(input({ writeResult: "ok" }));
      expect(v.outcome).toBe("recorded");
      expect(v.terminal).toBe(true);
      expect(v.needsConfirm).toBe(false);
      expect(v.label).toBe("已写回");
    });

    it("未转卡 → not-a-card（终态，不涉及调度）", () => {
      const v = ratingOutcome(input({ hasCard: false }));
      expect(v.outcome).toBe("not-a-card");
      expect(v.terminal).toBe(true);
      expect(v.note).toContain("尚未转为闪卡");
    });

    it("非法自评 → 不发请求也不产生副作用（39-01 契约）", () => {
      const v = ratingOutcome(input({ ratingValid: false }));
      expect(v.outcome).toBe("not-a-card");
      expect(v.canRetry).toBe(false);
    });

    it("离线有卡 → skipped-offline（不假装成功，可恢复后重试）", () => {
      const v = ratingOutcome(input({ kernelOnline: false }));
      expect(v.outcome).toBe("skipped-offline");
      expect(v.canRetry).toBe(true);
      expect(v.terminal).toBe(false);
      expect(v.note).toContain("离线");
    });

    it("超时/网络中断 → pending-confirm（必须核对，不可盲重放）", () => {
      for (const r of ["timeout", "network"] as const) {
        const v = ratingOutcome(input({ writeResult: r }));
        expect(v.outcome).toBe("pending-confirm");
        expect(v.needsConfirm).toBe(true);
        expect(v.canRetry).toBe(false); // 先核对，不直接重试
        expect(v.terminal).toBe(false);
        expect(v.note).toContain("不盲目重放");
      }
    });

    it("明确失败 → failed（可重试，且如实说明未影响复习计划）", () => {
      const v = ratingOutcome(input({ writeResult: "fatal" }));
      expect(v.outcome).toBe("failed");
      expect(v.canRetry).toBe(true);
      expect(v.needsConfirm).toBe(false);
      expect(v.note).toContain("未影响复习计划");
    });

    it("结果为空（尚未发起）→ 按待确认呈现，避免乐观显示成功", () => {
      const v = ratingOutcome(input({ writeResult: null }));
      expect(v.outcome).toBe("pending-confirm");
      expect(v.terminal).toBe(false);
    });

    it("优先级：非法自评 > 未转卡 > 离线 > 写回结果", () => {
      // 未转卡优先于离线
      expect(ratingOutcome(input({ hasCard: false, kernelOnline: false })).outcome).toBe("not-a-card");
      // 离线优先于失败结果
      expect(ratingOutcome(input({ kernelOnline: false, writeResult: "fatal" })).outcome).toBe("skipped-offline");
    });

    it("每种状态都带中文名与如实说明（UI 可读，不夸大）", () => {
      for (const i of [
        input({ writeResult: "ok" }),
        input({ hasCard: false }),
        input({ kernelOnline: false }),
        input({ writeResult: "timeout" }),
        input({ writeResult: "fatal" }),
      ]) {
        const v = ratingOutcome(i);
        expect(v.label.length).toBeGreaterThan(0);
        expect(v.note.length).toBeGreaterThan(0);
      }
    });
  });

  describe("classifyWriteError 异常归类", () => {
    it("超时/中止 → timeout", () => {
      expect(classifyWriteError(new Error("request timeout"))).toBe("timeout");
      expect(classifyWriteError(new Error("Aborted"))).toBe("timeout");
    });

    it("网络类 → network", () => {
      expect(classifyWriteError(new Error("ECONNRESET"))).toBe("network");
      expect(classifyWriteError(new Error("fetch failed"))).toBe("network");
      expect(classifyWriteError(new Error("HTTP 503"))).toBe("network");
    });

    it("其余 → fatal；非 Error 输入也安全", () => {
      expect(classifyWriteError(new Error("code -1"))).toBe("fatal");
      expect(classifyWriteError("just a string")).toBe("fatal");
      expect(classifyWriteError(null)).toBe("fatal");
      expect(classifyWriteError(undefined)).toBe("fatal");
    });
  });

  describe("RatingGuard 防双击与重复提交", () => {
    it("同键第二次点击被忽略（在途时即拦截）", () => {
      const g = new RatingGuard();
      const k = ratingAttemptKey("s1", "q1", 3);
      expect(g.tryAcquire(k)).toBe(true);
      expect(g.tryAcquire(k)).toBe(false); // 在途 → 拒绝并发
      g.settle(k, true);
      expect(g.tryAcquire(k)).toBe(false); // 已完成 → 幂等拒绝
      expect(g.has(k)).toBe(true);
    });

    it("失败后允许重试（不写入 done）", () => {
      const g = new RatingGuard();
      const k = ratingAttemptKey("s1", "q1", 3);
      expect(g.tryAcquire(k)).toBe(true);
      g.settle(k, false);
      expect(g.has(k)).toBe(false);
      expect(g.tryAcquire(k)).toBe(true); // 可重试
    });

    it("不同题/会话/评级互不影响", () => {
      const g = new RatingGuard();
      expect(g.tryAcquire(ratingAttemptKey("s1", "q1", 3))).toBe(true);
      expect(g.tryAcquire(ratingAttemptKey("s1", "q1", 4))).toBe(true);
      expect(g.tryAcquire(ratingAttemptKey("s1", "q2", 3))).toBe(true);
      expect(g.tryAcquire(ratingAttemptKey("s2", "q1", 3))).toBe(true);
    });

    it("clear 释放全部（切题/换会话）", () => {
      const g = new RatingGuard();
      const k = ratingAttemptKey("s1", "q1", 3);
      g.tryAcquire(k);
      g.settle(k, true);
      g.clear();
      expect(g.has(k)).toBe(false);
      expect(g.tryAcquire(k)).toBe(true);
    });

    it("ratingAttemptKey 编码稳定且可区分字段", () => {
      expect(ratingAttemptKey("s1", "q1", 3)).toBe("s1::q1::3");
      expect(ratingAttemptKey("s1", "q1", 3)).not.toBe(ratingAttemptKey("s1", "q1", 4));
    });
  });

  describe("待确认：先核对再决定是否重放", () => {
    const pending: PendingRatingWrite = {
      qid: "q1",
      blockId: "b1",
      deckId: "d1",
      cardId: "c1",
      rating: 3,
      sessionId: "s1",
      requestedAt: 1_000_000,
    };

    it("核对提示含题目与时间，明确要求先核对", () => {
      const h = pendingConfirmHint(pending);
      expect(h).toContain("q1");
      expect(h).toContain("结果不明");
      expect(h).toContain("核对");
    });

    it("内核最近复习不早于申请时间 → 已落库，不重放（幂等）", () => {
      expect(shouldReplay({ requestedAt: 1_000_000 }, 1_000_000)).toBe(false);
      expect(shouldReplay({ requestedAt: 1_000_000 }, 1_002_000)).toBe(false);
    });

    it("内核复习明显早于申请时间 → 未落库，允许重写", () => {
      expect(shouldReplay({ requestedAt: 1_000_000 }, 900_000)).toBe(true);
    });

    it("查不到内核复习时间（null/NaN）→ 允许重写（不因缺失永久卡住）", () => {
      expect(shouldReplay({ requestedAt: 1_000_000 }, null)).toBe(true);
      expect(shouldReplay({ requestedAt: 1_000_000 }, undefined)).toBe(true);
      expect(shouldReplay({ requestedAt: 1_000_000 }, NaN)).toBe(true);
    });

    it("时钟偏差容差：恰在申请时刻前 5s 内视为已落库（避免抖动重复写）", () => {
      expect(shouldReplay({ requestedAt: 1_000_000 }, 996_000, 5_000)).toBe(false);
      expect(shouldReplay({ requestedAt: 1_000_000 }, 994_000, 5_000)).toBe(true);
    });
  });
});
