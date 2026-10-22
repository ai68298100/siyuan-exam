import { describe, it, expect } from "vitest";
import type { Question } from "../src/core/types";
import {
  cleanSiyuanDocMarkdown,
  parseQuestionsFromSiyuanDoc,
} from "../src/core/siyuanDocImporter";
import {
  buildSiyuanExamDocMarkdown,
  buildSiyuanWrongbookDocMarkdown,
} from "../src/core/siyuanSyncDoc";

describe("思源原生文档导入与题库文档同步引擎 (siyuanNativeDoc)", () => {
  describe("1. 思源文档导入清洗与题目提取 (siyuanDocImporter)", () => {
    it("cleanSiyuanDocMarkdown 清洗 IAL 块属性与折叠块标记", () => {
      const raw = `
# 宪法学核心考点
{: id="20261022-doc1" updated="20261022"}

1. 中华人民共和国的根本制度是（ ）
A. 人民代表大会制度
B. 社会主义制度
C. 多党合作制
D. 民族区域自治制度
ANSWER: B
{: id="20261022-q1"}

::: details 答案与解析
【解析】宪法第一条明确规定社会主义制度是根本制度。
:::
{: id="20261022-fold1"}
      `;

      const cleaned = cleanSiyuanDocMarkdown(raw);
      expect(cleaned).not.toContain('{: id="20261022-doc1"');
      expect(cleaned).not.toContain("::: details");
      expect(cleaned).toContain("ANSWER: B");
      expect(cleaned).toContain("宪法第一条明确规定");
    });

    it("parseQuestionsFromSiyuanDoc 成功提取思源文档试题并注入来源与考点元数据", async () => {
      const docMarkdown = `
1. 我国宪法的修改由全国人民代表大会以全体代表的（ ）以上的多数通过。
A. 二分之一
B. 三分之二
C. 四分之三
D. 五分之四
ANSWER: B
      `;

      const report = await parseQuestionsFromSiyuanDoc(docMarkdown, {
        docId: "20261022-doc-const",
        title: "2026年法考宪法精讲讲义",
        hpath: "/法律职业资格考试/宪法学/精讲讲义",
      });

      expect(report.ok.length).toBe(1);
      const q = report.ok[0];
      expect(q.answer).toBe("B");
      expect(q.source).toBe("2026年法考宪法精讲讲义");
      expect(q.sourceKind).toBe("real");
      expect(q.kp).toContain("法律职业资格考试/宪法学");
    });
  });

  describe("2. 题库与试卷同步为思源笔记原生文档 (siyuanSyncDoc)", () => {
    const testQuestions: Question[] = [
      {
        id: "q-sync-1",
        type: "single",
        stem: "平面向量的正交分解是指什么？",
        options: ["将向量沿两个互相垂直的方向分解", "将向量沿任意方向分解", "求向量的模长", "反向延长向量"],
        answer: "A",
        kp: "高等数学/平面向量",
        difficulty: 2,
        analysis: "正交是指垂直，正交分解即在互相垂直的直角坐标轴上投影分解。",
        score: 3,
      },
      {
        id: "q-sync-2",
        type: "short",
        stem: "简述全面推进依法治国的总目标。",
        options: [],
        answer: "建设中国特色社会主义法治体系，建设社会主义法治国家。",
        kp: "法理学/依法治国",
        difficulty: 4,
        score: 10,
        rubric: {
          v: 1,
          kind: "rubric",
          fullScore: 10,
          criteria: [
            { id: "c1", label: "法治体系要点", weight: 0.5 },
            { id: "c2", label: "法治国家要点", weight: 0.5 },
          ],
        },
      },
    ];

    it("buildSiyuanExamDocMarkdown 排版生成带折叠块答案与思源块属性的原生文档", () => {
      const docMd = buildSiyuanExamDocMarkdown("2026年考研高数与法理全真模考卷", testQuestions, {
        durationMinutes: 120,
        passLine: 60,
      });

      expect(docMd).toContain("# 📚 2026年考研高数与法理全真模考卷");
      expect(docMd).toContain("⏱️ 建议限时：**120 分钟**");
      expect(docMd).toContain("## 一、单项选择题");
      expect(docMd).toContain("## 二、简答论述题");
      // 答案折叠块
      expect(docMd).toContain("<details>");
      expect(docMd).toContain("参考答案与核心解析点拨（点击展开）");
      expect(docMd).toContain("`A`");
      expect(docMd).toContain("主观采分点细则");
      expect(docMd).toContain("</details>");
      // 思源块属性
      expect(docMd).toContain('{: custom-exam-id="q-sync-1"');
      expect(docMd).toContain('custom-exam-id="q-sync-2"');
    });

    it("buildSiyuanWrongbookDocMarkdown 生成错题攻坚复盘文档", () => {
      const docMd = buildSiyuanWrongbookDocMarkdown("民法题库", [testQuestions[0]]);
      expect(docMd).toContain("民法题库 · 错题攻坚复盘手册");
      expect(docMd).toContain("<details>");
      expect(docMd).toContain("平面向量的正交分解是指什么？");
    });
  });
});
