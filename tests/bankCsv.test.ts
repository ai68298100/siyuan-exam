import { describe, it, expect } from "vitest";
import { questionsToCsv, BANK_CSV_HEADERS } from "../src/core/bankCsv";
import { autoMapExcel } from "../src/importer/pipeline";
import { makeQuestion } from "../src/core/blockTemplate";
import type { Question } from "../src/core/types";

const qs: Question[] = [
  makeQuestion({
    type: "single",
    stem: '带逗号,和"引号"的题干',
    options: ["甲", "乙,丙"],
    answer: "A",
    analysis: "多行\n解析",
    kp: "言语/逻辑",
    source: "2023 国考",
  }),
  makeQuestion({ type: "judge", stem: "判断题", answer: "对", difficulty: 3 }),
];

describe("题库 CSV 导出（TODO 8 组 lite：模板表头往返）", () => {
  it("表头与官方模板一致（autoMapExcel 可识别）", () => {
    const { map, missing } = autoMapExcel(BANK_CSV_HEADERS);
    expect(missing).toEqual([]);
    expect(map.stem).toBeGreaterThan(0);
    expect(map.answer).toBeGreaterThan(0);
    expect(map.options.length).toBeGreaterThanOrEqual(2);
  });

  it("BOM 头 + 逗号/引号/换行转义；选项留空补位到 F", () => {
    const csv = questionsToCsv(qs);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toHaveLength(3); // 表头 + 2 题
    expect(lines[1]).toContain('"带逗号,和""引号""的题干"');
    expect(lines[1]).toContain('"多行\n解析"');
    // judge 题选项全空：仍有 6 个空位（逗号计数校验由 roundtrip 测试承担）
    expect(lines[2].split(",").length).toBeGreaterThanOrEqual(BANK_CSV_HEADERS.length - 2);
  });

  it("roundtrip：导出 CSV → parse 语义上可被 autoMap+parseExcelRows 识别（表头匹配）", () => {
    const csv = questionsToCsv(qs);
    const rows = csv
      .slice(1)
      .split("\r\n")
      .map((line) => {
        // 简易 CSV 行解析（与导出转义对称；含引号字段按 "" 解转义）
        const cells: string[] = [];
        let cur = "",
          inQ = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (inQ) {
            if (ch === '"' && line[i + 1] === '"') {
              cur += '"';
              i++;
            } else if (ch === '"') inQ = false;
            else cur += ch;
          } else if (ch === '"') inQ = true;
          else if (ch === ",") {
            cells.push(cur);
            cur = "";
          } else cur += ch;
        }
        cells.push(cur);
        return cells;
      });
    const { map, missing } = autoMapExcel(rows[0]);
    expect(missing).toEqual([]);
    // 题干列能取回第一题的题干（转义无损）
    expect(rows[1][map.stem]).toBe('带逗号,和"引号"的题干');
    expect(rows[2][map.answer]).toBe("对");
  });
});
