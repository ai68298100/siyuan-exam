// ============================================================
// 学习资料对象（TODO 120-01/02/06 lite，docs/19 S2/Q7 地基）：
// materialId/revision 与存储位置（locations）分离——同一文件可有多个位置，
// 学习记录只挂 materialId；文件名/课程名不是稳定身份（同指纹位置去重登记）。
// 纯函数无 IO：登记/合并/解析 URL/体积守卫，headless 可测。
// 本批边界：assets 拷贝与 link 登记 + 最低打开；local 路径、页/时间点 locator、
// 个人笔记、AI 片段提取均留后续（121-02/03、122-02/03）。
// ============================================================
import { newMaterialId } from "./ids";

export type MaterialKind = "pdf" | "video" | "audio" | "image" | "doc" | "other";
export type LocationKind = "assets" | "link";

/** 存储位置（120-01）：assets=工作区附件（内核可服务）；link=外部稳定 URL。
 *  local（本地/网盘路径）按 123 组条件接入，本批不开放以免伪造可打开性 */
export interface MaterialLocation {
  kind: LocationKind;
  /** assets: 工作区相对路径（"/assets/lv-exam/xxx.pdf"）；link: 完整 URL */
  path: string;
  addedAt: number;
}

/** 资料对象：identity=materialId；revision=内容版本（重拷贝/换版 +1，定位与笔记回链的依据） */
export interface MaterialDoc {
  id: string; // m-xxxxxxxx
  revision: number;
  title: string;
  kind: MaterialKind;
  subject?: string; // 科目/课程（120-02 登记字段 lite，自由文本）
  chapter?: string; // 章节（lite 自由文本；结构化章节树留 120-05）
  locations: MaterialLocation[];
  createdAt: number;
  updatedAt: number;
}

export interface MaterialRegistry {
  v: 1;
  materials: MaterialDoc[];
}

export const EMPTY_REGISTRY: MaterialRegistry = { v: 1, materials: [] };

/** 大文件不默认全拷贝（120-03 验收）：assets 拷贝上限 30MB，超出如实拒绝（可改用 link 登记） */
export const ASSETS_COPY_LIMIT_BYTES = 30 * 1024 * 1024;

/** 登记输入（app 层从文件选择/URL 构造） */
export interface RegisterInput {
  title: string;
  kind: MaterialKind;
  subject?: string;
  chapter?: string;
  location: { kind: LocationKind; path: string };
}

// ---------- 工具 ----------

/** 扩展名 → 资料类型（未知 → other，不猜） */
export function kindFromFileName(name: string): MaterialKind {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (ext === "pdf") return "pdf";
  if (["mp4", "webm", "m4v", "mov", "avi", "mkv"].includes(ext)) return "video";
  if (["mp3", "m4a", "wav", "ogg", "flac", "aac"].includes(ext)) return "audio";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) return "image";
  if (["md", "txt", "docx", "doc", "epub", "html"].includes(ext)) return "doc";
  return "other";
}

/** 字节 → 可读体积（登记列表与超限提示用） */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function canCopyIntoAssets(sizeBytes: number): { ok: boolean; reason?: string } {
  if (sizeBytes <= 0) return { ok: false, reason: "空文件不入库" };
  if (sizeBytes > ASSETS_COPY_LIMIT_BYTES) {
    return { ok: false, reason: `文件 ${formatBytes(sizeBytes)} 超过拷贝上限 ${formatBytes(ASSETS_COPY_LIMIT_BYTES)}（大文件不默认全拷贝，可改用链接登记）` };
  }
  return { ok: true };
}

/**
 * 位置解析为可打开 URL（120-06 最低查看）：
 * - assets → 内核静态服务 `${origin}/assets/...`（PDF/媒体浏览器原生可看）；
 * - link → 原样返回；
 * - 无法解析（空路径）→ null（调用方如实显示不可打开，不伪造）。
 */
export function resolveMaterialUrl(loc: MaterialLocation, origin: string): string | null {
  if (loc.kind === "link") return /^https?:\/\//i.test(loc.path) ? loc.path : null;
  const trimmed = loc.path.trim();
  if (!trimmed) return null;
  // 登记路径即工作区根路径（/assets/...）；历史/手输的裸相对路径补前缀，避免双 /assets/
  const rooted = /^\/?(assets\/)/.test(trimmed)
    ? `/${trimmed.replace(/^\/+/, "")}`
    : `/assets/${trimmed.replace(/^\/+/, "")}`;
  return `${origin.replace(/\/+$/, "")}${rooted}`;
}

