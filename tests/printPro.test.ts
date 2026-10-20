import { describe, it, expect } from "vitest";
import type { Question } from "../src/core/types";
import {
  buildPrintProCss,
  buildCompactQuestionSheetPro,
  buildCompactAnswerSheetPro,
  auditQuestionSheetSafety,
} from "../src/core/printPro";

function mkQ(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    type: "single",
    stem: `题干 ${id}`,
    options: ["选项甲", "选项乙", "选项丙", "选项丁"],
    answer: "B",
    analysis: `这是 ${id} 的详细解析说明内容`,
    score: 2,
    origin: "manual",
    hash: `h-${id}`,
    ...overrides,
  };
}

describe("PrintPro A4 双栏紧凑打印与分页防断引擎 (68-04 / 79-02)", () => {
  describe("buildPrintProCss (分栏与纸张规范)", () => {
    it("默认输出 A4 双栏紧凑 CSS，含分栏与页面尺寸规则", () => {
      const css = buildPrintProCss();
      expect(css).toContain("size: A4 portrait");
      expect(css).toContain("column-count: 2");
      expect(css).toContain("@page");
      expect(css).toContain("counter(page)");
    });

    it("可切换 Letter 纸张与单栏布局", () => {
      const css = buildPrintProCss({ paperSize: "Letter", columns: "single" });
      expect(css).toContain("size: Letter portrait");
      expect(css).toContain("column-count: 1");
      expect(css).not.toContain("column-count: 2");
    });

    it("包含材料卡片不分页与分栏断裂保护规则", () => {
      const css = buildPrintProCss();
      expect(css).toContain(".material-block");
      expect(css).toContain("page-break-inside: avoid");
      expect(css).toContain("break-inside: avoid");
      expect(css).toContain("page-break-after: avoid");
    });
  });

  describe("buildCompactQuestionSheetPro (作答卷安全红线)", () => {
    it("生成完整作答卷 HTML，含页眉页脚、题型与选项，绝不含答案与解析", () => {
      const qs = [mkQ("q1"), mkQ("q2", { type: "fill", options: [], answer: "氧气" })];
      const html = buildCompactQuestionSheetPro("模拟测试卷", qs, { paperNo: "P-2026-01", showScore: true });

      expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
      expect(html).toContain("模拟测试卷");
      expect(html).toContain("试卷编号 P-2026-01");
      expect(html).toContain("A. 选项甲");
      expect(html).toContain("2 分");
      expect(html).toContain("answer-area");
      // 安全红线
      expect(html).not.toContain("这是 q1 的详细解析说明内容");
      // 审计
      const audit = auditQuestionSheetSafety(html, qs);
      expect(audit.safe).toBe(true);
    });

    it("材料题组只打印一次材料卡片，子题不重复且材料属题面", () => {
      const material: Question = {
        ...mkQ("m1", { type: "material", options: [], answer: "", stem: "材料母块" }),
        group: "grp-1",
        analysis: "这是一段很长很长的共用阅读理解材料正文内容。",
      };
      const sub1 = mkQ("s1", { group: "grp-1" });
      const sub2 = mkQ("s2", { group: "grp-1" });

      const html = buildCompactQuestionSheetPro("材料组卷", [material, sub1, sub2]);
      const occurrences = (html.match(/这是一段很长很长的共用阅读理解材料正文内容。/g) || []).length;
      expect(occurrences).toBe(1);
      expect(html).toContain("material-block");
    });

    it("XSS 注入被严格转义", () => {
      const q = mkQ("xss", { stem: `<script>alert("x")</script>` });
      const html = buildCompactQuestionSheetPro("注入卷", [q]);
      expect(html).not.toContain("<script>alert");
      expect(html).toContain("&lt;script&gt;");
    });

    it("安全审计能检出泄漏答案的非法卷面", () => {
      const qs = [mkQ("leak", { answer: "正确答案文本" })];
      const html = `<html><body><div>正确答案文本</div></body></html>`;
      const audit = auditQuestionSheetSafety(html, qs);
      expect(audit.safe).toBe(false);
      expect(audit.violations[0]).toContain("leak");
    });
  });

  describe("buildCompactAnswerSheetPro (详解答案册)", () => {
    it("答案册包含标准答案、考点与采分点，材料题跳过编号", () => {
      const material: Question = {
        ...mkQ("m1", { type: "material", options: [], answer: "", analysis: "材料" }),
        group: "g1",
      };
      const sub = mkQ("s1", { group: "g1", kp: "言语/主旨" });
      const shortQ = mkQ("short1", {
        type: "short",
        options: [],
        answer: "参考答案要点",
        rubric: {
          v: 1,
          kind: "rubric",
          fullScore: 10,
          criteria: [
            { id: "c1", label: "观点明确", weight: 0.6 },
            { id: "c2", label: "论证充分", weight: 0.4 },
          ],
        },
      });

      const html = buildCompactAnswerSheetPro("答案册测试", [material, sub, shortQ]);
      expect(html).toContain("答案册");
      expect(html).toContain("言语/主旨");
      expect(html).toContain("采分点：观点明确(60%) · 论证充分(40%)");
      expect(html).toContain("参考答案要点");
      // 材料题不占用题号：第一道真实题编号应为 1
      expect(html).toContain(`1. <strong>B</strong>`);
    });
  });
});
