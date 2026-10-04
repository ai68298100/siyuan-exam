// ============================================================
// 题目↔资料关联（TODO 120-05 lite，docs/19 S2）：qid → materialId + locator。
// 存插件存储（不动题块 attrs，离线可写）；一题一主链（改链=替换）；
// 资料换版后按 revision 判「待重定位」；资料移除时孤儿关联一并清除。
// 纯函数无 IO；与笔记共用 NoteLocator/normalizeLocator 口径。
// ============================================================
import { normalizeLocator, revisionStale, type NoteLocator } from "./materialNotes";

export interface QuestionMaterialRef {
  qid: string;
  materialId: string; // m-xxxxxxxx
  revision: number; // 绑定时的资料版本
  locator: NoteLocator | null; // 页/时间点/引文（可空=只挂资料不定位）
  createdAt: number;
}

export interface MaterialLinkStore {
  v: 1;
  refs: QuestionMaterialRef[];
}

export const EMPTY_LINK_STORE: MaterialLinkStore = { v: 1, refs: [] };

export interface LinkInput {
  qid: string;
  materialId: string;
  revision: number;
  locator?: NoteLocator | null;
}

// ---------- CRUD ----------

/** 关联（一题一主链）：已有链 → 替换并返回 replaced=true；locator 传 {} 视为不定位 */
export function linkQuestion(
  store: MaterialLinkStore,
  input: LinkInput,
  now = Date.now(),
): { store: MaterialLinkStore; ref: QuestionMaterialRef; replaced: boolean } {
  const qid = input.qid.trim();
  if (!qid) throw new Error("缺少题目 qid");
  if (!input.materialId.trim()) throw new Error("缺少资料归属");
  if (!Number.isInteger(input.revision) || input.revision < 1) throw new Error("缺少有效的资料版本");
  const ref: QuestionMaterialRef = {
    qid,
    materialId: input.materialId.trim(),
    revision: input.revision,
    locator: normalizeLocator(input.locator ?? null),
    createdAt: now,
  };
  const replaced = store.refs.some((r) => r.qid === qid);
  const refs = replaced ? store.refs.map((r) => (r.qid === qid ? ref : r)) : [...store.refs, ref];
  return { store: { v: 1, refs }, ref, replaced };
}

export function unlinkQuestion(store: MaterialLinkStore, qid: string): { store: MaterialLinkStore; removed: boolean } {
  const refs = store.refs.filter((r) => r.qid !== qid);
  return { store: { v: 1, refs }, removed: refs.length !== store.refs.length };
}

export function refOf(store: MaterialLinkStore, qid: string): QuestionMaterialRef | null {
  return store.refs.find((r) => r.qid === qid) ?? null;
}

export function questionsOfMaterial(store: MaterialLinkStore, materialId: string): QuestionMaterialRef[] {
  return store.refs.filter((r) => r.materialId === materialId);
}

/** 待重定位（120-05：题目回链换版后提示校对，不冒充仍定位） */
export function linkNeedsRelocate(ref: QuestionMaterialRef, currentRevision: number): boolean {
  return revisionStale(ref.revision, currentRevision);
}

/** 资料移除后的孤儿清理（纯函数部分；持久化由调用方负责） */
export function dropMaterial(store: MaterialLinkStore, materialId: string): MaterialLinkStore {
  return { v: 1, refs: store.refs.filter((r) => r.materialId !== materialId) };
}

// ---------- 序列化（petal 存储：materials/qrefs） ----------

export function serializeLinkStore(store: MaterialLinkStore): MaterialLinkStore {
  return { v: 1, refs: store.refs };
}

export function parseLinkStore(raw: unknown): { store: MaterialLinkStore; versionTooNew: boolean } {
  if (!raw || typeof raw !== "object") return { store: EMPTY_LINK_STORE, versionTooNew: false };
  const v = (raw as { v?: number }).v;
  if (v == null) return { store: EMPTY_LINK_STORE, versionTooNew: false };
  if (v > 1) return { store: EMPTY_LINK_STORE, versionTooNew: true };
  const refs = Array.isArray((raw as { refs?: unknown }).refs)
    ? ((raw as { refs: QuestionMaterialRef[] }).refs.filter(
        (r) => r && typeof r.qid === "string" && typeof r.materialId === "string" && typeof r.revision === "number",
      ))
    : [];
  return { store: { v: 1, refs }, versionTooNew: false };
}
