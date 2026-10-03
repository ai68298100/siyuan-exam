import { describe, it, expect } from "vitest";
import { planBatchEdit, invertPlan, describeChange } from "../src/core/batchEdit";
import { makeQuestion } from "../src/core/blockTemplate";
import type { Question } from "../src/core/types";

const q = (id: string, over: Partial<Question> & { blockId?: string } = {}): Question & { blockId?: string } => ({
  ...makeQuestion({ type: "single", stem: `题${id}`, options: ["1", "2"], answer: "A", ...over }),
  id,
  ...over,
});

describe("批量编辑 dry-run（43-06 lite）", () => {
  it("计划逐题 from→to；值不变与无块 ID 的题跳过并计数", () => {
    const qs = [
      q("a", { kp: "言语", blockId: "b1" }),
      q("b", { kp: "言语", blockId: "b2" }),
      q("c", { kp: "资料", blockId: "b3" }),
      q("d", { kp: "资料" }), // 无块 ID → skip
    ];
    const plan = planBatchEdit(qs, "kp", "数量");
    expect(plan.changes.map((c) => c.qid)).toEqual(["a", "b", "c"]);
    expect(plan.changes[0]).toMatchObject({ field: "kp", from: "言语", to: "数量", blockId: "b1" });
    expect(plan.skipped).toBe(1);
    // 值不变 → 全跳过、零变更
    const same = planBatchEdit([qs[2]], "kp", "资料");
    expect(same.changes).toHaveLength(0);
    expect(same.skipped).toBe(1);
  });

  it("难度字段：空值视为（空）→ 设值；上限截断计入 skipped", () => {
    const plan = planBatchEdit([q("x", { difficulty: undefined, blockId: "bx" })], "difficulty", "3");
    expect(plan.changes[0]).toMatchObject({ from: "", to: "3" });
    const many = Array.from({ length: 505 }, (_, i) => q(`m${i}`, { blockId: `bm${i}` }));
    const capped = planBatchEdit(many, "difficulty", "2");
    expect(capped.changes).toHaveLength(500);
    expect(capped.skipped).toBe(5);
  });

  it("invertPlan：from/to 互换可作撤销依据；describeChange 空值显示（空）", () => {
    const plan = planBatchEdit([q("a", { kp: "言语", blockId: "b1" })], "kp", "判断");
    const inv = invertPlan(plan.changes);
    expect(inv[0]).toMatchObject({ from: "判断", to: "言语" });
    const empty = planBatchEdit([q("e", { blockId: "be" })], "kp", "新考点");
    expect(describeChange(empty.changes[0], "某题")).toContain("（空） → 新考点");
  });

  it("新维度（廿四批）：出处/年份/分值计划、字段标签与撤销互换", () => {
    const qs = [
      q("a", { source: "2022 国考", year: "2022", score: 1, blockId: "b1" }),
      q("b", { blockId: "b2" }),
    ];
    const src = planBatchEdit(qs, "source", "2023 国考");
    expect(src.changes.map((c) => c.qid)).toEqual(["a", "b"]);
    expect(describeChange(src.changes[0], "某题")).toContain("出处：2022 国考 → 2023 国考");

    const year = planBatchEdit(qs, "year", "2023");
    expect(year.changes[0]).toMatchObject({ from: "2022", to: "2023" });
    expect(describeChange(year.changes[1], "某题")).toContain("年份：（空） → 2023");

    const score = planBatchEdit(qs, "score", "0.5");
    expect(score.changes[0]).toMatchObject({ field: "score", from: "1", to: "0.5" });
    // 分值不变 → 跳过
    const sameScore = planBatchEdit([qs[0]], "score", "1");
    expect(sameScore.changes).toHaveLength(0);
    expect(sameScore.skipped).toBe(1);
    // 撤销：逆向计划写回原值（app.applyBatchEdit 经 BATCH_FIELD_ATTR 映射 custom-exam-*）
    const inv = invertPlan(score.changes);
    expect(inv[0]).toMatchObject({ from: "0.5", to: "1" });
  });
});
