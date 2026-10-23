import { describe, it, expect } from "vitest";
import type { Question } from "../src/core/types";
import {
  cleanSiyuanDocMarkdown,
  parseQuestionsFromSiyuanDoc,
  parseQuestionsFromSiyuanDocBatch,
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

    it("cleanSiyuanDocMarkdown 兼容引用块前缀、块引用与双链语法", () => {
      const raw = `
> ### 1. ((20261022123456-abcdefg "法的本质与特征"))
> - A. 统治阶级意志的体现
> - B. 全民意志的体现
> 答案：A
> 解析：参见 [[法理学讲义|第一章]]。
      `;
      const cleaned = cleanSiyuanDocMarkdown(raw);
      expect(cleaned).not.toContain(">");
      expect(cleaned).not.toContain("((20261022123456-abcdefg");
      expect(cleaned).toContain("法的本质与特征");
      expect(cleaned).toContain("第一章");
      expect(cleaned).not.toContain("[[法理学讲义|第一章]]");
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

    it("parseQuestionsFromSiyuanDoc 兼容引用块与列表项选择题，并具备幂等哈希一致性", async () => {
      const docMarkdown = `
> 1. 根据物权法律制度的规定，下列各项中，属于独立物权的是（ ）。
> - A. 建设用地使用权
> - B. 地役权
> - C. 抵押权
> - D. 留置权
> 【答案】A
      `;

      const meta = {
        docId: "doc-property-law",
        title: "民法物权精选",
        hpath: "/民法/物权法",
      };

      const report1 = await parseQuestionsFromSiyuanDoc(docMarkdown, meta);
      expect(report1.ok.length).toBe(1);
      const q1 = report1.ok[0];
      expect(q1.options.length).toBe(4);
      expect(q1.answer).toBe("A");

      // 再次提取，生成确定性 hash，保证幂等去重
      const report2 = await parseQuestionsFromSiyuanDoc(docMarkdown, meta, {
        existingHashes: new Set([q1.hash]),
      });
      expect(report2.duplicates).toBe(1);
      expect(report2.ok.length).toBe(0); // 幂等去重，不重复入库
    });

    it("parseQuestionsFromSiyuanDocBatch 并发从多篇文档批量提取试题并合并去重", async () => {
      const doc1 = {
        docId: "doc-ch1",
        title: "第一章 法的本体",
        hpath: "/法理学/第一章",
        markdown: `
1. 法的根本属性是（ ）。
A. 阶级性
B. 社会性
ANSWER: A
        `,
      };
      const doc2 = {
        docId: "doc-ch2",
        title: "第二章 法的运行",
        hpath: "/法理学/第二章",
        markdown: `
1. 法律适用的核心主体是（ ）。
A. 国家司法机关
B. 行政机关
ANSWER: A
        `,
      };

      const batchReport = await parseQuestionsFromSiyuanDocBatch([doc1, doc2]);
      expect(batchReport.ok.length).toBe(2);
      expect(batchReport.ok[0].source).toBe("第一章 法的本体");
      expect(batchReport.ok[1].source).toBe("第二章 法的运行");
      expect(batchReport.ok[0].kp).toBe("法理学");
      expect(batchReport.ok[1].kp).toBe("法理学");
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
      const qWithQuotes: Question = {
        id: 'q-"quote"-test',
        type: "single",
        stem: '测试带引号考点"物权法"',
        options: ["A", "B"],
        answer: "A",
        kp: '民法/"物权法"',
      };
      const docMd = buildSiyuanExamDocMarkdown("2026年考研高数与法理全真模考卷", [...testQuestions, qWithQuotes], {
        durationMinutes: 120,
        passLine: 60,
      });

      expect(docMd).toContain("# 📚 2026年考研高数与法理全真模考卷");
      expect(docMd).toContain('custom-exam-id="q-\\"quote\\"-test"');
      expect(docMd).toContain('custom-exam-kp="民法/\\"物权法\\""');
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
