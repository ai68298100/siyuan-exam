import { describe, it, expect } from "vitest";
import { kpAudit, planKpMerge, planEmptyKpFill } from "../src/core/kpGovernance";
import { makeQuestion } from "../src/core/blockTemplate";
import type { Question } from "../src/core/types";

const q = (id: string, kp?: string): Question & { blockId?: string } => ({
  ...makeQuestion({ type: "single", stem: `题${id}`, options: ["1", "2"], answer: "A" }),
  id,
  kp,
  blockId: `b-${id}`,
});

describe("考点治理（51-02 lite，廿九批）", () => {
  it("kpAudit：题数降序、空考点单列、误分隔符标记、顶层聚合", () => {
    const audit = kpAudit([
      q("a", "言语/主旨"),
      q("b", "言语/主旨"),
      q("c", "言语、主旨"),      // 误分隔符（顿号）
      q("d", "资料/"),           // 末尾斜杠
      q("e"),
      q("f", "  "),              // 纯空白 = 空考点
    ]);
    expect(audit.entries[0]).toMatchObject({ kp: "言语/主旨", count: 2, suspect: false });
    expect(audit.entries.find((e) => e.kp === "言语、主旨")?.suspect).toBe(true);
    expect(audit.entries.find((e) => e.kp === "资料/")?.suspect).toBe(true);
    expect(audit.emptyCount).toBe(2);
    // 顶层聚合：误分隔符的"言语、主旨"独立成组（不与 言语/ 主组合并——51-02 同名≠同一技能）
    expect(audit.topLevels).toEqual([
      { top: "言语", count: 2 },
      { top: "言语、主旨", count: 1 },
      { top: "资料", count: 1 },
    ]);
  });

  it("planKpMerge：同名题全部进计划（dry-run 复用批量编辑，撤销免费获得）", () => {
    const qs = [q("a", "言语"), q("b", "言语"), q("c", "资料")];
    const { picked, plan } = planKpMerge(qs, "言语", "行测/言语理解");
    expect(picked.map((x) => x.id)).toEqual(["a", "b"]);
    expect(plan.changes).toHaveLength(2);
    expect(plan.changes[0]).toMatchObject({ field: "kp", from: "言语", to: "行测/言语理解" });
    // 无关考点不受影响
    expect(planKpMerge(qs, "数量", "资料").plan.changes).toHaveLength(0);
  });

  it("planEmptyKpFill：只圈空考点题（含空白字符串）", () => {
    const { picked, plan } = planEmptyKpFill([q("a"), q("b", "  "), q("c", "已有")], "未分类");
    expect(picked.map((x) => x.id)).toEqual(["a", "b"]);
    expect(plan.changes[0]).toMatchObject({ from: "", to: "未分类" });
  });
});
