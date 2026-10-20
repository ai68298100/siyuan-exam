import { describe, it, expect } from "vitest";
import type { Question } from "../src/core/types";
import {
  areQuestionsSiblings,
  burySiblingsForPractice,
  disperseSiblings,
  verifyBuryContract,
} from "../src/core/siblingBury";

function mkQuestion(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    type: "single",
    stem: `题目 ${id}`,
    options: ["A", "B", "C", "D"],
    answer: "A",
    score: 1,
    origin: "manual",
    hash: `hash-${id}`,
    ...overrides,
  };
}

describe("SiblingBury 题族同源识别与练习防泄露暂缓引擎 (65-03 / 52-07)", () => {
  describe("areQuestionsSiblings (同源兄弟题识别)", () => {
    it("自身与自身不构成兄弟关系", () => {
      const q = mkQuestion("q1");
      expect(areQuestionsSiblings(q, q).isSibling).toBe(false);
    });

    it("题族关联：相同 family.parentId 或父子关联判定为同源兄弟题", () => {
      // 1. 同一父题衍生出的两道变式
      const v1 = mkQuestion("v1", { family: { parentId: "origin-q", variantKind: "numeric", verified: true } });
      const v2 = mkQuestion("v2", { family: { parentId: "origin-q", variantKind: "reverse", verified: true } });
      const rel1 = areQuestionsSiblings(v1, v2);
      expect(rel1.isSibling).toBe(true);
      expect(rel1.kind).toBe("family");
      expect(rel1.reason).toContain("同属题族");

      // 2. 原题与变式题
      const origin = mkQuestion("origin-q");
      const rel2 = areQuestionsSiblings(v1, origin);
      expect(rel2.isSibling).toBe(true);
      expect(rel2.kind).toBe("family");
      expect(rel2.reason).toContain("衍生变式兄弟题");
    });

    it("材料组关联：相同 group 判定为材料兄弟题", () => {
      const m1 = mkQuestion("m1", { group: "grp-eco" });
      const m2 = mkQuestion("m2", { group: "grp-eco" });
      const rel = areQuestionsSiblings(m1, m2);
      expect(rel.isSibling).toBe(true);
      expect(rel.kind).toBe("material_group");
      expect(rel.reason).toContain("材料题组 [grp-eco]");
    });

    it("无关联的独立题目判定为非兄弟题", () => {
      const q1 = mkQuestion("q1", { kp: "数学" });
      const q2 = mkQuestion("q2", { kp: "常识" });
      expect(areQuestionsSiblings(q1, q2).isSibling).toBe(false);
    });
  });

  describe("burySiblingsForPractice (防泄露暂缓策略)", () => {
    it("队列中出现同族变式时，仅首题出列，后置兄弟题暂缓至下次练习", () => {
      const qOriginal = mkQuestion("q-parent");
      const qVar1 = mkQuestion("q-v1", { family: { parentId: "q-parent", variantKind: "numeric" } });
      const qVar2 = mkQuestion("q-v2", { family: { parentId: "q-parent", variantKind: "reverse" } });
      const qIndependent = mkQuestion("q-other");

      const input = [qOriginal, qIndependent, qVar1, qVar2];
      const result = burySiblingsForPractice(input);

      // qOriginal 保留在 active，qVar1 和 qVar2 暂缓至 buried
      expect(result.active.map((q) => q.id)).toEqual(["q-parent", "q-other"]);
      expect(result.buried).toHaveLength(2);
      expect(result.buried[0].question.id).toBe("q-v1");
      expect(result.buried[0].siblingOf).toBe("q-parent");
      expect(result.buried[0].relationKind).toBe("family");
      expect(result.buried[0].reason).toContain("防答案提示");

      // 契约校验通过（零丢题）
      expect(verifyBuryContract(input, result)).toBe(true);
      expect(result.receipt).toContain("暂缓 2 道同源兄弟题");
    });

    it("默认开启材料题组保护时，同一材料组题目连续呈现不暂缓", () => {
      const m1 = mkQuestion("m1", { group: "grp-read" });
      const m2 = mkQuestion("m2", { group: "grp-read" });
      const m3 = mkQuestion("m3", { group: "grp-read" });
      const regular = mkQuestion("reg-1");

      const input = [m1, m2, regular, m3];
      const result = burySiblingsForPractice(input, { preserveMaterialGroups: true });

      // 材料题全部保留在 active，方便考生连贯作答
      expect(result.active).toHaveLength(4);
      expect(result.buried).toHaveLength(0);
      expect(verifyBuryContract(input, result)).toBe(true);
    });

    it("当关闭材料保护时，材料组后续题目亦可被暂缓", () => {
      const m1 = mkQuestion("m1", { group: "grp-read" });
      const m2 = mkQuestion("m2", { group: "grp-read" });

      const input = [m1, m2];
      const result = burySiblingsForPractice(input, { preserveMaterialGroups: false });

      expect(result.active.map((q) => q.id)).toEqual(["m1"]);
      expect(result.buried).toHaveLength(1);
      expect(result.buried[0].question.id).toBe("m2");
    });

    it("开关与模考安全豁免契约 (65-03 验收标准)", () => {
      const q1 = mkQuestion("q1", { family: { parentId: "fam-x" } });
      const q2 = mkQuestion("q2", { family: { parentId: "fam-x" } });
      const input = [q1, q2];

      // 1. 关闭暂缓开关
      const resDisabled = burySiblingsForPractice(input, { enabled: false });
      expect(resDisabled.active).toHaveLength(2);
      expect(resDisabled.buried).toHaveLength(0);
      expect(resDisabled.receipt).toContain("已关闭");

      // 2. 模考模式豁免：模考严格尊重卷面蓝图，绝不改动
      const resMock = burySiblingsForPractice(input, { mode: "mock" });
      expect(resMock.active).toHaveLength(2);
      expect(resMock.buried).toHaveLength(0);
      expect(resMock.receipt).toContain("模考全真试卷触发安全豁免");
    });
  });

  describe("disperseSiblings (会话内兄弟题打散)", () => {
    it("将同族相邻的变式题打散至安全间隔，且不破坏材料题组连续性", () => {
      const v1 = mkQuestion("v1", { family: { parentId: "fam-1" } });
      const v2 = mkQuestion("v2", { family: { parentId: "fam-1" } });
      const m1 = mkQuestion("m1", { group: "grp-cbt" });
      const m2 = mkQuestion("m2", { group: "grp-cbt" });
      const ind1 = mkQuestion("ind1");
      const ind2 = mkQuestion("ind2");

      // 原始顺序：v1 与 v2 紧挨着
      const input = [v1, v2, ind1, ind2, m1, m2];
      const dispersed = disperseSiblings(input, { minSpacing: 2 });

      // 总题数保持不变
      expect(dispersed).toHaveLength(6);

      // v1 与 v2 不再紧挨着
      const idxV1 = dispersed.findIndex((q) => q.id === "v1");
      const idxV2 = dispersed.findIndex((q) => q.id === "v2");
      expect(Math.abs(idxV1 - idxV2)).toBeGreaterThan(1);

      // 材料题 m1 和 m2 仍然紧挨在一起
      const idxM1 = dispersed.findIndex((q) => q.id === "m1");
      const idxM2 = dispersed.findIndex((q) => q.id === "m2");
      expect(Math.abs(idxM1 - idxM2)).toBe(1);
    });

    it("题目数量很少 (≤2) 或模考模式下原样返回", () => {
      const q1 = mkQuestion("q1");
      const q2 = mkQuestion("q2");
      expect(disperseSiblings([q1, q2])).toEqual([q1, q2]);

      const qVar = mkQuestion("qVar", { family: { parentId: "fam" } });
      const resMock = disperseSiblings([q1, q2, qVar], { mode: "mock" });
      expect(resMock).toEqual([q1, q2, qVar]);
    });
  });
});
