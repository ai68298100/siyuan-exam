// ============================================================
// 小驴拾遗桥（60-01 lite）：稍后读 → AI 出题素材（只读，不写拾遗状态）
// 契约来源：小驴拾遗/docs/BRIDGE.md（对外桥接 v1 / D-0066，2026-10-04 核对实文）
// - 探测：window.siyuanGlean 且 apiVersion === 1（不满足 → 功能入口隐藏）
// - 读取：listClips({ status: "later", limit }) 只读；写接口（setClipStatus）本桥不使用
// - 红线：注入素材时标注来源（标题/URL/站点），不把剪藏正文当作已核实考据
// ============================================================

export interface GleanClip {
  id: string;
  title: string;
  url?: string;
  site?: string;
  summary?: string;
  status?: string;
}

export interface GleanBridgeV1 {
  apiVersion: 1;
  listClips?: (filter?: {
    status?: string;
    limit?: number;
  }) => Promise<GleanClip[]>;
  setClipStatus?: (id: string, status: "inbox" | "later" | "reading" | "done" | "archived") => Promise<void>;
}

/** 探测拾遗桥（apiVersion 必须为 1；不满足 → null，入口隐藏） */
export function probeGlean(w: unknown): GleanBridgeV1 | null {
  const g = (w as { siyuanGlean?: GleanBridgeV1 })?.siyuanGlean;
  if (!g || g.apiVersion !== 1) return null;
  if (typeof g.listClips !== "function") return null;
  return g;
}

/** 拉取稍后读清单（有界 limit，默认 10；失败 → 空数组，入口降级提示） */
export async function listLaterClips(g: GleanBridgeV1, limit = 10): Promise<GleanClip[]> {
  try {
    const clips = await g.listClips?.({ status: "later", limit });
    return Array.isArray(clips) ? clips.slice(0, limit) : [];
  } catch {
    return [];
  }
}

/** 素材格式化（纯函数）：标题+站点+URL+摘要，注入 AI 出题来源时自带出处可核对 */
export function formatClipsForSource(clips: GleanClip[]): string {
  if (!clips.length) return "";
  const lines = ["【拾遗稍后读素材】（来自小驴拾遗，出题时请核对原文）"];
  clips.forEach((c, i) => {
    const meta = [c.site, c.url].filter(Boolean).join(" · ");
    lines.push(`${i + 1}. 《${c.title || "无标题"}》${meta ? `（${meta}）` : ""}`);
    if (c.summary) lines.push(`   摘要：${c.summary}`);
  });
  return lines.join("\n");
}

/** 标记素材已读（60-01 写方向 lite）：用户显式点击后调用。
 *  契约：拾遗侧 `integration.bridgeWriteEnabled` 默认关闭——未开启/失败均返回 false，
 *  由 UI 提示"需在拾遗设置开启协同写入"，不静默重试不伪造成功。 */
export async function markClipDone(g: GleanBridgeV1, id: string): Promise<boolean> {
  if (typeof g.setClipStatus !== "function") return false;
  try {
    await g.setClipStatus(id, "done");
    return true;
  } catch {
    return false;
  }
}
