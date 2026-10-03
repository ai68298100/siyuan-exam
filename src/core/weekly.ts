// ============================================================
// 周对比快照（v0.3 报告四维收尾）+ 每日战报路径（联动小驴复盘预留）
// 纯函数；周=本地自然周一为起点
// ============================================================
import type { ReplayResult } from "./types";

export interface WeekAgg { key: string; attempts: number; correct: number }

/** 本地周一 00:00 */
function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;   // 0=Mon
  x.setDate(x.getDate() - dow);
  return x;
}

function keyOf(monday: Date): string {
  return `${monday.getFullYear()}-W${String(Math.ceil((monday.getTime() - new Date(monday.getFullYear(), 0, 1).getTime()) / 86_400_000 / 7) + 1).padStart(2, "0")}`;
}

/** 最近 n 周（含本周）聚合，旧→新 */
export function weeklyAggregates(days: ReplayResult["days"], today: Date = new Date(), n = 8): WeekAgg[] {
  const out: WeekAgg[] = [];
  const thisMonday = mondayOf(today);
  for (let w = n - 1; w >= 0; w--) {
    const mon = new Date(thisMonday);
    mon.setDate(mon.getDate() - w * 7);
    const key = keyOf(mon);
    let attempts = 0, correct = 0;
    for (let d = 0; d < 7; d++) {
      const day = new Date(mon);
      day.setDate(day.getDate() + d);
      const k = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      const v = days.get(k);
      if (v) { attempts += v.attempts; correct += v.correct; }
    }
    out.push({ key, attempts, correct });
  }
  return out;
}

/** 周对比：本周 vs 上周（做题量/正确率） */
export function weekCompare(weeks: WeekAgg[]): { thisWeek: WeekAgg; lastWeek: WeekAgg } | null {
  if (weeks.length < 2) return null;
  return { thisWeek: weeks[weeks.length - 1], lastWeek: weeks[weeks.length - 2] };
}

export interface DayTrendPoint { date: string; attempts: number; correct: number }

/** 最近 n 天（含今天）逐日做题量，旧→新（2.6 趋势线；本地日界，缺日补零） */
export function dailyTrend(days: ReplayResult["days"], today: Date = new Date(), n = 30): DayTrendPoint[] {
  const out: DayTrendPoint[] = [];
  const cur = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  cur.setDate(cur.getDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    const k = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
    const v = days.get(k);
    out.push({ date: k, attempts: v?.attempts ?? 0, correct: v?.correct ?? 0 });
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** 每日笔记文档路径（思源约定：conf.dailyNoteSavePath 模板含 {{now | date ...}}；
 *  我们按 "YYYY-MM-DD" 日粒度落 —— 与内核 createDailyNote 的当日文档一致） */
export function dailyDocPath(savePathTpl: string, today: Date = new Date()): string {
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  // 模板形如 /Diary/{{now | date "%Y-%m-%d"}}；替换日期 token，若无 token 则追加 /ymd
  if (savePathTpl.includes("{{")) {
    return savePathTpl.replace(/\{\{[^}]*\}\}/g, ymd).replace(/\/+$/, "");
  }
  return savePathTpl.replace(/\/+$/, "") + "/" + ymd;
}
