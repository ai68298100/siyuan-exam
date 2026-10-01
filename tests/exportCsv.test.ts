import { describe, it, expect } from "vitest";
import { errorsToCsv } from "../src/importer/pipeline";

describe("错误清单 CSV", () => {
  it("BOM 头 + 引号转义 + 换行分隔", () => {
    const csv = errorsToCsv([
      { row: 3, reason: "答案无法识别：\"X\"", raw: "含\"引号\"的题干" },
      { row: 5, reason: "选项不足 2 个", raw: "残缺行" },
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"答案无法识别：""X"""');
    expect(csv.split("\r\n")).toHaveLength(3);
  });
});
