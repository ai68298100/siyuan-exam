// ============================================================
// 导出（v0.5）：错题册 Markdown（可打印；callout 分区——调研 07 错题导出范式）
// ============================================================
import type { Question, WrongItem } from "./types";

const esc = (s: string) => s.replace(/\|/g, "\\|");

export function wrongbookToMarkdown(
  items: { wrong: WrongItem; q: Question }[],
  opts: { bankName: string; exportedAt: Date },
): string {
  const d = opts.exportedAt;
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const head = [`# 错题册 · ${esc(opts.bankName)}`, ``, `> 导出于 ${ymd} · 共 ${items.length} 题 · 由小驴考试生成`, ``];
  if (!items.length) return head.join("\n") + "\n（错题本为空）\n";
  const body = items.map(({ wrong, q }) => {
    const lines = [
      `## ${esc(q.stem.split("\n")[0]).slice(0, 60)}`,
      ``,
      `**${typeLabel(q.type)}**${q.kp ? ` · ${esc(q.kp)}` : ""}${q.source ? ` · ${esc(q.source)}` : ""} · 错 ${wrong.wrongCount} 次`,
      ``,
      q.stem,
      ``,
    ];
    if (q.options.length) {
      lines.push(...q.options.map((o, i) => `- ${String.fromCharCode(65 + i)}. ${o}`), ``);
    }
    lines.push(`> ✕ 我的答案：${wrong.myAnswer ?? "（未作答）"}`);
    lines.push(`> ✓ 正确答案：${q.answer}`);
    if (q.analysis) lines.push(`>`, `> 💡 ${q.analysis.replace(/\n/g, "\n> ")}`);
    if (wrong.reason) lines.push(`>`, `> 错因：${reasonLabel(wrong.reason)}`);
    lines.push(``);
    return lines.join("\n");
  });
  return [...head, ...body].join("\n");
}

function typeLabel(t: Question["type"]): string {
  return { single: "单选", multiple: "多选", judge: "判断", fill: "填空", short: "简答" }[t];
}

function reasonLabel(r: string): string {
  return { careless: "粗心", unknown: "知识不会", trap: "陷阱" }[r] ?? r;
}

// ---------- 图表文本等价物（45-08）：CSV 与 SVG 图表取同一数据快照，数字与报告一致 ----------

const csvJoin = (head: string[], rows: (string | number)[][]) =>
  "\uFEFF" + [head.join(","), ...rows.map((r) => r.map((v) => String(v))).map((r) => r.join(","))].join("\r\n");

export function trendToCsv(trend: { date: string; attempts: number }[]): string {
  return csvJoin(["日期", "作答题数"], trend.map((p) => [p.date, p.attempts]));
}

export function heatmapToCsv(heat: { date: string; count: number }[]): string {
  return csvJoin(["日期", "活动量"], heat.map((p) => [p.date, p.count]));
}

export function hourlyToCsv(hours: number[]): string {
  return csvJoin(
    ["时段", "作答题数"],
    hours.map((n, i) => [`${String(i).padStart(2, "0")}:00-${String(i).padStart(2, "0")}:59`, n]),
  );
}
