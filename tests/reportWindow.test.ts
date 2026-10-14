import { describe, expect, it } from "vitest";
import { reportDateKey, reportWindowStart } from "../src/core/reportWindow";

describe("报告日期范围", () => {
  const now = new Date(2026, 9, 11, 15, 30).getTime();
  it("今日从本地零点开始，昨天晚间不会混进今日", () => {
    const cutoff = reportWindowStart(1, now);
    expect(cutoff).toBe(new Date(2026, 9, 11).getTime());
    expect(new Date(2026, 9, 10, 23, 59).getTime()).toBeLessThan(cutoff);
    expect(new Date(2026, 9, 11, 0, 0).getTime()).toBeGreaterThanOrEqual(cutoff);
  });
  it("近七天包含今天，跨月仍按自然日计算", () => {
    expect(reportWindowStart(7, now)).toBe(new Date(2026, 9, 5).getTime());
    expect(reportWindowStart(7, new Date(2026, 2, 2, 1).getTime())).toBe(new Date(2026, 1, 24).getTime());
  });
  it("全部不设截点；逐日日期键保留本地凌晨日期", () => {
    expect(reportWindowStart(0, now)).toBe(0);
    expect(reportDateKey(new Date(2026, 9, 11, 0, 1).getTime())).toBe("2026-10-11");
  });
});
