// ============================================================
// 41-05 取消、部分成果与用量记账（Cancellation, Partial Results & Usage Accounting）
// 验收要求（TODO 41-05）：
//   1) 第 2 片失败保留第 1 片；重试只补缺片；
//   2) 取消后不静默继续批准、不声称撤回已送出的数据；
//   3) **花费统计不漏失败调用**——失败的请求同样消耗了服务端算力，必须计入。
// 现状：CountingChannel 只在成功返回后累加 charsOut，失败/取消的调用完全没有记账；
// AiTaskRunner 的失败信封恒为 tokens: 0。本模块把「已送出的用量」与「缺口分片」
// 收成单一真相源，纯函数无 IO。
// ============================================================

/** 单次调用的用量事实（无论成功、失败还是取消，只要请求已送出就应记账） */
export interface CallUsage {
  /** 序号（从 1 开始，便于与分片对应） */
  index: number;
  /** 送出时的输入字符数（请求已送出即已消耗，与结果无关） */
  charsIn: number;
  /** 成功返回的输出字符数；失败/取消为 0（未收到内容，但输入已消耗） */
  charsOut: number;
  outcome: "ok" | "failed" | "cancelled" | "skipped";
}

export interface UsageLedger {
  /** 所有已送出调用的合计用量（含失败与取消） */
  totals: {
    calls: number;
    /** 已送出的调用数（含失败/取消） */
    sent: number;
    ok: number;
    failed: number;
    cancelled: number;
    charsIn: number;
    charsOut: number;
    /** 粗估 token（chars/4，与 CountingChannel 同口径） */
    approxTokens: number;
  };
  calls: CallUsage[];
}

/** 记一笔调用（只要请求已送出就必须记账，含失败与取消） */
export function recordCall(
  ledger: UsageLedger,
  call: CallUsage,
): UsageLedger {
  const calls = [...ledger.calls, call];
  return { totals: summarizeUsage(calls), calls };
}

/** 由调用明细汇总用量（失败/取消计入 sent 与 charsIn，但不产生 charsOut） */
export function summarizeUsage(calls: readonly CallUsage[]): UsageLedger["totals"] {
  const totals: UsageLedger["totals"] = {
    calls: calls.length,
    sent: 0,
    ok: 0,
    failed: 0,
    cancelled: 0,
    charsIn: 0,
    charsOut: 0,
    approxTokens: 0,
  };
  for (const c of calls) {
    // 只有 skipped（未送出）不算消耗
    if (c.outcome !== "skipped") {
      totals.sent++;
      totals.charsIn += Math.max(0, c.charsIn || 0);
    }
    if (c.outcome === "ok") {
      totals.ok++;
      totals.charsOut += Math.max(0, c.charsOut || 0);
    } else if (c.outcome === "failed") {
      totals.failed++;
    } else if (c.outcome === "cancelled") {
      totals.cancelled++;
    }
  }
  totals.approxTokens = Math.round((totals.charsIn + totals.charsOut) / 4);
  return totals;
}

/** 建立空账本 */
export function emptyLedger(): UsageLedger {
  return { totals: summarizeUsage([]), calls: [] };
}

/** 一行可读回执：明确列出失败/取消调用是否已计入（45-08 文本等价物口径） */
export function usageReceipt(ledger: UsageLedger): string {
  const t = ledger.totals;
  const parts = [`共 ${t.sent} 次已送出调用`];
  if (t.ok) parts.push(`${t.ok} 次成功`);
  if (t.failed) parts.push(`${t.failed} 次失败`);
  if (t.cancelled) parts.push(`${t.cancelled} 次因取消中止`);
  parts.push(`约 ${t.approxTokens} tokens`);
  return parts.join(" · ") + "（失败与取消的调用同样已送出，计入用量）";
}

// ---------- 取消语义 ----------

export type CancelPhase = "before-send" | "in-flight" | "after-response";

export interface CancelOutcome {
  /** 请求是否已送出（送出后无法撤回已发送的数据） */
  sent: boolean;
  /** 是否可以声称「未消耗」 */
  canClaimNoUsage: boolean;
  /** 是否允许静默继续后续分片（取消后必须为 false） */
  mayContinueSilently: boolean;
  note: string;
}

/**
 * 取消时点的如实语义：取消不能撤回已送出的数据。
 * - before-send：请求未送出，可声称未消耗；
 * - in-flight：请求已送出但结果未知，**不可声称未消耗**，需按失败记账；
 * - after-response：响应已返回，取消只影响后续处理，用量已正常计入。
 */
export function cancelOutcome(phase: CancelPhase): CancelOutcome {
  switch (phase) {
    case "before-send":
      return {
        sent: false,
        canClaimNoUsage: true,
        mayContinueSilently: false,
        note: "请求尚未送出，本次无消耗；取消后不再继续后续分片。",
      };
    case "in-flight":
      return {
        sent: true,
        canClaimNoUsage: false,
        mayContinueSilently: false,
        note: "请求已送出但结果不明，无法撤回已发送的数据，本次按失败/取消计入用量；取消后不再继续后续分片。",
      };
    case "after-response":
      return {
        sent: true,
        canClaimNoUsage: false,
        mayContinueSilently: false,
        note: "响应已返回，本次用量已计入；取消仅停止后续处理，不撤回已产生的结果。",
      };
  }
}

// ---------- 分片缺口与重试 ----------

export interface SliceState {
  index: number;
  status: "done" | "failed" | "cancelled" | "pending";
}

/** 已完成分片保留：失败/取消不丢弃已成功分片的成果 */
export function completedSlices(slices: readonly SliceState[]): number[] {
  return slices.filter((s) => s.status === "done").map((s) => s.index);
}

/** 重试时只补缺片（failed/cancelled/pending），已成功的不重跑（省调用也避免重复成果） */
export function missingSlices(slices: readonly SliceState[]): number[] {
  return slices.filter((s) => s.status !== "done").map((s) => s.index);
}

export interface PartialResult<T> {
  /** 已成功分片的成果（失败/取消也保留） */
  items: T[];
  completed: number[];
  missing: number[];
  /** 整体是否完整（有缺口即 false，不得伪装成完成） */
  complete: boolean;
  /** 是否因取消而中止 */
  cancelled: boolean;
}

/** 汇总分片成果：保留已完成、如实标注缺口，不把部分成果说成完整 */
export function partialResult<T>(
  slices: readonly SliceState[],
  itemsBySlice: ReadonlyMap<number, T[]>,
  cancelled = false,
): PartialResult<T> {
  const completed = completedSlices(slices);
  const missing = missingSlices(slices);
  const items: T[] = [];
  for (const i of completed) {
    for (const it of itemsBySlice.get(i) ?? []) items.push(it);
  }
  return {
    items,
    completed,
    missing,
    complete: missing.length === 0,
    cancelled,
  };
}

/** 部分成果的一行如实回执（分部失败/取消时界面与导出共用） */
export function partialResultReceipt(r: PartialResult<unknown>): string {
  if (r.complete) return `全部 ${r.completed.length} 片已完成。`;
  const why = r.cancelled ? "已取消" : "有失败分片";
  return `${why}：已完成 ${r.completed.length} 片并保留成果，仍有 ${r.missing.length} 片待补（重试只补缺片）。`;
}
