import { describe, it, expect } from "vitest";
import { parseAiken, parseExcelRows, autoMapExcel, validate, parseType } from "../src/importer/pipeline";
import { questionToMarkdown, questionFromBlock, parseIal, makeQuestion } from "../src/core/blockTemplate";

const AIKEN = `// 注释行应被忽略
思源笔记的内核是什么？
KP: 基础/架构
A. Electron + Node.js
B. Go
C. Rust
ANSWER: B

2+2 等于几?
A. 3
B. 4
ANSWER: B

残缺题：没有答案行
A. 甲
B. 乙`;

describe("Aiken 解析", () => {
  it("三道题：2 成功 1 失败，失败含行号与原因", () => {
    const r = parseAiken(AIKEN);
    expect(r.ok).toHaveLength(2);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].reason).toContain("ANSWER");
    expect(r.errors[0].row).toBeGreaterThan(0);
    expect(r.ok[0].kp).toBe("基础/架构");
    expect(r.ok[0].answer).toBe("B");
    expect(r.ok[0].options).toEqual(["Electron + Node.js", "Go", "Rust"]);
  });
  it("批内去重与外部 hash 去重", () => {
    const r1 = parseAiken(AIKEN);
    expect(r1.ok).toHaveLength(2);
    const hashes = new Set(r1.ok.map((q) => q.hash));
    const r2 = parseAiken(AIKEN, { existingHashes: hashes });
    expect(r2.ok).toHaveLength(0);   // 两道成功题全部撞重（残缺题本就失败）
    expect(r2.duplicates).toBe(2);
  });
  it("answer 越界报错", () => {
    const r = parseAiken("Q?\nA. 1\nB. 2\nANSWER: D");
    expect(r.ok).toHaveLength(0);
    expect(r.errors[0].reason).toContain("超出选项范围");
  });
  it("共用题干：材料行开启组，子题自动携带组 ID 与材料考点", () => {
    const rows = [
      ["1", "材料", "患者男，35 岁，发热咳嗽……", "", "", "", "", "", "病例分析", "", "呼吸内科"],
      ["2", "单选", "最可能诊断？", "肺炎", "肺癌", "", "", "A", "略", "", ""],
      ["3", "判断", "应抗感染治疗？", "", "", "", "", "对", "", "", ""],
      ["4", "单选", "独立题", "1", "2", "", "", "A", "", "", "算术"],
    ];
    const map = { type: 1, stem: 2, answer: 7, options: [3, 4, 5, 6], analysis: 8, kp: 10 };
    const r = parseExcelRows(rows, map);
    expect(r.ok).toHaveLength(4);
    const mat = r.ok.find((q) => q.type === "material")!;
    const subs = r.ok.filter((q) => q.type !== "material");
    expect(mat.group).toMatch(/^g-[0-9a-f]{6}$/);
    for (const s of subs.slice(0, 2)) {
      expect(s.group).toBe(mat.group);        // 子题携带组 ID
      expect(s.kp).toBe("呼吸内科");           // 沿用材料考点
    }
    expect(subs[2].group).toBeUndefined();     // 独立题不在组内
    expect(subs[2].kp).toBe("算术");
  });
});

describe("Excel 解析", () => {
  const header = ["题号", "题型", "题干", "选项A", "选项B", "选项C", "选项D", "答案", "解析", "难度", "知识点"];
  const auto = autoMapExcel(header);
  it("自动列映射", () => {
    expect(auto.missing).toEqual([]);
    expect(auto.map.stem).toBe(2);
    expect(auto.map.options).toHaveLength(4);
    expect(auto.map.kp).toBe(10);
  });
  it("行解析：判分方言 + 难度钳制 + 坏行清单", () => {
    const rows = [
      ["1", "单选", "1+1=?", "1", "2", "3", "", "B", "略", "9", "算术"],
      ["2", "判断", "1>2?", "", "", "", "", "×", "", "", "比较"],
      ["3", "单选", "坏题", "只有一项", "", "", "", "A", "", "", ""],
      ["4", "单选", "答案越界", "1", "2", "", "", "E", "", "", ""],
    ];
    const r = parseExcelRows(rows, auto.map, { kp: "兜底" });
    expect(r.ok).toHaveLength(2);
    expect(r.errors).toHaveLength(2);
    expect(r.errors.map((e) => e.row).sort()).toEqual([4, 5]); // 数据行 = 数组下标 + 2（首行表头）
    const judgeQ = r.ok.find((q) => q.type === "judge");
    expect(judgeQ?.answer).toBe("错");
    expect(r.ok[0].difficulty).toBe(5); // 钳制到 1-5
  });
  it("多选答案连写 ABD", () => {
    const rows = [["1", "多选", "选偶数", "1", "2", "3", "4", "abd", "", "", ""]];
    const r = parseExcelRows(rows, auto.map);
    expect(r.ok[0].answer).toBe("ABD");
  });
});

describe("块模板往返", () => {
  it("markdown → IAL → 解析一致", () => {
    const q = makeQuestion({
      type: "single", stem: "题干\"带引号\"", options: ["甲", "乙"], answer: "A",
      analysis: "解析", kp: "资料/比重", source: "2023 国考", difficulty: 3,
    });
    const md = questionToMarkdown(q);
    expect(md).toContain("{{{row");
    expect(md).toContain('- A. 甲');
    const ial = parseIal(md.split("{: ")[1]!.replace(/}$/, "").trim());
    expect(ial["exam-id"]).toBe(q.id);
    expect(ial["exam-answer"]).toBe("A");
    const back = questionFromBlock({
      attrs: Object.fromEntries(Object.entries(ial).map(([k, v]) => [`custom-${k}`, v])),
      text: `题干"带引号"\n- A. 甲\n- B. 乙`,
    });
    expect(back).not.toBeNull();
    expect(back!.id).toBe(q.id);
    expect(back!.options).toEqual(["甲", "乙"]);
    expect(back!.hash).toBe(q.hash);
  });
  it("非法属性缺 exam-id → null", () => {
    expect(questionFromBlock({ attrs: {}, text: "x" })).toBeNull();
  });
  it("validate 兜底", () => {
    const bad = makeQuestion({ type: "single", stem: "", options: ["1"], answer: "A" });
    expect(validate(bad)).not.toBeNull();
  });
  it("parseType 别名", () => {
    expect(parseType(" 单选题 ")).toBe("single");
    expect(parseType("TrueFalse")).toBe("judge");
    expect(parseType("论述")).toBe("short");
    expect(parseType("名词解释")).toBeNull();
  });
});
