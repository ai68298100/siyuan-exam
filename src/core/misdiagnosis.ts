// ============================================================
// AI 错因假设存储（TODO 116-01/U14：用户思路、事实与 AI 假设分别保存）：
// 假设独立持久化（ai/misdiagnosis 信封 v1），与用户复盘（wrongbook/reflections）
// 互不覆写；采纳行为只打时间戳（adoptedAt），审计可回溯。
// 同题保留最新一条（旧假设被新证据的重新生成取代）；上限 200 条 FIFO。
// ============================================================

export interface MisdiagnosisEvidence {
  myAnswer: string | null;
  confidence?: string; // "sure" | "fuzzy" | "guess"（宽存，历史兼容）
  timeMs?: number;
  helped?: boolean;
}

export interface MisdiagnosisRecord {
  qid: string;
  text: string; // AI 假设原文（三段式：事实/假设/验证行动）
  at: number;
  sessionId: string;
  templateVersion?: number;
  evidence: MisdiagnosisEvidence;
  adoptedAt?: number; // 用户并入复盘的时间（采纳是用户动作，AI 不代确认）
}

export interface MisdiagnosisStore {
  v: 1;
  items: MisdiagnosisRecord[];
}

export const EMPTY_MISDIAGNOSIS: MisdiagnosisStore = { v: 1, items: [] };
const MAX_ITEMS = 200;

export function addMisdiagnosis(
  store: MisdiagnosisStore,
  rec: MisdiagnosisRecord,
): MisdiagnosisStore {
  const clean: MisdiagnosisRecord = {
    ...rec,
    qid: rec.qid.trim(),
    text: rec.text.trim(),
    sessionId: rec.sessionId ?? "",
    evidence: { ...rec.evidence },
  };
  if (!clean.qid || !clean.text) throw new Error("错因假设缺少 qid 或文本");
  const others = store.items.filter((r) => r.qid !== clean.qid);
  return { v: 1, items: [...others, clean].slice(-MAX_ITEMS) };
}

export function latestOf(store: MisdiagnosisStore, qid: string): MisdiagnosisRecord | null {
  return store.items.find((r) => r.qid === qid) ?? null;
}

/** 采纳打点：仅记时间戳，不改假设原文、不动用户复盘 */
export function markAdopted(store: MisdiagnosisStore, qid: string, now = Date.now()): MisdiagnosisStore {
  return {
    v: 1,
    items: store.items.map((r) => (r.qid === qid ? { ...r, adoptedAt: now } : r)),
  };
}

export function serializeMisdiagnosis(store: MisdiagnosisStore): MisdiagnosisStore {
  return { v: 1, items: store.items };
}

export function parseMisdiagnosis(raw: unknown): { store: MisdiagnosisStore; versionTooNew: boolean } {
  if (!raw || typeof raw !== "object") return { store: EMPTY_MISDIAGNOSIS, versionTooNew: false };
  const v = (raw as { v?: number }).v;
  if (v == null) return { store: EMPTY_MISDIAGNOSIS, versionTooNew: false };
  if (v > 1) return { store: EMPTY_MISDIAGNOSIS, versionTooNew: true };
  const items = Array.isArray((raw as { items?: unknown }).items)
    ? ((raw as { items: MisdiagnosisRecord[] }).items.filter(
        (r) => r && typeof r.qid === "string" && typeof r.text === "string" && typeof r.at === "number",
      ))
    : [];
  return { store: { v: 1, items }, versionTooNew: false };
}
