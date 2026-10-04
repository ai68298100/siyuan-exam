// ============================================================
// 资料定位与个人笔记（TODO 121-02/03 + 122-02/03 lite，U28 前半）：
// 笔记绑定 materialId+revision 与页码/时间点 locator——与 PDF/媒体原件分开存储，
// 无阅读插件/媒体插件也能编辑（U28）。原件换版后按 revision 判定「待重定位」，
// 不静默断链也不冒充仍定位（121-02 验收）。
// 纯函数无 IO；locator 解析/URL 片段拼接供「定位打开」复用。
// ============================================================
import { newMaterialNoteId } from "./ids";

/** 定位器：页码（PDF/文档）或秒（视频/音频）或短引文；可并存（如 引文+页） */
export interface NoteLocator {
  page?: number; // 物理页（1-based；印刷页差异 U28 后续处理）
  tSec?: number; // 时间点（秒，≥0）
  quote?: string; // 短引文（≤120 字截断存储）
}

export interface MaterialNote {
  id: string; // n-xxxxxxxx
  materialId: string; // m-xxxxxxxx（笔记挂在资料上）
  revision: number; // 创建时绑定的资料版本（原件 bumpRevision 后旧笔记待重定位）
  locator: NoteLocator | null;
  text: string; // 用户注释/疑问（自己的话，与解析/AI 讲解无关）
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface MaterialNoteStore {
  v: 1;
  notes: MaterialNote[];
}

export const EMPTY_NOTE_STORE: MaterialNoteStore = { v: 1, notes: [] };

// ---------- 输入整形 ----------

export interface NoteInput {
  materialId: string;
  revision: number;
  locator?: NoteLocator | null;
  text: string;
  tags?: string[];
}

/** 规范化输入：text 去空白且必填、页码 ≥1、秒 ≥0、引文截 120、标签去空去重（上限 8） */
export function normalizeNoteInput(input: NoteInput): NoteInput {
  const text = input.text.trim();
  if (!text) throw new Error("笔记内容为空");
  if (!input.materialId) throw new Error("笔记缺少资料归属");
  if (!Number.isInteger(input.revision) || input.revision < 1) throw new Error("笔记缺少有效的资料版本");
  const loc = input.locator ?? null;
  if (loc) {
    if (loc.page != null && (!Number.isFinite(loc.page) || loc.page < 1)) throw new Error("页码需为 ≥1 的整数");
    if (loc.tSec != null && (!Number.isFinite(loc.tSec) || loc.tSec < 0)) throw new Error("时间点需 ≥0 秒");
    if (loc.page == null && loc.tSec == null && !(loc.quote ?? "").trim()) {
      throw new Error("定位需至少含页码/时间点/引文之一");
    }
  }
  const tags = [...new Set((input.tags ?? []).map((t) => t.trim()).filter(Boolean))].slice(0, 8);
  const quote = loc?.quote?.trim().slice(0, 120) || undefined;
  return {
    materialId: input.materialId,
    revision: input.revision,
    locator: loc ? { page: loc.page, tSec: loc.tSec, quote } : null,
    text,
    tags,
  };
}

// ---------- CRUD（返回新 store，不原地改） ----------

export function addNote(store: MaterialNoteStore, input: NoteInput, now = Date.now()): { store: MaterialNoteStore; note: MaterialNote } {
  const n = normalizeNoteInput(input);
  const note: MaterialNote = {
    id: newMaterialNoteId(),
    materialId: n.materialId,
    revision: n.revision,
    locator: n.locator ?? null,
    text: n.text,
    tags: n.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
  return { store: { v: 1, notes: [...store.notes, note] }, note };
}

/** 编辑：仅更新提供的字段；materialId/revision 绑定不变（换绑=删除重记，不静默迁移） */
export function updateNote(
  store: MaterialNoteStore,
  noteId: string,
  patch: { locator?: NoteLocator | null; text?: string; tags?: string[] },
  now = Date.now(),
): { store: MaterialNoteStore; note: MaterialNote | null } {
  const prev = store.notes.find((n) => n.id === noteId);
  if (!prev) return { store, note: null };
  const merged = normalizeNoteInput({
    materialId: prev.materialId,
    revision: prev.revision,
    locator: patch.locator !== undefined ? patch.locator : prev.locator,
    text: patch.text !== undefined ? patch.text : prev.text,
    tags: patch.tags !== undefined ? patch.tags : prev.tags,
  });
  const next: MaterialNote = {
    ...prev,
    locator: merged.locator ?? null,
    text: merged.text,
    tags: merged.tags ?? [],
    updatedAt: now,
  };
  return { store: { v: 1, notes: store.notes.map((n) => (n.id === noteId ? next : n)) }, note: next };
}

export function deleteNote(store: MaterialNoteStore, noteId: string): MaterialNoteStore {
  return { v: 1, notes: store.notes.filter((n) => n.id !== noteId) };
}

export function notesOfMaterial(store: MaterialNoteStore, materialId: string): MaterialNote[] {
  return store.notes.filter((n) => n.materialId === materialId);
}

// ---------- 版本对账（121-02：换版后标待重定位，不冒充仍定位） ----------

/** 原件 revision 与笔记绑定不一致 → 待重定位（显示提示，不自动改绑） */
export function needsRelocate(note: MaterialNote, currentRevision: number): boolean {
  return note.revision !== currentRevision;
}

// ---------- locator 展示与 URL 片段 ----------

/** mm:ss / h:mm:ss → 秒；非法输入抛错（调用方给可行动提示） */
export function parseTimeToSec(s: string): number {
  const t = s.trim();
  if (!/^\d{1,2}(:\d{1,2}){0,2}$/.test(t)) throw new Error(`时间格式应为 mm:ss，得到「${s}」`);
  const parts = t.split(":").map(Number);
  if (parts.length === 3) {
    const [h, m, sec] = parts;
    if (m > 59 || sec > 59) throw new Error(`分/秒越界（≤59）：「${s}」`);
    return h * 3600 + m * 60 + sec;
  }
  const [m, sec] = parts;
  if (parts.length === 2 && (sec > 59 || m > 59)) throw new Error(`分/秒越界（≤59）：「${s}」`);
  if (parts.length === 2) return m * 60 + sec;
  return parts[0];
}

/** 秒 → mm:ss（<1h）或 h:mm:ss */
export function formatSecToTime(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** locator 的人读标签：P12 / 12:05 / 「引文…」组合 */
export function locatorLabel(loc: NoteLocator | null): string {
  if (!loc) return "";
  const parts: string[] = [];
  if (loc.page != null) parts.push(`P${loc.page}`);
  if (loc.tSec != null) parts.push(formatSecToTime(loc.tSec));
  if (loc.quote) parts.push(`「${loc.quote.slice(0, 20)}${loc.quote.length > 20 ? "…" : ""}」`);
  return parts.join(" · ");
}

/** 去掉既有定位片段/查询（幂等重拼，不重复追加 #page/#t） */
function baseAssetUrl(url: string): string {
  return url.split("#")[0];
}

/**
 * 定位打开（120-06 navigate 面 lite）：
 * - PDF → `#page=N` 片段（Chromium/内嵌查看器支持跳页）；
 * - 音视频 → `#t=秒` 媒体片段（浏览器原生支持 seek）；
 * - 无定位 → 原样返回。仅对 http(s) URL 生效，其余返回 null（不伪造可打开）。
 */
export function locatedUrl(url: string | null, loc: NoteLocator | null): string | null {
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  if (!loc || (loc.page == null && loc.tSec == null)) return url;
  const base = baseAssetUrl(url);
  if (loc.page != null) return `${base}#page=${loc.page}`;
  return `${base}#t=${Math.round(loc.tSec!)}`;
}

// ---------- 序列化（petal 存储：materials/notes） ----------

export function serializeNoteStore(store: MaterialNoteStore): MaterialNoteStore {
  return { v: 1, notes: store.notes };
}

/** 读回容错：过版本 → 空表+标记（不降级覆盖）；非法条目剔除 */
export function parseNoteStore(raw: unknown): { store: MaterialNoteStore; versionTooNew: boolean } {
  if (!raw || typeof raw !== "object") return { store: EMPTY_NOTE_STORE, versionTooNew: false };
  const v = (raw as { v?: number }).v;
  if (v == null) return { store: EMPTY_NOTE_STORE, versionTooNew: false };
  if (v > 1) return { store: EMPTY_NOTE_STORE, versionTooNew: true };
  const notes = Array.isArray((raw as { notes?: unknown }).notes)
    ? ((raw as { notes: MaterialNote[] }).notes.filter(
        (n) => n && typeof n.id === "string" && typeof n.materialId === "string" && typeof n.text === "string",
      ))
    : [];
  return { store: { v: 1, notes }, versionTooNew: false };
}
