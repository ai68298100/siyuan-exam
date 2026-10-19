// ============================================================
// 39-03 riff 评级结果可恢复（Rating Outcome State Machine）
// 验收要求（TODO 39-03 / 原型 U17）：
//   1) 区分「未转卡 / 已记录练习 / 待确认评级 / 已成功 / 失败」五种结果，不把失败当成功；
//   2) 防双击与重复提交（同题同次评分不重复写流水）；
//   3) 超时或网络中断后**先核对内核状态**，不盲重放评级；
//   4) 四档评级只关联「本次具体 deck/card + 本次揭示状态」，揭示一个探针不解锁另一张卡；
//   5) 不把客观答对静默映射成 Easy（评级只来自用户显式自评）。
// 纯函数状态机：输入为判分事实，输出为可展示状态与后续动作建议；无 IO。
// ============================================================

export type RatingOutcome =
  /** 该题未转为卡：只记录练习流水，不涉及调度 */
  | "not-a-card"
  /** 已是卡，评级已成功写入内核调度 */
  | "recorded"
  /** 请求已发出但结果不明（超时/网络错误）：必须先核对，不得盲重放 */
  | "pending-confirm"
  /** 明确失败（非重试类错误）：保留待确认，等用户重试 */
  | "failed"
  /** 离线：本次不做写回，待恢复连接后按需处理 */
  | "skipped-offline";

export interface RatingOutcomeInput {
  /** 题目是否已转为 riff 卡（有 blockId 且能查到 cardId） */
  hasCard: boolean;
  /** 内核是否在线 */
  kernelOnline: boolean;
  /** 自评映射是否合法（非法自评→不发请求） */
  ratingValid: boolean;
  /** 写回结果：ok=成功；timeout/network=结果不明（可重试）；fatal=明确失败 */
  writeResult?: "ok" | "timeout" | "network" | "fatal" | null;
}

export interface RatingOutcomeView {
  outcome: RatingOutcome;
  /** 是否已完成（终态：不需要用户再做动作） */
  terminal: boolean;
  /** 是否需要先核对内核状态再决定（超时/结果不明） */
  needsConfirm: boolean;
  /** 是否可安全重试（fatal/离线恢复后；timeout 必须先核对） */
  canRetry: boolean;
  /** 中文状态名（UI chip 用） */
  label: string;
  /** 如实说明（不夸大成功、不隐瞒失败） */
  note: string;
}

const VIEWS: Record<RatingOutcome, Omit<RatingOutcomeView, "outcome">> = {
  "not-a-card": {
    terminal: true,
    needsConfirm: false,
    canRetry: false,
    label: "未转卡",
    note: "该题尚未转为闪卡，本次只记录练习流水，不影响内核复习计划。",
  },
  recorded: {
    terminal: true,
    needsConfirm: false,
    canRetry: false,
    label: "已写回",
    note: "自评已成功写回内核调度。",
  },
  "pending-confirm": {
    terminal: false,
    needsConfirm: true,
    canRetry: false,
    label: "待确认",
    note: "请求结果不明（超时/网络中断）。已先记录练习流水；需核对内核该卡最近复习状态后再决定是否重写，不盲目重放。",
  },
  failed: {
    terminal: false,
    needsConfirm: false,
    canRetry: true,
    label: "写回失败",
    note: "写回内核调度失败，本次自评已记录但未影响复习计划；可按原评级重试。",
  },
  "skipped-offline": {
    terminal: false,
    needsConfirm: false,
    canRetry: true,
    label: "离线未写回",
    note: "当前内核离线，本次不写回调度；恢复连接后可重试。",
  },
};

/** 由事实推导评级结果状态（纯函数；顺序即优先级）。 */
export function ratingOutcome(input: RatingOutcomeInput): RatingOutcomeView {
  const base = (o: RatingOutcome): RatingOutcomeView => ({ outcome: o, ...VIEWS[o] });

  // 非法自评：不发请求，也不产生任何调度副作用（39-01）
  if (!input.ratingValid) return base("not-a-card");
  // 未转卡：只记流水，不谈写回
  if (!input.hasCard) return base("not-a-card");
  // 离线：明确跳过，不假装成功
  if (!input.kernelOnline) return base("skipped-offline");

  switch (input.writeResult) {
    case "ok":
      return base("recorded");
    case "timeout":
    case "network":
      return base("pending-confirm");
    case "fatal":
      return base("failed");
    default:
      // 尚未发起请求（例如等待中）：按待确认呈现，避免乐观显示成功
      return base("pending-confirm");
  }
}

/** 网络/超时类错误 → 结果不明（需核对）；其余 → 明确失败。用于把异常归类。 */
export function classifyWriteError(err: unknown): "timeout" | "network" | "fatal" {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/timeout|timed out|abort/i.test(msg)) return "timeout";
  if (/ECONN|network|fetch failed|failed to fetch|connection reset|socket|503|502|504/i.test(msg)) return "network";
  return "fatal";
}

// ---------- 幂等与防重复提交 ----------

/** 本次评分唯一键：同会话 + 同题 + 同评级只允许一条流水（防双击/重复提交） */
export function ratingAttemptKey(sessionId: string, qid: string, selfRating: number): string {
  return `${sessionId}::${qid}::${selfRating}`;
}

/** 内存幂等器：已处理的评分键集合。用于 UI 层防双击，不承担持久化职责。 */
export class RatingGuard {
  private readonly done = new Set<string>();
  /** 正在处理中的键（请求在途，先占位再放行，避免双击并发） */
  private readonly inflight = new Set<string>();

  /** 尝试占用：返回 false 表示应忽略本次点击（已完成或正在处理） */
  tryAcquire(key: string): boolean {
    if (this.done.has(key) || this.inflight.has(key)) return false;
    this.inflight.add(key);
    return true;
  }

  /** 标记完成：幂等键生效，后续同键点击被忽略 */
  settle(key: string, ok: boolean): void {
    this.inflight.delete(key);
    if (ok) this.done.add(key);
  }

  has(key: string): boolean {
    return this.done.has(key);
  }

  clear(): void {
    this.done.clear();
    this.inflight.clear();
  }
}

// ---------- 待确认队列（不盲重放；先核对） ----------

export interface PendingRatingWrite {
  qid: string;
  blockId: string;
  deckId: string;
  cardId: string;
  /** 本次自评映射到的合法评级（1-4） */
  rating: 1 | 2 | 3 | 4;
  sessionId: string;
  /** 申请写回的时间（核对时据内核 LastReview 判断是否已落库） */
  requestedAt: number;
}

/** 待确认项：附核对提示（不直接重放，必须先看内核状态） */
export function pendingConfirmHint(p: PendingRatingWrite): string {
  return `题 ${p.qid} 的评级（${p.rating}）在 ${new Date(p.requestedAt).toLocaleString()} 结果不明；请核对内核该卡最近复习时间后再决定是否重写。`;
}

/**
 * 是否需要重写：核对该卡内核 LastReview 与申请时间。
 * 若内核最近复习时间不早于申请时间，说明已落库 → 不重放（幂等）。
 * 否则为未落库 → 允许重写。
 */
export function shouldReplay(
  pending: Pick<PendingRatingWrite, "requestedAt">,
  kernelLastReviewMs: number | null | undefined,
  skewMs = 5_000,
): boolean {
  if (kernelLastReviewMs == null || !Number.isFinite(kernelLastReviewMs)) return true; // 查不到 → 允许重写
  return kernelLastReviewMs < pending.requestedAt - skewMs;
}
