import { describe, it, expect } from "vitest";
import {
  isOverlayEffective,
  filterEffectiveActiveWrongs,
  isWrongSuppressed,
  isWrongSnoozed,
  isWrongArchived,
  nextStreakCorrect,
  type WrongOverlayRecord,
} from "../src/core/wrongState";
import type { WrongItem } from "../src/core/types";

const makeItem = (over: Partial<WrongItem> = {}): WrongItem => ({
  qid: "q1",
  firstWrongAt: 1000,
  lastWrongAt: 1000,
  wrongCount: 1,
  streakCorrect: 0,
  myAnswer: "A",
  status: "active",
  ...over,
});

describe("39-05 错题状态机与手动处置覆盖层时效契约", () => {
  describe("isOverlayEffective 核心失效规则（处置后再错按约定恢复）", () => {
    it("无覆盖记录返回 false", () => {
      expect(isOverlayEffective(null, makeItem())).toBe(false);
      expect(isOverlayEffective(undefined, makeItem())).toBe(false);
    });

    it("处置后再次答错（lastWrongAt > at）→ 覆盖失效（即刻恢复在册）", () => {
      const overlay: WrongOverlayRecord = { status: "mastered", at: 2000, wrongCount: 3 };
      // 答错发生在处置之后（2001 > 2000）
      const item = makeItem({ lastWrongAt: 2001, wrongCount: 1 }); // 即使在新一轮中 wrongCount 计数重置
      expect(isOverlayEffective(overlay, item)).toBe(false);
    });

    it("处置当时或之前的答错（lastWrongAt <= at）→ 覆盖依然生效", () => {
      const overlay: WrongOverlayRecord = { status: "mastered", at: 2000, wrongCount: 3 };
      const item = makeItem({ lastWrongAt: 2000, wrongCount: 3 });
      expect(isOverlayEffective(overlay, item)).toBe(true);
    });

    it("错次高于处置快照（wrongCount > o.wrongCount）→ 覆盖失效", () => {
      const overlay: WrongOverlayRecord = { status: "mastered", at: 2000, wrongCount: 2 };
      // 即使时间戳相同（如批处理场景），错次递增亦触发失效
      const item = makeItem({ lastWrongAt: 2000, wrongCount: 3 });
      expect(isOverlayEffective(overlay, item)).toBe(false);
    });

    it("snoozed 暂缓状态：未到期有效，到期自动失效回册", () => {
      const overlay: WrongOverlayRecord = { status: "snoozed", at: 1000, wrongCount: 1, until: 5000 };
      const item = makeItem({ lastWrongAt: 1000, wrongCount: 1 });
      // now = 4000 < until(5000) → 仍在暂缓期
      expect(isOverlayEffective(overlay, item, 4000)).toBe(true);
      // now = 5001 > until(5000) → 暂缓到期失效，回到错题池
      expect(isOverlayEffective(overlay, item, 5001)).toBe(false);
    });

    it("暂缓期间如果再次答错，立即失效回册（不需等到期）", () => {
      const overlay: WrongOverlayRecord = { status: "snoozed", at: 1000, wrongCount: 1, until: 5000 };
      // 虽未到期（now=2000），但用户在 1500 又答错了
      const item = makeItem({ lastWrongAt: 1500, wrongCount: 1 });
      expect(isOverlayEffective(overlay, item, 2000)).toBe(false);
    });

    it("未知/不支持的状态返回 false", () => {
      const overlay: WrongOverlayRecord = { status: "unknown", at: 2000, wrongCount: 1 };
      expect(isOverlayEffective(overlay, makeItem({ lastWrongAt: 1000 }))).toBe(false);
    });
  });

  describe("filterEffectiveActiveWrongs 错题列表过滤", () => {
    it("排除已掌握与已移除的有效覆盖题，保留处置后再错题", () => {
      const w1 = makeItem({ qid: "q1", lastWrongAt: 1000, wrongCount: 1 }); // 覆盖生效，应排除
      const w2 = makeItem({ qid: "q2", lastWrongAt: 2500, wrongCount: 1 }); // 处置在 2000，再错在 2500，应保留
      const w3 = makeItem({ qid: "q3", lastWrongAt: 1000, wrongCount: 1 }); // 无覆盖，保留

      const overlays = new Map<string, WrongOverlayRecord>([
        ["q1", { status: "mastered", at: 2000, wrongCount: 1 }],
        ["q2", { status: "mastered", at: 2000, wrongCount: 1 }],
      ]);

      const active = filterEffectiveActiveWrongs([w1, w2, w3], overlays, 3000);
      expect(active.map((w) => w.qid)).toEqual(["q2", "q3"]);
    });

    it("非 active 状态的题即使无覆盖也不纳入活跃错题列表", () => {
      const wElim = makeItem({ qid: "qE", status: "eliminated" });
      expect(filterEffectiveActiveWrongs([wElim], new Map())).toEqual([]);
    });
  });

  describe("isWrongSuppressed / isWrongSnoozed / isWrongArchived 独立判定", () => {
    it("isWrongSuppressed 只对有效覆盖的 mastered/removed 为真", () => {
      const o: WrongOverlayRecord = { status: "mastered", at: 1000, wrongCount: 1 };
      expect(isWrongSuppressed(o, makeItem({ lastWrongAt: 1000 }))).toBe(true);
      expect(isWrongSuppressed(o, makeItem({ lastWrongAt: 1001 }))).toBe(false); // 再错失效
      expect(isWrongSuppressed({ ...o, status: "snoozed" }, makeItem({ lastWrongAt: 1000 }))).toBe(false);
    });

    it("isWrongSnoozed 只对未到期且未再错的 snoozed 为真", () => {
      const o: WrongOverlayRecord = { status: "snoozed", at: 1000, wrongCount: 1, until: 5000 };
      expect(isWrongSnoozed(o, makeItem({ lastWrongAt: 1000 }), 4000)).toBe(true);
      expect(isWrongSnoozed(o, makeItem({ lastWrongAt: 1000 }), 6000)).toBe(false); // 到期
      expect(isWrongSnoozed(o, makeItem({ lastWrongAt: 1500 }), 4000)).toBe(false); // 再错失效
    });

    it("isWrongArchived 只对有效覆盖的 archived 为真", () => {
      const o: WrongOverlayRecord = { status: "archived", at: 1000, wrongCount: 1 };
      expect(isWrongArchived(o, makeItem({ lastWrongAt: 1000 }))).toBe(true);
      expect(isWrongArchived(o, makeItem({ lastWrongAt: 1001 }))).toBe(false);
    });
  });

  describe("nextStreakCorrect 连续答对状态转移", () => {
    it("答错立即归零", () => {
      expect(nextStreakCorrect(1, "wrong")).toEqual({ streak: 0, eliminated: false, threshold: 2 });
      expect(nextStreakCorrect(2, "wrong")).toEqual({ streak: 0, eliminated: false, threshold: 2 });
    });

    it("错→对 streak 1，未达标", () => {
      expect(nextStreakCorrect(0, "correct")).toEqual({ streak: 1, eliminated: false, threshold: 2 });
    });

    it("错→对→对 streak 2，达标消灭", () => {
      expect(nextStreakCorrect(1, "correct")).toEqual({ streak: 2, eliminated: true, threshold: 2 });
    });

    it("not_attempted 保持原计数不变", () => {
      expect(nextStreakCorrect(1, "not_attempted")).toEqual({ streak: 1, eliminated: false, threshold: 2 });
    });
  });
});
