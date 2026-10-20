import { describe, it, expect } from "vitest";
import {
  createDiagnosisEntry,
  appendDiagnosisToDoc,
  getLatestDiagnosis,
  listDiagnosisHistory,
  removeDiagnosisFromDoc,
  formatDiagnosisShortSummary,
  exportDiagnosisMarkdown,
  fromLegacyReflection,
  EMPTY_DIAGNOSIS_DOC,
  DEFAULT_CHECKLIST_HINTS,
} from "../src/core/selfDiagnosis";

describe("SelfDiagnosis 错题四要素自诊断短模板与反思备忘引擎 (52-04 / 44-07)", () => {
  describe("createDiagnosisEntry (四要素条目构建)", () => {
    it("空 qid 抛出明确错误", () => {
      expect(() => createDiagnosisEntry("", {})).toThrow("qid 不能为空");
      expect(() => createDiagnosisEntry("   ", {})).toThrow("qid 不能为空");
    });

    it("规范生成带有唯一 ID 和四要素的自诊断条目", () => {
      const entry = createDiagnosisEntry(
        "q-101",
        {
          thought: "当时把'不属于'看成了'属于'，直接选了 A",
          rootCause: "careless",
          rationale: "《宪法》第六十二条最高权力机关职权",
          checklist: "圈出设问中的否定词，读完所有选项再选",
        },
        1_700_000_000_000,
      );

      expect(entry.qid).toBe("q-101");
      expect(entry.id.startsWith("diag-")).toBe(true);
      expect(entry.at).toBe(1_700_000_000_000);
      expect(entry.rootCause).toBe("careless");
      expect(entry.thought).toContain("不属于");
      expect(entry.rationale).toContain("宪法");
      expect(entry.checklist).toContain("圈出设问中的否定词");
    });

    it("未提供 checklist 时自动带入对应错因的标准避坑检查点建议", () => {
      const entry = createDiagnosisEntry("q-102", {
        rootCause: "trap",
      });

      expect(entry.rootCause).toBe("trap");
      expect(entry.checklist).toBe(DEFAULT_CHECKLIST_HINTS.trap);
      expect(entry.checklist).toContain("绝对化措辞");
    });
  });

  describe("时间轴追加与历史检索 (appendDiagnosisToDoc / getLatestDiagnosis)", () => {
    it("多次同一题错题追加，正确构建版本化时间轴且始终获取最新一条", () => {
      let doc = EMPTY_DIAGNOSIS_DOC;

      const e1 = createDiagnosisEntry("q-201", {
        thought: "第一次错：完全没学过",
        rootCause: "unknown",
      }, 1000);

      const e2 = createDiagnosisEntry("q-201", {
        thought: "第二次错：公式字母记串了",
        rootCause: "concept",
      }, 2000);

      doc = appendDiagnosisToDoc(doc, e1);
      doc = appendDiagnosisToDoc(doc, e2);

      // 验证历史记录数
      const history = listDiagnosisHistory(doc, "q-201");
      expect(history).toHaveLength(2);
      expect(history[0].thought).toContain("第一次错");
      expect(history[1].thought).toContain("第二次错");

      // 验证最新一条始终为 e2
      const latest = getLatestDiagnosis(doc, "q-201");
      expect(latest?.id).toBe(e2.id);
      expect(latest?.rootCause).toBe("concept");
    });

    it("单题历史记录超过上限时自动截断老记录，保护本地存储", () => {
      let doc = EMPTY_DIAGNOSIS_DOC;
      for (let i = 0; i < 15; i++) {
        const e = createDiagnosisEntry("q-overflow", { thought: `第 ${i + 1} 次复盘` }, i * 1000);
        doc = appendDiagnosisToDoc(doc, e, 5); // 上限 5 条
      }

      const history = listDiagnosisHistory(doc, "q-overflow");
      expect(history).toHaveLength(5);
      expect(history[0].thought).toBe("第 11 次复盘");
      expect(history[4].thought).toBe("第 15 次复盘");
    });

    it("removeDiagnosisFromDoc 能够安全清除指定题目的诊断记录", () => {
      const e = createDiagnosisEntry("q-del", { thought: "待删除" });
      let doc = appendDiagnosisToDoc(EMPTY_DIAGNOSIS_DOC, e);
      expect(getLatestDiagnosis(doc, "q-del")).not.toBeNull();

      doc = removeDiagnosisFromDoc(doc, "q-del");
      expect(getLatestDiagnosis(doc, "q-del")).toBeNull();
    });
  });

  describe("formatDiagnosisShortSummary 一行复盘摘要", () => {
    it("简洁组合错因、误判与检查点", () => {
      const entry = createDiagnosisEntry("q-301", {
        rootCause: "calculation",
        thought: "第三步乘法进位算错成 48",
        checklist: "草稿纸按步骤分行写",
      });

      const summary = formatDiagnosisShortSummary(entry);
      expect(summary).toContain("错因: 运算失误/步骤跳跃");
      expect(summary).toContain("误判: 第三步乘法进位算错成 48");
      expect(summary).toContain("检查点: 草稿纸按步骤分行写");
    });
  });

  describe("exportDiagnosisMarkdown Markdown 格式化与敏感答案隔离", () => {
    it("导出排版规范的 Markdown Callout 引用块，且绝对不包含题目答案", () => {
      const entry = createDiagnosisEntry("q-401", {
        rootCause: "time_pressure",
        thought: "最后 10 秒倒计时慌张盲选",
        rationale: "时间管理与选项排除法",
        checklist: "设定 90 秒止损点",
      }, new Date("2026-10-20").getTime());

      const md = exportDiagnosisMarkdown(entry, { dateString: "2026-10-20" });

      expect(md).toContain("【个人错题自诊断复盘】");
      expect(md).toContain("记录于 2026-10-20");
      expect(md).toContain("错因归类**：`时间紧迫/仓促选错`");
      expect(md).toContain("当时怎么想**：最后 10 秒倒计时慌张盲选");
      expect(md).toContain("依据出处**：时间管理与选项排除法");
      expect(md).toContain("下次检查点**：👉 *设定 90 秒止损点");

      // 安全红线：个人自诊断不含标准答案
      expect(md).not.toContain("标准答案");
      expect(md).not.toContain("正确答案");
    });
  });

  describe("fromLegacyReflection 旧格式反思平滑迁移", () => {
    it("将旧版纯文本反思无缝转换为四要素自诊断条目，并智能推断错因", () => {
      const legacy = {
        text: "这道题审题太粗心了，没看到'不正确的是'",
        at: 1_690_000_000_000,
      };

      const entry = fromLegacyReflection("q-legacy", legacy);

      expect(entry.qid).toBe("q-legacy");
      expect(entry.at).toBe(1_690_000_000_000);
      expect(entry.rootCause).toBe("careless"); // 智能识别粗心
      expect(entry.thought).toBe(legacy.text);
      expect(entry.checklist).toContain("圈出题干关键限定词");
    });
  });
});
