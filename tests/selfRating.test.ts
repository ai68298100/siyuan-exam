import { describe, it, expect } from "vitest";
import {
  selfRatingMeta,
  isRecalled,
  isEffortful,
  answerFacts,
  reciteStreakEffect,
  binaryToSelfRating,
  selfRatingToBinary,
  reciteBreakdown,
  reciteBreakdownText,
} from "../src/core/selfRating";

describe("39-04 Hard 标签与自评语义", () => {
  describe("自评元数据与 FSRS 标签一致（39-01 同序同值）", () => {
    it("四档标签与内核 riff.Rating 一致", () => {
      expect(selfRatingMeta(1)?.fsrsLabel).toBe("Again");
      expect(selfRatingMeta(2)?.fsrsLabel).toBe("Hard");
      expect(selfRatingMeta(3)?.fsrsLabel).toBe("Good");
      expect(selfRatingMeta(4)?.fsrsLabel).toBe("Easy");
    });

    it("非法档位返回 null（不猜测）", () => {
      expect(selfRatingMeta(0)).toBeNull();
      expect(selfRatingMeta(5)).toBeNull();
      expect(selfRatingMeta(NaN)).toBeNull();
    });
  });

  describe("核心区分：Hard 是「费力但成功回忆」，不是失败", () => {
    it("Hard(2) recalled=true、effortful=true", () => {
      expect(isRecalled(2)).toBe(true);
      expect(isEffortful(2)).toBe(true);
    });

    it("唯有 Again(1) 属未回忆成功", () => {
      expect(isRecalled(1)).toBe(false);
      expect(isEffortful(1)).toBe(false);
      expect(isRecalled(3)).toBe(true);
      expect(isRecalled(4)).toBe(true);
    });

    it("effortful 只对 Hard 为真（Good/Easy 不算费力）", () => {
      expect(isEffortful(1)).toBe(false);
      expect(isEffortful(3)).toBe(false);
      expect(isEffortful(4)).toBe(false);
    });

    it("旧实现的 `>= 3` 口径会把 Hard 当失败——此处明确其应为成功回忆", () => {
      // 旧口径：selfRating >= 3 → correct；Hard(2) 落入 wrong
      expect(2 >= 3).toBe(false); // 旧口径判为「错」
      expect(isRecalled(2)).toBe(true); // 正确语义：成功回忆
    });
  });

  describe("answerFacts 客观判分与自评分别保留", () => {
    it("练习作答保留客观判分，自评为空", () => {
      const f = answerFacts({ kind: "practice", verdict: "wrong" });
      expect(f.objective).toBe("wrong");
      expect(f.selfRating).toBeNull();
      expect(f.recalled).toBeNull();
    });

    it("背诵作答：objective 恒为 null（无标准答案可比，不伪装客观对错）", () => {
      const f = answerFacts({ kind: "recite", verdict: "wrong", selfRating: 2 });
      expect(f.objective).toBeNull(); // 关键：不把自评伪装成客观「答错」
      expect(f.selfRating).toBe(2);
      expect(f.recalled).toBe(true);
      expect(f.effortful).toBe(true);
    });

    it("card 类型同样按自评语义处理", () => {
      const f = answerFacts({ kind: "card", verdict: "correct", selfRating: 4 });
      expect(f.objective).toBeNull();
      expect(f.recalled).toBe(true);
      expect(f.effortful).toBe(false);
    });

    it("无自评的背诵事件：recalled 为 null（不默认成失败）", () => {
      const f = answerFacts({ kind: "recite", verdict: "wrong" });
      expect(f.selfRating).toBeNull();
      expect(f.recalled).toBeNull();
    });

    it("非法自评值不产生语义", () => {
      const f = answerFacts({ kind: "recite", selfRating: 99 });
      expect(f.selfRating).toBeNull();
      expect(f.recalled).toBeNull();
    });
  });

  describe("背诵连击：Hard 不清零（旧实现会误清零）", () => {
    it("Again(1) → 清零", () => {
      expect(reciteStreakEffect(1).action).toBe("reset");
      expect(reciteStreakEffect(1).reason).toContain("未回忆成功");
    });

    it("Hard(2) → 保持不清零（费力但成功，不应抹掉既有进度）", () => {
      const e = reciteStreakEffect(2);
      expect(e.action).toBe("hold");
      expect(e.reason).toContain("不当作失败清零");
    });

    it("Good/Easy → 递增", () => {
      expect(reciteStreakEffect(3).action).toBe("increment");
      expect(reciteStreakEffect(4).action).toBe("increment");
    });

    it("毕业口径：Hard 不计入毕业连击（避免「每次都很勉强」被当成已掌握）", () => {
      // Hard 是 hold 而非 increment → 不会推进毕业计数
      expect(reciteStreakEffect(2).action).not.toBe("increment");
    });

    it("非法值不改动连击（不误清零也不误递增）", () => {
      expect(reciteStreakEffect(0).action).toBe("hold");
      expect(reciteStreakEffect(99).action).toBe("hold");
    });
  });

  describe("二元模式映射明确", () => {
    it("记住=Good(3)（不宣称 Easy）、忘了=Again(1)", () => {
      expect(binaryToSelfRating(true)).toBe(3);
      expect(binaryToSelfRating(false)).toBe(1);
      // 二元模式没有采集费力程度，故不使用 Hard/Easy
      expect(binaryToSelfRating(true)).not.toBe(4);
    });

    it("反投影：Hard 归「记住了」（它是成功回忆）", () => {
      expect(selfRatingToBinary(1)).toBe(false);
      expect(selfRatingToBinary(2)).toBe(true);
      expect(selfRatingToBinary(3)).toBe(true);
      expect(selfRatingToBinary(4)).toBe(true);
      expect(selfRatingToBinary(99)).toBeNull();
    });

    it("二元往返一致（记住→→记住；忘了→→忘了）", () => {
      expect(selfRatingToBinary(binaryToSelfRating(true))).toBe(true);
      expect(selfRatingToBinary(binaryToSelfRating(false))).toBe(false);
    });
  });

  describe("组结算口径：Hard 单列不与失败混淆", () => {
    it("分类计数正确", () => {
      const b = reciteBreakdown([1, 2, 2, 3, 4, 99]);
      expect(b.total).toBe(6);
      expect(b.smooth).toBe(2); // 3,4
      expect(b.effortful).toBe(2); // 2,2
      expect(b.missed).toBe(1); // 1
      expect(b.invalid).toBe(1); // 99
    });

    it("空集合归零", () => {
      expect(reciteBreakdown([])).toMatchObject({ total: 0, smooth: 0, effortful: 0, missed: 0 });
    });

    it("回执把「费力但成功」单列，不与「未回忆成功」同列", () => {
      const txt = reciteBreakdownText(reciteBreakdown([1, 2, 3]));
      expect(txt).toContain("顺利回忆 1");
      expect(txt).toContain("费力但成功 1");
      expect(txt).toContain("未回忆成功 1");
      // 不得出现把 Hard 归入失败的表述
      const effortIdx = txt.indexOf("费力但成功");
      const missIdx = txt.indexOf("未回忆成功");
      expect(effortIdx).toBeGreaterThan(-1);
      expect(effortIdx).not.toBe(missIdx);
    });

    it("无费力题时不显示该项（不虚报）", () => {
      expect(reciteBreakdownText(reciteBreakdown([3, 4]))).not.toContain("费力但成功");
    });
  });
});
