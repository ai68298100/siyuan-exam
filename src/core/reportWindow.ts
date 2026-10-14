/** 报告“今日/近 N 天”按本地自然日筛选，包含今天；0 表示全部。 */
export function reportWindowStart(days: number, now = Date.now()): number {
  if (days <= 0) return 0;
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (days - 1));
  return date.getTime();
}

/** 与报告逐日聚合保持本地日界，避免 UTC 日期在凌晨落到前一天。 */
export function reportDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
