import { describe, it, expect } from "vitest";
import { detectDelimiter } from "../src/importer/csvDecode";
import { dailyTrend } from "../src/core/weekly";

describe("CSV 分隔符自动探测（TODO 12 组）", () => {
  it("逗号优先：标准表头多逗号", () => {
    const csv = "题型,题干,选项A,答案\n单选,1+1=?,2,3,B";
    expect(detectDelimiter(csv)).toBe(",");
  });
  it("分号导出（欧洲风格）", () => {
    const csv = "题型;题干;答案\n单选;1+1=?;B\n判断;对否;对";
    expect(detectDelimiter(csv)).toBe(";");
  });
  it("Tab 分隔（TSV）；并列时逗号优先", () => {
    expect(detectDelimiter("题型\t题干\t答案\n单选\t1+1=?\tB")).toBe("\t");
    expect(detectDelimiter("没有分隔符的一行")).toBe(",");
  });
});

describe("30 天趋势（2.6）", () => {
  const today = new Date(2026, 9, 3);
  it("输出 n 个点、旧→新、缺日补零", () => {
    const days = new Map([
      ["2026-10-03", { date: "2026-10-03", attempts: 7, correct: 5 }],
      ["2026-10-01", { date: "2026-10-01", attempts: 3, correct: 3 }],
    ]);
    const trend = dailyTrend(days, today, 30);
    expect(trend).toHaveLength(30);
    expect(trend[0].date).toBe("2026-09-04");
    expect(trend[29].date).toBe("2026-10-03");
    expect(trend[29].attempts).toBe(7);
    expect(trend[28].attempts).toBe(0); // 10-02 缺日补零
    expect(trend[27].attempts).toBe(3); // 10-01
  });
  it("样本不足（全空）全零输出，不炸", () => {
    const trend = dailyTrend(new Map(), today, 7);
    expect(trend).toHaveLength(7);
    expect(trend.every((p) => p.attempts === 0)).toBe(true);
  });
});
