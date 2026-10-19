import { describe, it, expect } from "vitest";
import {
  queueKindOf,
  queueSemantics,
  allowsSchedulerWriteBack,
  writeBackReceipt,
  countByQueue,
  type QueueKind,
} from "../src/core/queueIdentity";

describe("39-02 队列身份与写回语义（Queue Identity）", () => {
  describe("queueKindOf 模式 → 队列身份", () => {
    it("wrong 模式记为 wrong（保留错题身份）", () => {
      expect(queueKindOf("wrong")).toBe("wrong");
      expect(queueKindOf("WRONG")).toBe("wrong");
      expect(queueKindOf("  wrong  ")).toBe("wrong");
    });

    it("cram/sprint 模式记为 cram（此前被误记为 normal）", () => {
      for (const m of ["cram", "cramDrill", "sprint", "cram-drill", "CRAM"]) {
        expect(queueKindOf(m)).toBe("cram");
      }
    });

    it("普通练习各入口记为 normal（quick/daily/fav/challenge/paper/practice/review）", () => {
      for (const m of ["quick", "daily", "fav", "challenge", "paper", "practice", "review"]) {
        expect(queueKindOf(m)).toBe("normal");
      }
    });

    it("未知/空/undefined 模式保守归 normal（不猜测为 cram，避免丢失复习身份）", () => {
      expect(queueKindOf("")).toBe("normal");
      expect(queueKindOf("   ")).toBe("normal");
      expect(queueKindOf(null)).toBe("normal");
      expect(queueKindOf(undefined)).toBe("normal");
      expect(queueKindOf("someUnknownMode")).toBe("normal");
    });

    it("返回值恒在合法域内（写流水类型安全）", () => {
      const legal: QueueKind[] = ["normal", "wrong", "cram"];
      for (const m of ["wrong", "cram", "quick", "daily", "", "???", null]) {
        expect(legal).toContain(queueKindOf(m));
      }
    });
  });

  describe("queueSemantics 语义与写回策略", () => {
    it("三类队列都不写回调度（ADR 0003：普通练习/预览不暗改调度，cram reschedule-off）", () => {
      expect(queueSemantics("quick").writesBack).toBe(false);
      expect(queueSemantics("wrong").writesBack).toBe(false);
      expect(queueSemantics("cram").writesBack).toBe(false);
    });

    it("cram 语义明确标注永不写回（Anki reschedule-off）", () => {
      const sem = queueSemantics("cram");
      expect(sem.kind).toBe("cram");
      expect(sem.note).toContain("永不写回");
      expect(sem.note).toContain("reschedule-off");
    });

    it("每类队列都有中文名与如实说明（结算回执可读）", () => {
      for (const m of ["quick", "wrong", "cram"]) {
        const sem = queueSemantics(m);
        expect(sem.label.length).toBeGreaterThan(0);
        expect(sem.note.length).toBeGreaterThan(0);
      }
    });
  });

  describe("allowsSchedulerWriteBack 写回门控", () => {
    it("任何队列模式都不允许写回（显式契约，非靠调用方漏掉）", () => {
      for (const m of ["quick", "wrong", "cram", "daily", "fav", "challenge", "", null]) {
        expect(allowsSchedulerWriteBack(m)).toBe(false);
      }
    });
  });

  describe("writeBackReceipt 结算回执", () => {
    it("默认回执明确「本次不写回内核调度」", () => {
      const r = writeBackReceipt("cram");
      expect(r).toContain("冲刺复习");
      expect(r).toContain("本次不写回内核调度");
    });

    it("显式写回时也如实标注（用于背诵自评路径）", () => {
      const r = writeBackReceipt("practice", true);
      expect(r).toContain("本次写回内核调度");
    });

    it("回执含队列名，不同队列可区分（不把普通练习伪装成内核复习）", () => {
      expect(writeBackReceipt("wrong")).toContain("错题重练");
      expect(writeBackReceipt("quick")).toContain("普通练习");
    });
  });

  describe("countByQueue 队列聚合", () => {
    it("按队列身份计数，缺 queue 的旧事件按 normal 计（向后兼容）", () => {
      const out = countByQueue([
        { queue: "cram" },
        { queue: "cram" },
        { queue: "wrong" },
        {},
        { queue: "normal" },
      ]);
      expect(out).toEqual({ normal: 2, wrong: 1, cram: 2 });
    });

    it("空事件集合归零", () => {
      expect(countByQueue([])).toEqual({ normal: 0, wrong: 0, cram: 0 });
    });
  });
});
