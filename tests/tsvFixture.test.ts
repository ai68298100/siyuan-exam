import { describe, it, expect } from "vitest";
import { parseTsv } from "../src/importer/tsv";

/** 42-04 真实样例（廿六批）：模拟 Anki「Export as plain text」的真实产物形态 */
describe("TSV 真实导出样例（42-04 fixture，廿六批）", () => {
  it("真实 Anki 基础牌组导出：#separator/#html/#notetype 头 + 两列正文", () => {
    const text = [
      "#separator:tab",
      "#html:true",
      "#notetype:9Basic",
      "#deck:行测::言语",
      "The retention parameter of FSRS\tthe retention (期望保留率)",
      "What does append-only mean?\t数据只追加不修改",
    ].join("\n");
    const r = parseTsv(text);
    expect(r.errors).toHaveLength(0);
    expect(r.ok).toHaveLength(2);
    expect(r.ok[0]).toMatchObject({ type: "fill", answer: "the retention (期望保留率)" });
    expect(r.ok[0].stem).not.toContain("<");
  });

  it("英文表头导出（Excel→CSV 英文模板）：option a-f 列可自动映射", () => {
    const text = [
      "#separator:tab",
      "Type\tStem\tOption A\tOption B\tAnswer\tAnalysis\tKp",
      "single\t2+2=?\t3\t4\tB\tcarry\t算术",
      "single\t天空\t红\t蓝\tA\t\t常识",
    ].join("\n");
    const r = parseTsv(text);
    expect(r.errors).toHaveLength(0);
    expect(r.ok).toHaveLength(2);
    expect(r.ok[0]).toMatchObject({ type: "single", stem: "2+2=?", answer: "B", kp: "算术" });
    expect(r.ok[0].options).toEqual(["3", "4"]);
  });

  it("非法样例：表头行缺选项列 → 明确报错，不猜列", () => {
    const text = "#separator:tab\nType\tStem\tAnswer\nsingle\t1+1\tA";
    const r = parseTsv(text);
    expect(r.ok).toHaveLength(0);
    expect(r.errors[0].reason).toContain("选项A/B");
  });
});
