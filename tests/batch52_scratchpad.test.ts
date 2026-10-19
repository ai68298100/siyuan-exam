import { describe, it, expect } from "vitest";
import {
  getScratchpadText,
  updateScratchpadText,
  clearCurrentScratchpad,
  formatScratchpadSummary,
  type ScratchpadStore,
} from "../src/core/scratchpad";

describe("52-08 演算草稿纸浮层（五二批草稿纸纯函数与隔离）", () => {
  describe("getScratchpadText 模式读取", () => {
    const store: ScratchpadStore = {
      q1: "公式：v = v0 + at",
      q2: "推导：x = 2y + 3",
    };

    it("单题专属模式 per_question：按 qid 精准读取草稿", () => {
      expect(getScratchpadText(store, "q1", "per_question")).toBe("公式：v = v0 + at");
      expect(getScratchpadText(store, "q2", "per_question")).toBe("推导：x = 2y + 3");
      expect(getScratchpadText(store, "q3", "per_question")).toBe("");
    });

    it("全卷共享模式 shared：忽略 qid，直接返回共享内容", () => {
      expect(getScratchpadText(store, "q1", "shared", "共享速算表：1/7 ≈ 14.28%")).toBe("共享速算表：1/7 ≈ 14.28%");
      expect(getScratchpadText(store, "q2", "shared", "共享速算表：1/7 ≈ 14.28%")).toBe("共享速算表：1/7 ≈ 14.28%");
    });
  });

  describe("updateScratchpadText 草稿更新与切题隔离", () => {
    it("单题专属模式更新：互不污染", () => {
      let store: ScratchpadStore = {};
      const shared = "";

      // 题1 演算
      const r1 = updateScratchpadText(store, "q1", "125 * 8 = 1000", "per_question", shared);
      store = r1.store;

      // 切到题2 演算
      const r2 = updateScratchpadText(store, "q2", "ln(e) = 1", "per_question", shared);
      store = r2.store;

      expect(store.q1).toBe("125 * 8 = 1000");
      expect(store.q2).toBe("ln(e) = 1");

      // 清空或输入空白串自动清理键
      const r3 = updateScratchpadText(store, "q1", "   ", "per_question", shared);
      expect(r3.store.q1).toBeUndefined();
      expect(r3.store.q2).toBe("ln(e) = 1");
    });

    it("共享模式更新：仅修改 sharedText", () => {
      const store: ScratchpadStore = { q1: "独占草稿" };
      const r = updateScratchpadText(store, "q1", "全局速记：GDP 同比增 5.2%", "shared", "");
      expect(r.sharedText).toBe("全局速记：GDP 同比增 5.2%");
      expect(r.store.q1).toBe("独占草稿"); // store 不受影响
    });
  });

  describe("clearCurrentScratchpad 清空当前草稿", () => {
    it("单题专属模式下仅清空指定题", () => {
      const store: ScratchpadStore = { q1: "内容1", q2: "内容2" };
      const r = clearCurrentScratchpad(store, "q1", "per_question");
      expect(r.store.q1).toBeUndefined();
      expect(r.store.q2).toBe("内容2");
    });

    it("共享模式下清空 sharedText", () => {
      const r = clearCurrentScratchpad({}, "q1", "shared", "共享草稿");
      expect(r.sharedText).toBe("");
    });
  });

  describe("formatScratchpadSummary 会话摘要导出", () => {
    it("空草稿返回暂无记录提示", () => {
      expect(formatScratchpadSummary({})).toBe("暂无演算草稿记录");
    });

    it("格式化多题草稿清单与题干摘要", () => {
      const store: ScratchpadStore = {
        q1: "计算：100 / 4 = 25",
        q2: "逻辑反证法得出选 C",
      };
      const stems = {
        q1: "基础算术运算题目",
        q2: "逻辑推导真假话问题",
      };
      const summary = formatScratchpadSummary(store, stems);
      expect(summary).toContain("【会话演算草稿记录】");
      expect(summary).toContain("题目 q1（基础算术运算题目）");
      expect(summary).toContain("计算：100 / 4 = 25");
      expect(summary).toContain("题目 q2（逻辑推导真假话问题）");
      expect(summary).toContain("逻辑反证法得出选 C");
    });
  });
});
