import { describe, it, expect } from "vitest";
import type { Question } from "../src/core/types";
import type { SyllabusNode, SyllabusDoc } from "../src/core/syllabus";
import type { Blueprint } from "../src/core/mock";
import {
  diffSyllabusTrees,
  assessSyllabusImpact,
  generateMigrationPlan,
  exportSyllabusDiffMarkdown,
} from "../src/core/syllabusDiff";

function mkNode(title: string, children: SyllabusNode[] = [], kpPrefix = ""): SyllabusNode {
  return {
    id: `node-${title}`,
    title,
    kpPrefix: kpPrefix || title,
    children,
  };
}

function mkQ(id: string, kp: string): Question {
  return {
    id,
    type: "single",
    stem: `题目 ${id} 题干内容`,
    options: ["A", "B"],
    answer: "A",
    score: 1,
    origin: "manual",
    hash: `h-${id}`,
    kp,
  };
}

describe("SyllabusDiff 考纲换版差异比对与影响评估引擎 (51-07 / 51-01)", () => {
  const oldTree: SyllabusNode[] = [
    mkNode("政治理论", [
      mkNode("马克思主义哲学", [
        mkNode("唯物论"),
        mkNode("唯物辩证法"),
      ]),
      mkNode("毛泽东思想"),
    ]),
    mkNode("法律基础", [
      mkNode("宪法"),
      mkNode("民法典旧篇"), // 新版将被删除
    ]),
  ];

  const newTree: SyllabusNode[] = [
    mkNode("政治理论", [
      mkNode("马克思主义哲学", [
        mkNode("唯物论"), // 保留
        // 唯物辩证法被移动到新分类下
      ]),
      mkNode("哲学核心专题", [
        mkNode("唯物辩证法"), // 路径变更: 政治理论/马克思主义哲学/唯物辩证法 -> 政治理论/哲学核心专题/唯物辩证法
      ]),
      mkNode("习近平新时代中国特色社会主义思想"), // 新增
      mkNode("毛泽东思想"), // 保留
    ]),
    mkNode("法律法规", [ // 顶层更名
      mkNode("宪法"), // 移动
      mkNode("民法典新通则"), // 新增
    ]),
  ];

  describe("diffSyllabusTrees (树形差异计算)", () => {
    it("准确识别保留、移动、新增与删除节点数量与路径变化", () => {
      const diff = diffSyllabusTrees(oldTree, newTree);

      expect(diff.retainedCount).toBeGreaterThanOrEqual(3); // 政治理论、唯物论、毛泽东思想等
      expect(diff.addedCount).toBeGreaterThanOrEqual(3); // 哲学核心专题、新思想、法律法规、民法典新通则等
      expect(diff.removedCount).toBeGreaterThanOrEqual(2); // 法律基础、民法典旧篇
      expect(diff.movedCount).toBeGreaterThanOrEqual(1); // 唯物辩证法、宪法等

      const movedDialectic = diff.diffItems.find((it) => it.title === "唯物辩证法");
      expect(movedDialectic?.kind).toBe("moved");
      expect(movedDialectic?.oldPath).toBe("政治理论/马克思主义哲学/唯物辩证法");
      expect(movedDialectic?.newPath).toBe("政治理论/哲学核心专题/唯物辩证法");

      const removedOldCivil = diff.diffItems.find((it) => it.title === "民法典旧篇");
      expect(removedOldCivil?.kind).toBe("removed");

      const addedNewEra = diff.diffItems.find((it) => it.title === "习近平新时代中国特色社会主义思想");
      expect(addedNewEra?.kind).toBe("added");
    });

    it("支持直接传入包含 meta 的 SyllabusDoc 对象", () => {
      const oldDoc: SyllabusDoc = { v: 1, meta: { year: "2024" }, roots: oldTree, importedAt: 1 };
      const newDoc: SyllabusDoc = { v: 1, meta: { year: "2025" }, roots: newTree, importedAt: 2 };

      const diff = diffSyllabusTrees(oldDoc, newDoc);
      expect(diff.oldMeta.year).toBe("2024");
      expect(diff.newMeta.year).toBe("2025");
      expect(diff.retainedCount).toBeGreaterThan(0);
    });
  });

  describe("assessSyllabusImpact (影响面深度评估)", () => {
    it("准确检出受删除或平移影响的题目，并给出目标考点建议", () => {
      const diff = diffSyllabusTrees(oldTree, newTree);

      const q1 = mkQ("q1", "唯物辩证法/对立统一"); // 考点前缀命中移动节点
      const q2 = mkQ("q2", "民法典旧篇/总则"); // 考点前缀命中已删除节点
      const q3 = mkQ("q3", "唯物论/物质意识"); // 考点命中保留节点（不受影响）

      const bp: Blueprint = {
        id: "bp-1",
        name: "综合模考",
        durationS: 7200,
        passLine: 60,
        shuffleOptions: false,
        sectionTimed: false,
        sections: [
          { name: "辩证法专项", count: 5, scoreEach: 1, source: "mixed", types: ["single"], kp: "唯物辩证法" },
          { name: "民法专项", count: 5, scoreEach: 1, source: "mixed", types: ["single"], kp: "民法典旧篇" },
        ],
      };

      const impact = assessSyllabusImpact({
        diff,
        questions: [q1, q2, q3],
        blueprints: [bp],
      });

      // 题目受影响断言
      expect(impact.affectedQuestions).toHaveLength(2);

      const affQ1 = impact.affectedQuestions.find((q) => q.qid === "q1");
      expect(affQ1?.impactReason).toBe("moved");
      expect(affQ1?.targetNewKp).toBe("唯物辩证法/对立统一");

      const affQ2 = impact.affectedQuestions.find((q) => q.qid === "q2");
      expect(affQ2?.impactReason).toBe("removed");

      // 蓝图受影响断言
      expect(impact.affectedBlueprints).toHaveLength(2);
      expect(impact.affectedBlueprints.some((b) => b.sectionKp === "民法典旧篇" && b.impactReason === "removed")).toBe(true);

      // 新版未覆盖考点
      expect(impact.unmappedNewNodes.some((u) => u.title.includes("习近平新时代"))).toBe(true);
      expect(impact.receipt).toContain("考纲换版影响评估完成");
    });
  });

  describe("generateMigrationPlan (迁移向导计划生成)", () => {
    it("对平移节点生成 remap_to_new 动作，对废除节点默认 keep_old", () => {
      const diff = diffSyllabusTrees(oldTree, newTree);
      const q1 = mkQ("q1", "唯物辩证法");
      const q2 = mkQ("q2", "民法典旧篇");

      const impact = assessSyllabusImpact({ diff, questions: [q1, q2] });
      const plan = generateMigrationPlan(impact, { defaultForMoved: "remap_to_new", defaultForRemoved: "keep_old" });

      expect(plan.planId.startsWith("mig-")).toBe(true);
      expect(plan.totalItems).toBe(2);
      expect(plan.remapCount).toBe(1);
      expect(plan.keepCount).toBe(1);

      const p1 = plan.items.find((it) => it.qid === "q1");
      expect(p1?.action).toBe("remap_to_new");

      const p2 = plan.items.find((it) => it.qid === "q2");
      expect(p2?.action).toBe("keep_old");
    });
  });

  describe("exportSyllabusDiffMarkdown (Markdown 报告生成)", () => {
    it("输出表格完备的大纲换版评估 Markdown", () => {
      const diff = diffSyllabusTrees(oldTree, newTree);
      const impact = assessSyllabusImpact({ diff, questions: [mkQ("q1", "唯物辩证法")] });

      const md = exportSyllabusDiffMarkdown(impact);
      expect(md).toContain("# 考纲大纲换版影响评估报告");
      expect(md).toContain("考纲节点层级变动");
      expect(md).toContain("唯物辩证法");
      expect(md).toContain("题库题目受影响明细");
      expect(md).toContain("新版考纲缺题待补节点");
    });
  });
});
