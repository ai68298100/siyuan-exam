import { describe, it, expect } from "vitest";
import { extractAikenBlockAt, extractTextRowAt, parseText, parseAiken } from "../src/importer/pipeline";

const TEXT = [
  "第一题题干",
  "A. 甲",
  "B. 乙",
  "ANSWER: A",
  "",
  "第二题题干",
  "A. 丙",
  "B. 丁",
  "ANSWER: B",
].join("\n");

describe("Aiken 块提取（文本路径单行修复，廿八批）", () => {
  it("按行号提取所在题块；口径与 parseAiken 错误行一致", () => {
    expect(extractAikenBlockAt(TEXT, 1)).toBe("第一题题干\nA. 甲\nB. 乙\nANSWER: A");
    expect(extractAikenBlockAt(TEXT, 4)).toBe("第一题题干\nA. 甲\nB. 乙\nANSWER: A");
    expect(extractAikenBlockAt(TEXT, 6)).toBe("第二题题干\nA. 丙\nB. 丁\nANSWER: B");
  });

  it("空行/越界/空文本：返回 null", () => {
    expect(extractAikenBlockAt(TEXT, 5)).toBeNull(); // 空行
    expect(extractAikenBlockAt(TEXT, 99)).toBeNull();
    expect(extractAikenBlockAt("", 1)).toBeNull();
  });

  it("修复闭环：坏块提取 → 修正 ANSWER 行 → parseText 重验通过", async () => {
    const bad = "题干\nA. 甲\nB. 乙\nANSWER: Z"; // Z 非法 → 错误行 1
    const report = parseAiken(bad);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].row).toBe(1);
    const blk = extractAikenBlockAt(bad, report.errors[0].row)!;
    const fixed = await parseText(blk.replace("ANSWER: Z", "ANSWER: B"));
    expect(fixed.ok).toHaveLength(1);
    expect(fixed.errors).toHaveLength(0);
  });

  it("extractTextRowAt：GIFT 块序口径与 Aiken 行号口径互不串（兜底审计发现）", async () => {
    // GIFT：第 2 块缺答案区 → 错误 row=2（块序）；Aiken 行号 2 处于第 1 块内部
    const giftBad = "::甲:: 1+1=? {=2/~3}\n\n::乙:: 无答案区";
    const giftReport = parseAiken(giftBad);
    void giftReport;
    const { parseGift } = await import("../src/importer/gift");
    expect(parseGift(giftBad).errors[0].row).toBe(2);
    const blk = await extractTextRowAt(giftBad, 2);
    expect(blk).toBe("::乙:: 无答案区"); // 盲用 Aiken 行号会取到第 1 块内部行
  });

  it("extractTextRowAt：TSV 表头模式数据行口径", async () => {
    const tsvBad = "#separator:tab\n题型\t题干\t选项A\t选项B\t答案\n单选\t题1\t甲\t乙\tZ"; // 第 2 数据行（row=2）答案非法
    const blk = await extractTextRowAt(tsvBad, 2);
    expect(blk).toBe("单选\t题1\t甲\t乙\tZ");
  });
});
