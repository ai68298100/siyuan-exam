// ============================================================
// 成绩单导出 Markdown（可存档/打印；P2 成绩单导出）
// ============================================================
import type { MockScore } from "./mock";
import type { Blueprint } from "./mock";

export function scoreToMarkdown(bp: Blueprint, score: MockScore, startedAt: number): string {
  const d = new Date(startedAt);
  const when = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const lines = [
    `# 模考成绩单 · ${bp.name}`,
    ``,
    `- 考试时间：${when} · 用时 ${Math.round((score.full ? score.total / score.full : 0) * 100)}%`,
    `- **总分：${score.total} / ${score.full}（${score.percent}%）**`,
    `- 判定：${score.pass ? "✅ 通过" : "❌ 未通过"}（及格线 ${bp.passLine}）`,
    ``,
    `## 分模块`,
    ``,
    `| 模块 | 得分 | 满分 | 正确 | 用时 |`,
    `|---|---|---|---|---|`,
  ];
  for (const s of score.sections) {
    lines.push(`| ${s.name} | ${s.score} | ${s.full} | ${s.correct}/${s.total} | ${Math.round(s.timeSpentMs / 1000)}s |`);
  }
  lines.push(
    ``,
    `## 行为数据`,
    ``,
    `- 标旗 ${score.flagsUsed} · 改答 ${score.changes} · 切屏 ${score.screenSwitches}`,
    `- 最后 20 分钟：做 ${score.last20min.attempted} 对 ${score.last20min.correct}`,
  );
  return lines.join("\n");
}
