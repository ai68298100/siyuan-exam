// ============================================================
// 数据自检与完整性审计引擎（45-12 / 72-05 / 69-04）
// 纯函数领域层：
// 1. 作答流水红线校验：乱序 seq、事件 id 重复、未来时间戳、答案缺失
// 2. 错题状态机一致性：错次与消灭连击矛盾、空错因、脏 qid
// 3. 题库引用完整性：孤儿 qid、缺失题目、选项-答案越界
// 4. 分级修复建议（可自动修复 / 需人工确认），绝不静默删除历史
// 规则：严格无外部宿主依赖（禁 import "siyuan"），严禁类型强转。
// ============================================================

import type { AttemptEvent, Question, WrongItem } from "./types";

export type IntegritySeverity = "error" | "warning" | "info";

export interface IntegrityIssue {
  code: string;
  severity: IntegritySeverity;
  message: string;
  count: number;
  samples: string[];
  /** 是否可安全自动修复 */
  autoFixable: boolean;
  hint: string;
}

export interface IntegrityReport {
  generatedAt: number;
  totalEvents: number;
  totalQuestions: number;
  issues: IntegrityIssue[];
  /** error 级问题数（存在则判定为不健康） */
  errorCount: number;
  healthy: boolean;
  receipt: string;
}

const MAX_SAMPLES = 5;

function pushIssue(
  issues: IntegrityIssue[],
  code: string,
  severity: IntegritySeverity,
  message: string,
  items: string[],
  autoFixable: boolean,
  hint: string,
) {
  if (!items.length) return;
  issues.push({
    code,
    severity,
    message,
    count: items.length,
    samples: items.slice(0, MAX_SAMPLES),
    autoFixable,
    hint,
  });
}

/**
 * 执行全量数据完整性审计（纯函数）。
 */
