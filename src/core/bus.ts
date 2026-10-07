// ============================================================
// lv-exam:* 事件总线雏形（TODO 2.1 ExamEventBus / 47-04 / 48-02 的地基）
// 统一信封：schemaVersion + type + 幂等 eventId + 时间戳 + payload；
// 载体仍是 window CustomEvent（同窗口 Tab 间移交），后续跨插件协议在此版本化扩展。
// 红线：payload 只放移交 id/上下文，不放题干/答案/key/path（47-04 验收口径）。
// ============================================================

export const BUS_PREFIX = "lv-exam:";

export interface BusEvent<T extends Record<string, unknown> = Record<string, unknown>> {
  /** schema 版本：消费者按版本容错（忽略未知字段） */
  v: 1;
  /** 来源标识（48-02：生态消费者可按来源过滤/甄别） */
  source: "siyuan-exam";
  type: string;
  /** 幂等 id：重放/去重依据（同窗口多 Tab 不重复写入的锚点） */
  eventId: string;
  at: number;
  payload: T;
}

/** 事件名 → 总线类型（已登记事件白名单；新增事件必须在此登记） */
export type BusEventType =
  | "open-question" // {qid} Dock/错题本 → 练习台单题会话
  | "open-in-browse" // {qid, bank} 块菜单 → 浏览视图聚焦
  | "edit-question" // {qid, bank} 块菜单 → 浏览视图编辑
  | "session-ended" // {sessionId, mode, total, correct, wrong} 会话结算（仅计数，无题干）
  | "wrongbook-changed" // {qid, status} 错题处置/暂缓/再错（生态消费者按需重读）
  | "open-view" // {view} 稳定入口深链（window.siyuanExam.wrongbook → 练习台错题本）
  | "stats"; // {…} publicStats 快照（48-02 lite：信封双发；legacy 裸 detail 兼容保留）

export function busEventName(type: BusEventType): string {
  return BUS_PREFIX + type;
}

let seq = 0;
function newEventId(): string {
  seq = (seq + 1) % 1_000_000;
  return `e-${Date.now().toString(36)}-${seq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** 发射（信封封装 + 白名单校验）；SSR/无窗口环境静默跳过 */
export function emitExamEvent<T extends Record<string, unknown>>(type: BusEventType, payload: T): BusEvent<T> | null {
  if (typeof window === "undefined" || !window.dispatchEvent) return null;
  const env: BusEvent<T> = { v: 1, source: "siyuan-exam", type, eventId: newEventId(), at: Date.now(), payload };
  window.dispatchEvent(new CustomEvent(busEventName(type), { detail: env }));
  return env;
}

/** 订阅：handler 收到完整信封；返回退订函数。未知 v 的信封不投递（前向兼容）；
 *  无窗口环境（headless 测试/SSR）返回空退订 */
export function onExamEvent<T extends Record<string, unknown>>(
  type: BusEventType,
  handler: (env: BusEvent<T>) => void,
): () => void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
  const name = busEventName(type);
  const listener = (e: Event) => {
    const env = (e as CustomEvent).detail as BusEvent<T> | undefined;
    if (!env || typeof env !== "object" || env.v !== 1 || env.type !== type) return;
    handler(env);
  };
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}
