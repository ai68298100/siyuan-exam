import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildTemplateWorkbook } from "../src/importer/template";
import { autoMapExcel, parseExcelRows } from "../src/importer/pipeline";

describe("官方模板（自洽性：生成的模板能被自己的导入器读回）", () => {
  it("构建 → 读回 → 全部入库且无错误", () => {
    const { buffer, filename } = buildTemplateWorkbook();
    expect(filename).toContain("xlsx");
    const wb = XLSX.read(buffer, { type: "array" });
    const rows: string[][] = XLSX.utils.sheet_to_json(wb.Sheets["题库模板"], { header: 1, defval: "" });
    const { map, missing } = autoMapExcel(rows[0].map(String));
    expect(missing).toEqual([]);
    const r = parseExcelRows(rows.slice(1), map);
    expect(r.errors).toEqual([]);
    expect(r.ok).toHaveLength(8);
    const mat = r.ok.find((q) => q.type === "material")!;
    expect(mat.group).toMatch(/^g-/);
    const subs = r.ok.filter((q) => q.group === mat.group);
    expect(subs).toHaveLength(3); // 材料 + 2 子题
    expect(r.ok[2].answer).toBe("对"); // 判断方言
  });

  it("54 第三刀：数值/多空示例行自动带 answerSpec（随导入写块属性）", () => {
    const { buffer } = buildTemplateWorkbook();
    const wb = XLSX.read(buffer, { type: "array" });
    const rows: string[][] = XLSX.utils.sheet_to_json(wb.Sheets["题库模板"], { header: 1, defval: "" });
    const { map } = autoMapExcel(rows[0].map(String));
    const r = parseExcelRows(rows.slice(1), map);
    const numeric = r.ok.find((q) => q.answer === "340 m/s")!;
    expect(numeric.answerSpec).toEqual({ v: 1, kind: "numeric", unit: "m/s" });
    const multi = r.ok.find((q) => q.answer === "光年;;天文单位")!;
    expect(multi.answerSpec?.kind).toBe("multiBlank");
    expect(multi.answerSpec?.kind === "multiBlank" && multi.answerSpec.blanks).toHaveLength(2);
    expect(multi.answerSpec?.kind === "multiBlank" && multi.answerSpec.blanks[0].answers).toEqual(["光年"]);
  });
});
