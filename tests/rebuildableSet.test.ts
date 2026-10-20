import { describe, it, expect } from "vitest";
import type { Question } from "../src/core/types";
import {
  computeBankFingerprint,
  matchesPracticeSetFilter,
  createPracticeSetSpec,
  rebuildPracticeSet,
  isPracticeSetStale,
} from "../src/core/rebuildableSet";

function mkQ(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    type: "single",
    stem: `题干 ${id}`,
    options: ["A", "B"],
    answer: "A",
    score: 1,
    origin: "manual",
    hash: `hash-${id}`,
    kp: "常识",
    ...overrides,
  };
}

function mkBank(n: number): Question[] {
  return Array.from({ length: n }, (_, i) => mkQ(`q${i + 1}`, { kp: i % 2 === 0 ? "常识" : "言语" }));
}

describe("RebuildableSet 可重建临时练习集引擎 (65-04 / 61-01 / 55-03)", () => {
  describe("computeBankFingerprint (题库内容指纹)", () => {
    it("同一题库内容指纹稳定，题目修改或增删后指纹变化", () => {
      const bank = mkBank(5);
      const fp1 = computeBankFingerprint(bank);
      expect(fp1).toBe(computeBankFingerprint([...bank].reverse())); // 顺序无关

      const modified = bank.map((q) => (q.id === "q3" ? { ...q, hash: "changed" } : q));
      expect(computeBankFingerprint(modified)).not.toBe(fp1);

      const added = [...bank, mkQ("q99")];
      expect(computeBankFingerprint(added)).not.toBe(fp1);
    });
  });

  describe("matchesPracticeSetFilter (查询谓词)", () => {
    it("关键词、题型、考点前缀、来源、错题与收藏过滤正确", () => {
      const q1 = mkQ("a", { stem: "光合作用的产物", kp: "生物/植物" });
      const q2 = mkQ("b", { type: "multiple", kp: "生物/动物", sourceKind: "real" });
      const q3 = mkQ("c", { fav: true, kp: "常识" });

      expect(matchesPracticeSetFilter(q1, { keyword: "光合" })).toBe(true);
      expect(matchesPracticeSetFilter(q1, { keyword: "光合" , types: ["single"] })).toBe(true);
      expect(matchesPracticeSetFilter(q1, { types: ["multiple"] })).toBe(false);
      expect(matchesPracticeSetFilter(q1, { kpPrefix: "生物" })).toBe(true);
      expect(matchesPracticeSetFilter(q1, { kpPrefix: "言语" })).toBe(false);
      expect(matchesPracticeSetFilter(q2, { sourceKind: "real" })).toBe(true);
      expect(matchesPracticeSetFilter(q1, { sourceKind: "real" })).toBe(false); // 缺省按 mock
      expect(matchesPracticeSetFilter(q3, { onlyFav: true })).toBe(true);
      expect(matchesPracticeSetFilter(q1, { onlyFav: true })).toBe(false);
      expect(matchesPracticeSetFilter(q1, { onlyWrong: true }, { wrongQids: new Set(["a"]) })).toBe(true);
      expect(matchesPracticeSetFilter(q1, { onlyWrong: true }, { wrongQids: new Set(["b"]) })).toBe(false);
    });
  });

  describe("createPracticeSetSpec (声明创建)", () => {
    it("只保存查询与种子快照，不复制题面实体；同种子可确定性复现", () => {
      const bank = mkBank(10);
      const spec = createPracticeSetSpec({
        id: "set-1",
        name: "常识速刷",
        bankId: "bank-1",
        questions: bank,
        filter: { kpPrefix: "常识" },
        limit: 3,
        seed: "fixed-seed",
        nowMs: 1_700_000_000_000,
      });

      expect(spec.v).toBe(1);
      expect(spec.snapshot).toHaveLength(3);
      expect(spec.seed).toBe("fixed-seed");
      expect(spec.writePolicy).toBe("practice");
      // 快照只含 qid 与 hash，不含题干
      const first = spec.snapshot[0] as unknown as Record<string, unknown>;
      expect(first).toHaveProperty("qid");
      expect(first).toHaveProperty("hash");
      expect(first).not.toHaveProperty("stem");
      // 全部命中常识考点
      expect(spec.snapshot.every((s) => ["q1", "q3", "q5", "q7", "q9"].includes(s.qid))).toBe(true);

      // 同种子二次生成完全一致
      const spec2 = createPracticeSetSpec({
        id: "set-1b",
        name: "常识速刷2",
        bankId: "bank-1",
        questions: bank,
        filter: { kpPrefix: "常识" },
        limit: 3,
        seed: "fixed-seed",
      });
      expect(spec2.snapshot).toEqual(spec.snapshot);
    });
  });

  describe("rebuildPracticeSet (重建与差异比对)", () => {
    it("题库未变时完整保留顺序；删除视图不删原题", () => {
      const bank = mkBank(8);
      const spec = createPracticeSetSpec({
        id: "s1",
        name: "全库",
        bankId: "b1",
        questions: bank,
        limit: 5,
        seed: "seed-x",
      });

      const res = rebuildPracticeSet({ spec, liveQuestions: bank });
      expect(res.questions.map((q) => q.id)).toEqual(spec.snapshot.map((s) => s.qid));
      expect(res.diff.retained).toHaveLength(5);
      expect(res.diff.added).toHaveLength(0);
      expect(res.diff.removed).toHaveLength(0);
      expect(res.receipt).toContain("删除视图不会移除题库原题");
      // 原题库未被修改
      expect(bank).toHaveLength(8);
    });

    it("题目被删除、被修订与新增时，差异如实报告且不静默替换", () => {
      const bank = mkBank(8);
      const spec = createPracticeSetSpec({
        id: "s2",
        name: "全库",
        bankId: "b1",
        questions: bank,
        limit: 8,
        seed: "seed-y",
      });
      const removedQid = spec.snapshot[0].qid;
      const revisedQid = spec.snapshot[1].qid;

      const live = bank
        .filter((q) => q.id !== removedQid)
        .map((q) => (q.id === revisedQid ? { ...q, hash: "revised-hash" } : q));
      live.push(mkQ("q-new"));

      const res = rebuildPracticeSet({ spec, liveQuestions: live });
      expect(res.diff.removed).toContain(removedQid);
      expect(res.diff.revised).toContain(revisedQid);
      expect(res.diff.added).toContain("q-new");
      expect(res.diff.summary).toContain("已删除 1 题");
      expect(res.receipt).toContain("重建完成");
    });

    it("预览模式明确不写回；练习模式明确写流水", () => {
      const bank = mkBank(4);
      const previewSpec = createPracticeSetSpec({
        id: "pv", name: "预览集", bankId: "b1", questions: bank, limit: 2, writePolicy: "preview",
      });
      const previewRes = rebuildPracticeSet({ spec: previewSpec, liveQuestions: bank });
      expect(previewRes.writePolicy).toBe("preview");
      expect(previewRes.receipt).toContain("不写回任何流水");

      const practiceSpec = createPracticeSetSpec({
        id: "pr", name: "练习集", bankId: "b1", questions: bank, limit: 2, writePolicy: "practice",
      });
      const practiceRes = rebuildPracticeSet({ spec: practiceSpec, liveQuestions: bank });
      expect(practiceRes.receipt).toContain("正常写入流水");
    });
  });

  describe("isPracticeSetStale (过期判定)", () => {
    it("题库指纹变化后判定为过期", () => {
      const bank = mkBank(5);
      const spec = createPracticeSetSpec({ id: "x", name: "n", bankId: "b", questions: bank, limit: 3 });
      expect(isPracticeSetStale(spec, bank)).toBe(false);
      expect(isPracticeSetStale(spec, [...bank, mkQ("extra")])).toBe(true);
    });
  });
});
