// ============================================================
// 考试→打卡最小单向桥（TODO 48-03 lite）：契约来源 小驴打卡/docs/api-v5.md（稳定版，2026-10-04 核对）
// - 探测三步：window.siyuanCheckin + protocol==="siyuan-checkin" → whenReady() → hasCapability("events.record")
// - 写入：source 恒为 "api"（写入仅接受 "api"）；返回 undefined 一律=未写入，须以原 externalRef 重试
// - 幂等：externalRef = "exam:<itemId>:<localDate>"（每日一次；前缀 "exam:" 尚未在打卡侧登记——
//   identity-and-merge.md 治理步骤待办，见 TODO 48-03 注记）
// - 红线：失败保留原引用重试（不生成新随机引用）；用户未配置 itemId 时桥不生效
// ============================================================

export interface CheckinBridgeConfig {
  /** 打卡项目 ID（用户在设置中填写；空 = 桥关闭） */
  itemId: string;
  /** 每日达标题数（≤0 时回退调用方的每日目标） */
  threshold: number;
}

export interface CheckinEventInput {
  itemId: string;
  value: number;
  unit: string;
  source: "api";
  externalRef: string;
  note?: string;
  occurredAt: string;
}

export function localDateKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 桥是否生效（用户配置了 itemId 才算开启；阈值 ≤0 回退默认值由调用方决定） */
export function bridgeEnabled(cfg: CheckinBridgeConfig): boolean {
  return cfg.itemId.trim().length > 0;
}

/** 达标判定：当日作答题数 ≥ 阈值 */
export function shouldCheckin(todayAttempts: number, cfg: CheckinBridgeConfig, fallbackGoal: number): boolean {
  const threshold = cfg.threshold > 0 ? cfg.threshold : Math.max(1, fallbackGoal);
  return todayAttempts >= threshold;
}

/** 构造打卡事件（幂等身份：exam:<itemId>:<localDate>，同日永远同一引用） */
export function buildCheckinEvent(
  cfg: CheckinBridgeConfig,
  todayAttempts: number,
  nowMs: number,
): CheckinEventInput {
  const localDate = localDateKeyOf(nowMs);
  return {
    itemId: cfg.itemId.trim(),
    value: todayAttempts,
    unit: "题",
    source: "api",
    externalRef: `exam:${cfg.itemId.trim()}:${localDate}`,
    note: "小驴考试每日练习",
    occurredAt: new Date(nowMs).toISOString(),
  };
}

/** 打卡公开 API 的最小消费面（防御性 typing；完整契约见打卡 docs/api-v5.md） */
export interface CheckinApiV5 {
  protocol: string;
  whenReady?: () => Promise<void> | void;
  hasCapability?: (name: string) => boolean;
  recordEvent?: (input: CheckinEventInput) => CheckinEventRecord | undefined;
}

export interface CheckinEventRecord {
  eventId?: string;
}

export type CheckinSyncStatus =
  | "disabled" // 用户未配置 itemId
  | "no-api" // 打卡未安装/协议不符
  | "no-capability" // 未开放 events.record
  | "below-threshold" // 当日未达标
  | "synced" // 新写入
  | "duplicate" // 幂等命中（当日已同步过）
  | "pending"; // 写入失败 → 保留原引用待重试

/** 探测并返回可用 API（协议不符 → null） */
export function probeCheckinApi(w: unknown): CheckinApiV5 | null {
  const api = (w as { siyuanCheckin?: CheckinApiV5 })?.siyuanCheckin;
  if (!api || api.protocol !== "siyuan-checkin") return null;
  return api;
}

/** 同步一次打卡（幂等；调用方负责把 pending 状态持久化并在下次重试） */
export async function syncCheckin(
  api: CheckinApiV5 | null,
  cfg: CheckinBridgeConfig,
  todayAttempts: number,
  nowMs: number,
  fallbackGoal: number,
): Promise<{ status: CheckinSyncStatus; event?: CheckinEventInput }> {
  if (!bridgeEnabled(cfg)) return { status: "disabled" };
  if (!shouldCheckin(todayAttempts, cfg, fallbackGoal)) return { status: "below-threshold" };
  if (!api) return { status: "no-api" };
  try {
    await api.whenReady?.();
    if (api.hasCapability && !api.hasCapability("events.record")) return { status: "no-capability" };
    if (typeof api.recordEvent !== "function") return { status: "no-capability" };
    const event = buildCheckinEvent(cfg, todayAttempts, nowMs);
    const result = api.recordEvent(event); // undefined = 未写入（保留原 externalRef 重试，不换新引用）
    if (result === undefined) return { status: "pending", event };
    return { status: "synced", event }; // 新写入与幂等命中都视为已同步（duplicate 返回已有副本）
  } catch {
    return { status: "pending", event: buildCheckinEvent(cfg, todayAttempts, nowMs) };
  }
}
