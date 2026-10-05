// ============================================================
// 改答轨迹（TODO 63-03，细化 40-03/44-02）：
// 保留首次答案、每次修改（终答=提交的 myAnswer）与修改原因
// （unsure=不确定 / evidence=发现证据 / misclick=误触；未选择原因则缺省）。
// 纯函数不可变更新；edits 上限截断（MAX_TRAIL_EDITS）并如实标注 truncated。
// 边界（63-03）：不以改答次数判定能力或粗心；值回到已记录值（取消）不产生轨迹事件。
// ============================================================

export type EditReason = "unsure" | "evidence" | "misclick";

export interface AnswerEdit {
  to: string;
  reason?: EditReason;
}

export interface AnswerTrail {
  first: string;
  edits: AnswerEdit[];
  truncated?: boolean;
}

export const MAX_TRAIL_EDITS = 10;

export function startTrail(first: string): AnswerTrail {
  return { first, edits: [] };
}

/** 当前轨迹值（终答候选）：最后一次修改的目标值；无修改 = 首答 */
export function trailValue(trail: AnswerTrail): string {
  return trail.edits.length ? trail.edits[trail.edits.length - 1].to : trail.first;
}

/** 轨迹是否发生过改答（终答 ≠ 首答；值回到首答 = 未改答，取消语义） */
export function trailChanged(trail: AnswerTrail): boolean {
  return trail.edits.length > 0 && trailValue(trail) !== trail.first;
}

/** 记录一次修改：值与当前轨迹值相同（取消/重复）→ 原样返回不产生事件；
 *  超上限 → 停止记录并标注 truncated（如实：轨迹不完整）。 */
export function recordEdit(trail: AnswerTrail, to: string, reason?: EditReason): AnswerTrail {
  const value = String(to ?? "").trim();
  if (!value || value === trailValue(trail)) return trail;
  if (trail.edits.length >= MAX_TRAIL_EDITS) return { ...trail, truncated: true };
  return { first: trail.first, edits: [...trail.edits, { to: value, ...(reason ? { reason } : {}) }], truncated: trail.truncated };
}

/** 给最后一次修改补记原因（修改后弹出原因选择时调用；未选=缺省） */
export function withLastEditReason(trail: AnswerTrail, reason: EditReason): AnswerTrail {
  if (!trail.edits.length) return trail;
  const edits = trail.edits.slice(0, -1).concat({ ...trail.edits[trail.edits.length - 1], reason });
  return { first: trail.first, edits, truncated: trail.truncated };
}

/** 事件流 → 改答题清单（63-03 验收：报告区分首答与终答）。只列终答≠首答的作答，按时间倒序。 */
export function changedAnswerList(
  events: readonly {
    qid: string;
    myAnswer: string | null;
    firstAnswer?: string;
    edits?: AnswerEdit[];
    ts: number;
  }[],
  limit = 50,
): { qid: string; first: string; final: string; editCount: number; reasons: string[]; ts: number }[] {
  const byQid = new Map<string, { qid: string; first: string; final: string; editCount: number; reasons: string[]; ts: number }>();
  for (const e of events) {
    if (!e.firstAnswer) continue;
    const final = String(e.myAnswer ?? "");
    if (final === e.firstAnswer) continue;
    byQid.set(e.qid, {
      qid: e.qid,
      first: e.firstAnswer,
      final,
      editCount: e.edits?.length ?? 0,
      reasons: (e.edits ?? []).map((x) => x.reason).filter((x): x is NonNullable<typeof x> => !!x),
      ts: e.ts,
    });
  }
  return [...byQid.values()].sort((a, b) => b.ts - a.ts).slice(0, limit);
}