/** assets 登记路径（app 层 putFile 目标）：/assets/lv-exam/<时间戳>-<安全文件名> */
export function assetsPathFor(fileName: string, now = Date.now()): string {
  const safe = fileName.replace(/[\\/:*?"<>|#{}]/g, "_").replace(/\s+/g, "_").slice(-120) || "material";
  return `/assets/lv-exam/${now}-${safe}`;
}

// ---------- 登记与合并（120-01：同一文件不产生第二条学习记录） ----------

export interface RegisterResult {
  registry: MaterialRegistry;
  material: MaterialDoc;
  /** true=该位置已登记过（返回既有对象，不新建——文件名/课程名不构成新身份） */
  deduped: boolean;
}

export function registerMaterial(
  registry: MaterialRegistry,
  input: RegisterInput,
  now = Date.now(),
): RegisterResult {
  if (!input.title.trim()) throw new Error("资料标题为空");
  if (!input.location.path.trim()) throw new Error("资料位置为空");
  const path = input.location.path.trim();
  const existing = registry.materials.find((m) =>
    m.locations.some((l) => l.kind === input.location.kind && l.path === path),
  );
  if (existing) return { registry, material: existing, deduped: true };
  const material: MaterialDoc = {
    id: newMaterialId(),
    revision: 1,
    title: input.title.trim(),
    kind: input.kind,
    subject: input.subject?.trim() || undefined,
    chapter: input.chapter?.trim() || undefined,
    locations: [{ kind: input.location.kind, path, addedAt: now }],
    createdAt: now,
    updatedAt: now,
  };
  return { registry: { v: 1, materials: [...registry.materials, material] }, material, deduped: false };
}

/** 为既有资料追加位置（同一 PDF 的第二份副本/镜像链接）；同位置重复添加为无操作 */
export function attachLocation(
  registry: MaterialRegistry,
  materialId: string,
  loc: { kind: LocationKind; path: string },
  now = Date.now(),
): { registry: MaterialRegistry; material: MaterialDoc | null; deduped: boolean } {
  const material = registry.materials.find((m) => m.id === materialId);
  if (!material) return { registry, material: null, deduped: false };
  const path = loc.path.trim();
  if (material.locations.some((l) => l.kind === loc.kind && l.path === path)) {
    return { registry, material, deduped: true };
  }
  const next: MaterialDoc = {
    ...material,
    locations: [...material.locations, { kind: loc.kind, path, addedAt: now }],
    updatedAt: now,
  };
  return {
    registry: { v: 1, materials: registry.materials.map((m) => (m.id === materialId ? next : m)) },
    material: next,
    deduped: false,
  };
}

/** 内容版本推进（重拷贝/换版）：revision+1，locator 与笔记回链据此判定待重定位 */
export function bumpRevision(registry: MaterialRegistry, materialId: string, now = Date.now()): MaterialRegistry {
  return {
    v: 1,
    materials: registry.materials.map((m) =>
      m.id === materialId ? { ...m, revision: m.revision + 1, updatedAt: now } : m,
    ),
  };
}

export function removeMaterial(registry: MaterialRegistry, materialId: string): MaterialRegistry {
  return { v: 1, materials: registry.materials.filter((m) => m.id !== materialId) };
}

// ---------- 序列化（petal 存储：materials/registry） ----------

export function serializeRegistry(registry: MaterialRegistry): MaterialRegistry {
  return { v: 1, materials: registry.materials };
}

/** 读回容错：缺 v（历史裸数组不适用，本键自始带信封）或更高版本 → 空注册表 + 标记（不降级覆盖写） */
export function parseRegistry(raw: unknown): { registry: MaterialRegistry; versionTooNew: boolean } {
  if (!raw || typeof raw !== "object") return { registry: EMPTY_REGISTRY, versionTooNew: false };
  const v = (raw as { v?: number }).v;
  if (v == null) return { registry: EMPTY_REGISTRY, versionTooNew: false };
  if (v > 1) return { registry: EMPTY_REGISTRY, versionTooNew: true };
  const materials = Array.isArray((raw as { materials?: unknown }).materials)
    ? ((raw as { materials: MaterialDoc[] }).materials.filter((m) => m && typeof m.id === "string" && Array.isArray(m.locations)))
    : [];
  return { registry: { v: 1, materials }, versionTooNew: false };
}
