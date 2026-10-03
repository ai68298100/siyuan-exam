// ============================================================
// [lv-exam] 日志封装 + 错误二分类工具（TODO 0 组）
// - 前缀统一，控制台检索可过滤；生产环境 info/debug 静默（console 仍可由宿主开关）
// - 错误二分类与 KernelApiClient 同口径：网络/超时/中断 → retryable，其余 → fatal
// - 纯 console，不依赖 siyuan 包（core 层约束）；不采集个人数据、不外发
// ============================================================

export type LvErrKind = "retryable" | "fatal";

const RETRIABLE_HOST = /ECONN|ETIMEDOUT|timeout|abort|network|fetch failed|Failed to fetch/i;

/** 与 kernel/client.classify 同口径的错误二分类（供 UI 决定"重试"还是"报告"） */
export function classifyError(e: unknown): LvErrKind {
  if (e && typeof e === "object" && "kind" in e) {
    const k = (e as { kind?: unknown }).kind;
    if (k === "retryable" || k === "fatal") return k;
  }
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return RETRIABLE_HOST.test(msg) ? "retryable" : "fatal";
}

type Level = "debug" | "info" | "warn" | "error";

const PREFIX = "[lv-exam]";

function emit(level: Level, scope: string, msg: string, detail?: unknown) {
  const line = `${PREFIX}[${scope}] ${msg}`;
  if (level === "debug") {
    console.debug(line, detail ?? "");
    return;
  }
  if (level === "info") console.info(line, detail ?? "");
  else if (level === "warn") console.warn(line, detail ?? "");
  else console.error(line, detail ?? "");
}

/** 作用域日志器：lvLogger("import").warn("映射失效", err) */
export function lvLogger(scope: string) {
  return {
    debug: (msg: string, detail?: unknown) => emit("debug", scope, msg, detail),
    info: (msg: string, detail?: unknown) => emit("info", scope, msg, detail),
    warn: (msg: string, detail?: unknown) => emit("warn", scope, msg, detail),
    error: (msg: string, detail?: unknown) => emit("error", scope, msg, detail),
  };
}

export type LvLogger = ReturnType<typeof lvLogger>;
