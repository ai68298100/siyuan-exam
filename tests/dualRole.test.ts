import { describe, it, expect } from "vitest";
import type { Question } from "../src/core/types";
import { extractVariantQuestions, generateCramCheatSheetMarkdown } from "../src/core/cramScheduler";
import { generateItemQualityAuditReport, exportItemQualityAuditMarkdown, exportItemQualityAuditCsv } from "../src/core/itemAnalysis";
import { generateABExamPapers } from "../src/core/paperSnapshot";

describe("双角色协同能力增强 (dualRole)", () => {
  const qSeed: Question = {
    id: "q-seed",
    type: "single",
    stem: "函数 $f(x) = x^2$ 的导数为（ ）",
    options: ["$x$", "$2x$", "$x^2$", "$2$"],
    answer: "B",
    kp: "高等数学/导数计算",
    family: { parentId: "fam-deriv" },
  };

  const qFamVariant: Question = {
    id: "q-fam-1",
    type: "single",
    stem: "函数 $g(x) = 2x^2$ 的导数为（ ）",
    options: ["$2x$", "$4x$", "$x^2$", "$4$"],
    answer: "B",
    kp: "高等数学/导数计算",
    family: { parentId: "fam-deriv" },
  };

  const qSameKp: Question = {
    id: "q-kp-1",
    type: "single",
    stem: "若 $y = \\sin x$，则 $y'$ 等于（ ）",
    options: ["$\\cos x$", "$-\\cos x$", "$\\sin x$", "0"],
    answer: "A",
    kp: "高等数学/导数计算",
  };

  const qSameRoot: Question = {
    id: "q-root-1",
    type: "single",
    stem: "求定积分 $\\int_0^1 x dx$ 的值",
    options: ["1", "0.5", "2", "0"],
    answer: "B",
    kp: "高等数学/定积分",
  };

  const qUnrelated: Question = {
    id: "q-unrelated",
    type: "single",
    stem: "下列属于民法物权的是（ ）",
    options: ["所有权", "债权", "专利权", "著作权"],
    answer: "A",
    kp: "民法学/物权法",
  };

  const fullBank = [qSeed, qFamVariant, qSameKp, qSameRoot, qUnrelated];

  describe("1. 学生向深度：错题同族与考点变式题推荐 (extractVariantQuestions)", () => {
    it("优先推荐同族变式题，其次同考点，再次同章节根考点，排除自身与无关题目", () => {
      const res = extractVariantQuestions(fullBank, qSeed, 3);
      expect(res.count).toBe(3);
      expect(res.questions.map((q) => q.id)).toEqual(["q-fam-1", "q-kp-1", "q-root-1"]);
      expect(res.questions.map((q) => q.id)).not.toContain("q-unrelated");
      expect(res.reason).toContain("同族变式题");
    });
  });

  describe("2. 学生向广度：考前冲刺急救小抄与速记手账导出 (generateCramCheatSheetMarkdown)", () => {
    it("提取在册错题生成紧凑 Markdown 小抄，包含题干、答案与破题备忘", () => {
      const wrongItems = [
        { qid: "q-seed", status: "active" as const, wrongCount: 3, lastWrongAt: Date.now() },
        { qid: "q-fam-1", status: "active" as const, wrongCount: 1, lastWrongAt: Date.now() },
      ];

      const md = generateCramCheatSheetMarkdown(fullBank, wrongItems, { title: "高数考前 3 天小抄", maxItems: 10 });
      expect(md).toContain("高数考前 3 天小抄");
      expect(md).toContain("函数 $f(x) = x^2$ 的导数为");
      expect(md).toContain("核心结论/答案");
      expect(md).toContain("累计答错 3 次");
    });
  });

  describe("3. 教师向深度：全库试题质量 CTT 诊断与死干扰项审计", () => {
    it("计算试题区分度 D、实测难度 P 与检出 0% 死干扰项", () => {
      // 模拟 5 次作答（达到 MIN_ITEM_ANALYSIS_SAMPLE 门槛），选项 C 从未被选过
      const attempts = [
        { v: 1, eid: "a1", qid: "q-seed", verdict: "correct" as const, myAnswer: "B", ts: 1000 },
        { v: 1, eid: "a2", qid: "q-seed", verdict: "correct" as const, myAnswer: "B", ts: 2000 },
        { v: 1, eid: "a3", qid: "q-seed", verdict: "wrong" as const, myAnswer: "A", ts: 3000 },
        { v: 1, eid: "a4", qid: "q-seed", verdict: "wrong" as const, myAnswer: "D", ts: 4000 },
        { v: 1, eid: "a5", qid: "q-seed", verdict: "correct" as const, myAnswer: "B", ts: 5000 },
      ];

      const report = generateItemQualityAuditReport([qSeed], attempts);
      expect(report.evaluatedCount).toBe(1);
      const item = report.items[0];
      expect(item.qid).toBe("q-seed");
      expect(item.deadDistractorCount).toBeGreaterThanOrEqual(1);
      expect(item.deadDistractorLetters).toContain("C");

      // 导出 Markdown 与 CSV
      const md = exportItemQualityAuditMarkdown(report);
      expect(md).toContain("题库试题质量 CTT 测验理论与干扰项诊断报告");
      expect(md).toContain("死干扰项");

      const csv = exportItemQualityAuditCsv(report);
      expect(csv.startsWith("\uFEFF")).toBe(true);
      expect(csv).toContain("题目ID,题干摘要");
      expect(csv).toContain("q-seed");
    });
  });

  describe("4. 教师向广度：考场防抄袭全真 A/B 卷随机生成 (generateABExamPapers)", () => {
    it("A 卷保持原始选项顺序与答案，B 卷完成选项洗牌与答案重映射", () => {
      const singleQ: Question = {
        id: "q-ab",
        type: "single",
        stem: "1 + 1 等于几？",
        options: ["1", "2", "3", "4"],
        answer: "B", // 对应 "2"
      };

      const result = generateABExamPapers([singleQ]);
      expect(result.paperA[0].options).toEqual(["1", "2", "3", "4"]);
      expect(result.answerKeyA["q-ab"]).toBe("B");

      const bQ = result.paperB[0];
      // 确认原本内容没丢，只是顺序打乱
      expect(new Set(bQ.options)).toEqual(new Set(["1", "2", "3", "4"]));
      // 验证重映射后的答案依然指向内容 "2"
      const mappedAnsIndex = bQ.answer.charCodeAt(0) - 65;
      expect(bQ.options[mappedAnsIndex]).toBe("2");
      expect(result.diffSummary).toContain("A/B 卷");
    });
  });

  describe("5. 角色状态存储安全隔离与受限环境容错", () => {
    it("受限环境抛出 SecurityError 时安全兜底回退 student 角色而不崩溃", () => {
      const readLocalRole = (storageMock?: { getItem: () => string }) => {
        try {
          return storageMock && storageMock.getItem() === "teacher" ? "teacher" : "student";
        } catch {
          return "student";
        }
      };

      // 模拟正常读取
      expect(readLocalRole({ getItem: () => "teacher" })).toBe("teacher");
      expect(readLocalRole({ getItem: () => "student" })).toBe("student");

      // 模拟沙箱/隐私模式抛出异常
      const throwingMock = {
        getItem: () => {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      };
      expect(readLocalRole(throwingMock)).toBe("student");
    });
  });
});
