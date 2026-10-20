import { describe, it, expect } from "vitest";
import {
  countWordsAndCharacters,
  evaluateWordCountStatus,
  generatePaperGrid,
} from "../src/core/wordCount";

describe("WordCount 主观题机考方格答题纸与字数实时测算引擎 (54-06 / 55-05)", () => {
  describe("countWordsAndCharacters (字符与考试字数统计)", () => {
    it("空字符串全项归零返回", () => {
      const res = countWordsAndCharacters("");
      expect(res.chineseChars).toBe(0);
      expect(res.punctuations).toBe(0);
      expect(res.englishWords).toBe(0);
      expect(res.numberWords).toBe(0);
      expect(res.paragraphs).toBe(0);
      expect(res.examWords).toBe(0);
    });

    it("纯中文与标点符号统计：汉字计1，标点计1", () => {
      const text = "坚定文化自信，推动社会主义文化繁荣兴盛。";
      const res = countWordsAndCharacters(text);

      expect(res.chineseChars).toBe(18); // 18 个汉字
      expect(res.punctuations).toBe(2); // 逗号和句号
      expect(res.englishWords).toBe(0);
      expect(res.numberWords).toBe(0);
      expect(res.examWords).toBe(20); // 18 + 2
      expect(res.paragraphs).toBe(1);
    });

    it("中英数混排复合统计：连续英文和数字分别计为单个单词", () => {
      // 包含 4个汉字 + 1个标点 + 2个英文词 (Hello, World) + 1个数字 (2026)
      const text = "中国制造，Hello World in 2026！";
      const res = countWordsAndCharacters(text);

      expect(res.chineseChars).toBe(4);
      expect(res.punctuations).toBe(2); // 逗号和叹号
      expect(res.englishWords).toBe(3); // Hello, World, in
      expect(res.numberWords).toBe(1); // 2026
      expect(res.examWords).toBe(10); // 4 + 2 + 3 + 1
    });

    it("多段落统计正确忽略空行", () => {
      const text = "第一段文字。\n\n第二段文字。\n\n\n第三段。";
      const res = countWordsAndCharacters(text);
      expect(res.paragraphs).toBe(3);
    });
  });

  describe("evaluateWordCountStatus (字数达标状态机)", () => {
    it("未设限制时返回 no_limit 状态", () => {
      const res = evaluateWordCountStatus(350);
      expect(res.state).toBe("no_limit");
      expect(res.tone).toBe("neutral");
      expect(res.label).toBe("共 350 字");
    });

    it("仅设下限 (如不少于 500 字)", () => {
      // 1. 不足 500 字
      const resFew = evaluateWordCountStatus(300, { minWords: 500 });
      expect(resFew.state).toBe("too_few");
      expect(resFew.difference).toBe(200);
      expect(resFew.tone).toBe("danger");
      expect(resFew.label).toContain("字数不足");

      // 2. 达到 500 字
      const resFit = evaluateWordCountStatus(520, { minWords: 500 });
      expect(resFit.state).toBe("fit");
      expect(resFit.tone).toBe("success");
      expect(resFit.label).toContain("已达标");
    });

    it("仅设上限 (如不超过 300 字)", () => {
      // 1. 合格状态 (200 字)
      const resFit = evaluateWordCountStatus(200, { maxWords: 300 });
      expect(resFit.state).toBe("fit");
      expect(resFit.tone).toBe("success");

      // 2. 临界预警状态 (280 字，>= 90%)
      const resWarning = evaluateWordCountStatus(280, { maxWords: 300 });
      expect(resWarning.state).toBe("warning");
      expect(resWarning.tone).toBe("warning");
      expect(resWarning.label).toContain("接近上限");

      // 3. 超限状态 (320 字)
      const resExceed = evaluateWordCountStatus(320, { maxWords: 300 });
      expect(resExceed.state).toBe("exceeded");
      expect(resExceed.difference).toBe(20);
      expect(resExceed.tone).toBe("danger");
      expect(resExceed.label).toContain("超限 20 字");
    });

    it("同时设上下限 (如 800 - 1000 字申论大作文)", () => {
      const opts = { minWords: 800, maxWords: 1000 };

      // 1. 750 字 -> too_few
      const r1 = evaluateWordCountStatus(750, opts);
      expect(r1.state).toBe("too_few");
      expect(r1.difference).toBe(50);

      // 2. 850 字 -> fit
      const r2 = evaluateWordCountStatus(850, opts);
      expect(r2.state).toBe("fit");
      expect(r2.tone).toBe("success");

      // 3. 950 字 -> warning (>= 900)
      const r3 = evaluateWordCountStatus(950, opts);
      expect(r3.state).toBe("warning");
      expect(r3.difference).toBe(50); // 还剩 50 字

      // 4. 1030 字 -> exceeded
      const r4 = evaluateWordCountStatus(1030, opts);
      expect(r4.state).toBe("exceeded");
      expect(r4.difference).toBe(30);
    });
  });

  describe("generatePaperGrid (25×N 机考答题纸网格生成)", () => {
    it("默认生成 25 列标准机考方格答题纸，并自动为空行/末尾补齐整行", () => {
      const text = "中国式现代化是人与自然和谐共生的现代化。"; // 20 字
      const grid = generatePaperGrid(text, { columns: 25, minRows: 5 });

      expect(grid.columns).toBe(25);
      expect(grid.totalRows).toBeGreaterThanOrEqual(5);

      const firstRow = grid.rows[0];
      expect(firstRow.cells).toHaveLength(25);

      // 段首默认空 2 格
      expect(firstRow.cells[0].isIndent).toBe(true);
      expect(firstRow.cells[1].isIndent).toBe(true);

      // 第 3 格是第一个汉字 '中'
      expect(firstRow.cells[2].char).toBe("中");
      expect(firstRow.cells[2].wordIndex).toBe(1);

      // 剩余格子填充空字
      expect(firstRow.cells[24].char).toBe("");
    });

    it("自然段换行另起一行，第二段段首再次空两格", () => {
      const text = "第一段结论。\n第二段分析。";
      const grid = generatePaperGrid(text, { columns: 25 });

      expect(grid.rows.length).toBeGreaterThanOrEqual(2);

      // 第一段
      const row1 = grid.rows[0];
      expect(row1.cells[0].isIndent).toBe(true);
      expect(row1.cells[2].char).toBe("第");

      // 第二段另起一行，首格仍为缩进
      const row2 = grid.rows[1];
      expect(row2.cells[0].isIndent).toBe(true);
      expect(row2.cells[2].char).toBe("第");
    });

    it("字数达到 100/200 字标准时在格子上准确标注里程碑", () => {
      // 构造 110 个汉字文本
      const longText = "一".repeat(110);
      const grid = generatePaperGrid(longText, { columns: 25 });

      // 找到第 100 个有效字的格子
      let foundMilestone = false;
      for (const row of grid.rows) {
        for (const cell of row.cells) {
          if (cell.wordIndex === 100) {
            expect(cell.isMilestone).toBe(true);
            expect(cell.milestoneLabel).toBe("100字");
            foundMilestone = true;
          }
        }
      }
      expect(foundMilestone).toBe(true);
    });

    it("超过 maxWords 时，超出部分的格子自动标记 isExceeded 为 true", () => {
      const text = "一二三四五六七八九十"; // 10 个字
      const grid = generatePaperGrid(text, { columns: 25, maxWords: 6 });

      const row = grid.rows[0];
      // 前 6 个有效字不超限
      const validCells = row.cells.filter((c) => c.wordIndex !== null);
      expect(validCells[5].wordIndex).toBe(6);
      expect(validCells[5].isExceeded).toBe(false);

      // 第 7 个字开始标记超限
      expect(validCells[6].wordIndex).toBe(7);
      expect(validCells[6].isExceeded).toBe(true);
      expect(validCells[9].isExceeded).toBe(true);
    });
  });
});