export function auditDataIntegrity(options: {
  events: readonly AttemptEvent[];
  questions: readonly Question[];
  wrongItems: readonly WrongItem[];
  nowMs?: number;
}): IntegrityReport {
  const now = options.nowMs ?? Date.now();
  const futureLimit = now + 5 * 60_000; // 允许 5 分钟时钟偏差
  const qidSet = new Set(options.questions.map((q) => q.id));
  const issues: IntegrityIssue[] = [];

  // ---------- 1. 作答流水 ----------
  const seenEids = new Set<string>();
  const duplicateEids: string[] = [];
  const futureEvents: string[] = [];
  const missingQidEvents: string[] = [];
  const orphanEvents: string[] = [];
  const corruptedVerdict: string[] = [];
  const invalidVerdicts = new Set(["correct", "wrong", "not_attempted"]);

  for (const e of options.events) {
    if (e.eid) {
      if (seenEids.has(e.eid)) duplicateEids.push(e.eid);
      else seenEids.add(e.eid);
    } else {
      duplicateEids.push(`(missing eid) ${e.qid}`);
    }
    if (e.ts > futureLimit) futureEvents.push(`${e.qid} @${new Date(e.ts).toISOString()}`);
    if (!e.qid || !e.qid.trim()) missingQidEvents.push(e.eid || "(no eid)");
    else if (qidSet.size && !qidSet.has(e.qid)) orphanEvents.push(`${e.qid} (${e.eid})`);
    if (!invalidVerdicts.has(e.verdict)) corruptedVerdict.push(`${e.eid}: ${String(e.verdict)}`);
  }

  pushIssue(issues, "dup-eid", "error", "作答流水存在重复事件 ID（幂等键冲突）", duplicateEids, true,
    "可去重保留首条，但须先导出原始流水备份。");
  pushIssue(issues, "future-ts", "warning", "作答流水存在晚于当前时间的异常时间戳", futureEvents, false,
    "多为系统时钟跳变；建议核对设备时间，不自动改写历史。");
  pushIssue(issues, "empty-qid", "error", "作答流水存在空题目 ID", missingQidEvents, false,
    "空 qid 事件无法归属题目，保留但不计入派生统计。");
  pushIssue(issues, "orphan-event", "warning", "作答流水引用了题库中不存在的题目", orphanEvents, false,
    "多为题目被删除；流水保留，统计时按孤儿忽略。");
  pushIssue(issues, "bad-verdict", "error", "作答流水存在非法判定值", corruptedVerdict, false,
    "数据损坏；建议导出诊断后人工修复。");

  // 顺序性：同设备 seq 应严格递增（乱序回放风险）
  const seqByDevice = new Map<string, number[]>();
  for (const e of options.events) {
    if (!e.device) continue;
    const arr = seqByDevice.get(e.device) ?? [];
    arr.push(e.seq);
    seqByDevice.set(e.device, arr);
  }
  const unordered: string[] = [];
  for (const [device, seqs] of seqByDevice) {
    for (let i = 1; i < seqs.length; i++) {
      if (seqs[i] <= seqs[i - 1]) {
        unordered.push(`${device}: ${seqs[i - 1]} → ${seqs[i]}`);
        break;
      }
    }
  }
  pushIssue(issues, "seq-unordered", "warning", "设备内序号非严格递增（可能存在重放乱序）", unordered, false,
    "不影响内容，仅提示回放顺序风险。");

  // ---------- 2. 错题状态机 ----------
  const wrongMismatch: string[] = [];
  const wrongMissingQ: string[] = [];
  const wrongReasonRows: string[] = [];
  const validReasons = new Set(["careless", "unknown", "trap"]);
  for (const w of options.wrongItems) {
    if (!qidSet.size || qidSet.has(w.qid)) {
      if (w.wrongCount < 1) wrongMismatch.push(`${w.qid}: 错次 ${w.wrongCount}`);
      if (w.streakCorrect < 0) wrongMismatch.push(`${w.qid}: 连对 ${w.streakCorrect}`);
      if (w.lastWrongAt < w.firstWrongAt) wrongMismatch.push(`${w.qid}: 最近错早于首次错`);
    } else {
      wrongMissingQ.push(w.qid);
    }
    if (w.reason && !validReasons.has(w.reason)) wrongReasonRows.push(`${w.qid}: ${w.reason}`);
  }
  pushIssue(issues, "wrong-state", "error", "错题状态机字段自相矛盾", wrongMismatch, true,
    "可由作答流水重算纠正（重放即为唯一真相）。");
  pushIssue(issues, "wrong-orphan", "warning", "错题引用了已不存在的题目", wrongMissingQ, true,
    "题目删除后错题条目可安全清理。");
  pushIssue(issues, "wrong-reason", "warning", "错因取值不在合法枚举内", wrongReasonRows, true,
    "可归一为 unknown，保留原值于诊断导出。");

  // ---------- 3. 题库内容 ----------
  const missingAnswer: string[] = [];
  const answerOutOfRange: string[] = [];
  const emptyOptions: string[] = [];
  const dupQids: string[] = [];
  const seenQids = new Set<string>();

  for (const q of options.questions) {
    if (seenQids.has(q.id)) dupQids.push(q.id);
    else seenQids.add(q.id);

    if (q.type !== "material" && !(q.answer ?? "").trim()) missingAnswer.push(q.id);
    if ((q.type === "single" || q.type === "multiple") && q.options.length < 2) emptyOptions.push(q.id);
    if (q.options.some((o) => !o.trim())) emptyOptions.push(`${q.id} (空选项)`);
    if (q.type === "single" && q.answer) {
      const letter = q.answer.trim().toUpperCase();
      if (/^[A-J]$/.test(letter) && letter.charCodeAt(0) - 65 >= q.options.length) {
        answerOutOfRange.push(`${q.id}: ${letter} > ${q.options.length} 项`);
      }
    }
  }
  pushIssue(issues, "dup-qid", "error", "题库存在重复题目 ID", dupQids, false,
    "需人工确认合并目标，不可自动删除。");
  pushIssue(issues, "missing-answer", "error", "题目缺少标准答案", missingAnswer, false,
    "发布守卫会阻断；草稿状态可忽略。");
  pushIssue(issues, "answer-range", "error", "单选题答案超出选项范围", answerOutOfRange, false,
    "判定必然恒错，请核对答案或选项。");
  pushIssue(issues, "empty-options", "warning", "选择题选项不足或含空选项", emptyOptions, false,
    "影响作答体验与判分公平性。");

  const errorCount = issues.filter((i) => i.severity === "error").reduce((n, i) => n + i.count, 0);
  const healthy = errorCount === 0;

  const receipt = healthy
    ? `数据完整性自检通过：${options.events.length} 条作答流水、${options.questions.length} 道题目、${options.wrongItems.length} 条错题均无阻断性问题。`
    : `数据完整性自检发现 ${errorCount} 项阻断性问题，${issues.filter((i) => i.severity === "warning").length} 类告警。建议先导出诊断备份再修复。`;

  return {
    generatedAt: now,
    totalEvents: options.events.length,
    totalQuestions: options.questions.length,
    issues,
    errorCount,
    healthy,
    receipt,
  };
}

/** 导出完整性审计报告 CSV（UTF-8 BOM） */
export function exportIntegrityCsv(report: IntegrityReport): string {
  const head = ["问题代码", "严重级别", "问题描述", "数量", "可自动修复", "修复建议", "样本"];
  const rows = report.issues.map((i) => [
    i.code,
    i.severity,
    `"${i.message.replace(/"/g, '""')}"`,
    i.count,
    i.autoFixable ? "是" : "否",
    `"${i.hint.replace(/"/g, '""')}"`,
    `"${i.samples.join(" | ").replace(/"/g, '""')}"`,
  ]);
  return "\uFEFF" + [head.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}
