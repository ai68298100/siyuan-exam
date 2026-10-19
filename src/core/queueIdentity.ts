// ============================================================
// 39-02 队列身份与写回语义（Queue Identity & Write-back Semantics）
// 定案依据 docs/adr/0003-one-scheduler-three-forms.md：
//   - cram 队列永不写回调度（Anki reschedule-off 语义）
//   - 普通练习/预览不暗改调度，不凭选择题正确静默推断 Easy
//   - 保留 due 卡身份：到期复习与普通练习在流水里必须可区分
// 此前 UI 只区分 wrong/其余，导致 cram、daily、fav、quick 在流水里全部被记为
// "normal" —— 既无法回溯「这次是内核对到期卡的复习」，也让「cram 是否写回」
// 这一验收点无从核对。本模块把「会话模式 → 队列身份」与「该队列是否可写回
// 内核调度」收成单一真相源，纯函数无 IO。
// ============================================================

/** 流水中记录的队列身份（AttemptEvent.queue 的完整取值域） */
export type QueueKind = "normal" | "wrong" | "cram";

/** 队列身份语义：写回策略与说明 */
export interface QueueSemantics {
  kind: QueueKind;
  /** 中文名（用于界面与导出标注） */
  label: string;
  /** 是否允许写回内核 riff 调度（cram 恒 false；普通练习/预览也不得暗改） */
  writesBack: boolean;
  /** 该队列的调度身份说明（结算「是否调用 riff」的如实回执） */
  note: string;
}

/**
 * 会话模式（UI 传入 startDrill/startSession 的 mode 字符串）→ 队列身份。
 *
 * 映射依据（与 UI 现有 mode 取值一一对应，见 PracticeTab startDrill）：
 *   - "wrong"                                     → wrong（错题重练；保留错题身份）
 *   - "cram" / "cramDrill" / "sprint"             → cram（冲刺：永不写回调度）
 *   - "quick" / "daily" / "fav" / "challenge" /
 *     "paper" / "practice" / "review" / 未知     → normal（普通练习；不暗改调度）
 *
 * 设计取舍：未知模式一律归 normal（不写回），而不是猜测成 cram。
 * 因为「不写回」是普通练习的既有语义，误判成 cram 会丢失错题/复习身份，
 * 误判成 normal 只会少一次写回机会——后者更保守、可回溯。
 */
export function queueKindOf(mode: string | null | undefined): QueueKind {
  const m = String(mode ?? "").trim().toLowerCase();
  if (m === "wrong") return "wrong";
  if (m === "cram" || m === "cramdrill" || m === "sprint" || m === "cram-drill") return "cram";
  return "normal";
}

const SEMANTICS: Record<QueueKind, QueueSemantics> = {
  normal: {
    kind: "normal",
    label: "普通练习",
    writesBack: false,
    note: "普通练习不写回内核调度；仅记录作答流水与错题，不暗改复习计划。",
  },
  wrong: {
    kind: "wrong",
    label: "错题重练",
    writesBack: false,
    note: "错题重练保留错题身份，不写回内核调度；错题消灭按独立口径处理。",
  },
  cram: {
    kind: "cram",
    label: "冲刺复习",
    writesBack: false,
    note: "冲刺队列永不写回调度（Anki reschedule-off 语义），原复习计划保持不变。",
  },
};

/** 取队列语义（含写回策略与如实说明） */
export function queueSemantics(mode: string | null | undefined): QueueSemantics {
  return SEMANTICS[queueKindOf(mode)];
}

/**
 * 39-02 写回门控：该会话模式是否允许写回内核 riff 调度。
 * 恒为 false —— 当前所有练习/复习队列都不写回；只有「背诵场景下用户对
 * 已转卡题目显式自评」（reciteAnswer）才写回，那是另一条独立路径。
 * 保留本函数是为了让「不写回」成为可被测试与复核的显式契约，而不是靠
 * 调用方到处漏掉写回调用。
 */
export function allowsSchedulerWriteBack(mode: string | null | undefined): boolean {
  void mode;
  return false;
}

/** 结算/导出用的一行回执：明确「是否调用 riff」，避免语言含糊 */
export function writeBackReceipt(mode: string | null | undefined, modeWritten?: boolean): string {
  const sem = queueSemantics(mode);
  if (modeWritten) {
    return `${sem.label}：本次写回内核调度（${sem.note}）`;
  }
  return `${sem.label}：本次不写回内核调度。${sem.note}`;
}

/** 统计筛选：按队列身份聚合作答（供结算与报告核对队列占比） */
export function countByQueue(events: readonly { queue?: QueueKind }[]): Record<QueueKind, number> {
  const out: Record<QueueKind, number> = { normal: 0, wrong: 0, cram: 0 };
  for (const e of events) {
    out[queueKindOf(e.queue)]++;
  }
  return out;
}
