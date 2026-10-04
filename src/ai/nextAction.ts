// ============================================================
// AI 下一行动（TODO 117-02，docs/18 T11 家族）：按可用分钟、开放行动、
// 薄弱考点与错题在册给少量任务建议及完成定义。
// 红线入 system：总负荷不得超过给定容量；容量缺失明说不排量只给顺序；
// 不得虚构题源数量（只能引用给定统计）；建议非指令，采纳由用户。
// 纯函数无 IO；事实全部来自确定性聚合（timeBudget/actions/report）。
// ============================================================
import type { AiMessage } from "./client";

export interface NextActionFactsInput {
  windowLabel: string; // "今日" 等
  /** 今日可用容量（53-01 估算；null=无历史口径，如实说明不排量） */
  capacity: { minutes: number; low: number; high: number; sourced: boolean } | null;
  /** 容量口径说明（如"错题重练队列前 10 题（非入口页今日计划）"）；缺容量时忽略 */
  capacityScope?: string;
  openActions: { detail: string; kind: string; ageDays?: number }[]; // 开放下一步行动（≤5 条入事实）
  weakKp: { kp: string; accuracy: number; attempts: number }[];
  wrongInBook: number; // 错题在册（可重练池）
  recentAttempts: number;
  recentAccuracy: number | null;
}

/** 事实行：容量/行动/弱项/近期表现，缺什么显式说什么 */
export function nextActionFactLines(f: NextActionFactsInput): string[] {
  const lines: string[] = [];
  if (f.capacity) {
    lines.push(
      `今日可用容量：约 ${f.capacity.minutes} 分钟（区间 ${f.capacity.low}-${f.capacity.high}）` +
        (f.capacity.sourced ? "" : "；含默认值（部分题型缺历史，容量口径偏粗）") +
        (f.capacityScope ? `；口径：${f.capacityScope}` : ""),
    );
  } else {
    lines.push("今日可用容量：缺历史口径，无法估量（只给任务顺序，不排分钟）");
  }
  if (f.openActions.length) {
    for (const a of f.openActions.slice(0, 5)) {
      const age = typeof a.ageDays === "number" && a.ageDays >= 0 ? `（搁置 ${a.ageDays} 天）` : "";
      lines.push(`开放行动〔${a.kind}〕：${a.detail}${age}`);
    }
    if (f.openActions.length > 5) lines.push(`…另有开放行动 ${f.openActions.length - 5} 条未列出`);
  } else {
    lines.push("开放行动：无");
  }
  if (f.weakKp.length) {
    for (const w of f.weakKp) {
      lines.push(`弱项考点〔${w.kp}〕：${w.attempts} 题中未掌握比例 ${w.accuracy}%${w.attempts < 5 ? "；样本 <5 仅作线索" : ""}`);
    }
  } else {
    lines.push("弱项考点：窗口内无可列项");
  }
  lines.push(`错题在册：${f.wrongInBook} 题（可重练）`);
  lines.push(
    f.recentAttempts > 0
      ? `近期表现：${f.windowLabel}作答 ${f.recentAttempts} 题，正确率 ${f.recentAccuracy}%`
      : `近期表现：${f.windowLabel}无作答记录`,
  );
  lines.push("——以上为全部事实；任务建议只能基于这些数字。");
  return lines;
}

export function buildNextActionMessages(f: NextActionFactsInput): AiMessage[] {
  const system = [
    "你是备考计划助手，中文、简洁。基于给定事实给 2-3 条任务建议，每条格式——",
    "【任务】名称｜预计 N 分钟｜完成定义：…（可核验的完成标准，如『重练 5 题并记录错因』）｜理由：一句话（引用给定统计）。",
    "约束：总负荷不得超过给定容量；容量缺失时明说『不排分钟』只给先后顺序；任务数量少而具体，不清单轰炸。",
    "红线：不得虚构题源数量或引入未给出的数字；不得预测通过率；样本不足的考点标注『仅作线索』；建议非指令，用户可调整。",
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: nextActionFactLines(f).join("\n") },
  ];
}
