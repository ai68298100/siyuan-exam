import { describe, it, expect } from "vitest";
import {
  parseErrataCsv,
  planErrata,
  errataTemplateCsv,
  splitCsvLine,
} from "../src/core/errata";
import type { Question } from "../src/core/types";

function q(partial: Partial<Question>): Question & { blockId?: string } {
  return {
    id: "q-aaaaaaaa",
    type: "single",
    stem: "S",
    options: ["a", "b"],
    answer: "A",
    score: 1,
    origin: "imported",
    hash: "h",
    ...partial,
  };
}

const EXISTING = [
  q({ id: "q-aaaaaaaa", blockId: "blk-1", kp: "资料分析", difficulty: 3, source: "2023 真题", score: 2 }),
  q({ id: "q-bbbbbbbb", blockId: "blk-2", kp: "数量关系", source: "" }),
];

describe("57 勘误回导：解析", () => {
  it("表头别名 + 引号字段 + 部分列可选", () => {
    const csv = [
      "题目ID,知识点,难度,来源,年份,分值",
      'q-aaaaaaaa,"资料分析/增长率",4,"2024 真题,修订",2024,3',
      "q-bbbbbbbb,数量关系,,官方出处,",
    ].join("\n");
    const r = parseErrataCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows[0].fields).toEqual({ kp: "资料分析/增长率", difficulty: "4", source: "2024 真题,修订", year: "2024", score: "3" });
    expect(r.rows[1].fields).toEqual({ kp: "数量关系", source: "官方出处" }); // 空单元格=不改
  });

  it("表头错误与行错误逐一可行动", () => {
    expect(parseErrataCsv("题干,答案\nS,A").errors[0].reason).toContain("题目ID");
    expect(parseErrataCsv("题目ID\nq-aaaaaaaa").errors[0].reason).toContain("勘误字段");
    const r = parseErrataCsv("题目ID,知识点\n,资料\nBADID,资料\nq-aaaaaaaa,");
    expect(r.errors.map((e) => e.reason)).toEqual(["缺少题目ID", expect.stringContaining("格式不符"), "没有任何字段值"]);
    expect(r.rows).toHaveLength(0);
  });

  it("分隔符自动判别（Tab 优先于逗号计数）；splitCsvLine 引号转义", () => {
    const tsv = parseErrataCsv("题目ID\t知识点\nq-aaaaaaaa\t数量关系");
    expect(tsv.rows[0].fields.kp).toBe("数量关系");
    expect(splitCsvLine('"a,","b""c"', ",")).toEqual(["a,", 'b"c']);
  });

  it("500 行上限截断", () => {
    const lines = ["题目ID,知识点", ...Array.from({ length: 510 }, (_, i) => `q-aaaaaaaa,知识点${i}`)];
    const r = parseErrataCsv(lines.join("\n"));
    expect(r.rows).toHaveLength(500);
    expect(r.errors.at(-1)?.reason).toContain("500");
  });
});

describe("57 勘误回导：计划", () => {
  it("只收有差异字段；值不变计 unchanged；未定位 qid 单列", () => {
    const r = parseErrataCsv([
      "题目ID,知识点,难度",
      "q-aaaaaaaa,资料分析/增长率,4", // 两处都变
      "q-aaaaaaaa,资料分析/增长率,3", // 同 qid 第二行：行内独立处理，难度不变 kp 变
      "q-bbbbbbbb,数量关系,", // kp 相同 → unchanged
      "q-cccccccc,任意,", // 格式合法但库内不存在 → unknownQids
    ].join("\n"));
    const plan = planErrata(r.rows, EXISTING);
    expect(plan.changes.filter((c) => c.qid === "q-aaaaaaaa" && c.field === "kp")).toHaveLength(2);
    expect(plan.changes.filter((c) => c.field === "difficulty")).toHaveLength(1);
    expect(plan.changes.every((c) => c.blockId === "blk-1" || c.blockId === "blk-2")).toBe(true);
    expect(plan.unchanged).toBe(1); // 仅 q-bbbbbbbb（kp 与现值相同）
    expect(plan.unknownQids).toEqual(["q-cccccccc"]);
  });

  it("模板含当前值与全部题目", () => {
    const csv = errataTemplateCsv(EXISTING);
    const rows = csv.split("\n");
    expect(rows[0]).toBe("题目ID,知识点,难度,来源,年份,分值");
    expect(rows[1]).toContain("q-aaaaaaaa");
    expect(rows[1]).toContain("2023 真题");
    expect(rows).toHaveLength(3);
  });
});
