// ============================================================
// 小驴雷切 · 组件面板接入（TODO 48-05）：exam-daily-summary 只读组件
// 契约来源：小驴雷切/docs/widget-protocol.md（protocol v2，2026-10-04 核对）
// - 宿主：app.plugins 中 name === "siyuan-speed-switch" 的插件实例
// - onload 时宿主可能未就绪 → 有界重试（250ms~6s，总窗 ~11.5s，到顶放弃）
// - 注册失败返回 no-op 句柄而非异常 → 用 getHomeModules() 核验兜底
// - read 契约：≤800ms、不全库扫描（只用 derived() 缓存重算）、小体量快照
// - 卸载：clearTimeout + unregister（注册/注销配对）
// ============================================================
import type { ExamApp } from "../app";

const MODULE_ID = "exam-daily-summary"; // 48-05 约定名；同名桥接时原生实现热替换接管
const RETRY_DELAYS = [250, 750, 1500, 3000, 6000];

export interface SpeedSwitchModule {
  moduleId: string;
  title: string;
  icon: string;
  category: string;
  supportedDevices: string[];
  sizes: string[];
  description: string;
  read: (config: unknown, device: string) => Promise<{ title?: string; items: { label: string; value: string }[] }>;
  open?: () => void;
  source?: { pluginId: string; name: string; icon?: string };
}

export interface SpeedSwitchHost {
  registerHomeModule: (m: SpeedSwitchModule) => unknown;
  getHomeModules?: (device: string) => { moduleId: string }[];
}

export interface ExamDailyDeps {
  app: ExamApp;
  /** i18n 取词（t(key, fallback)） */
  t: (key: string, fallback?: string) => string;
  /** 组件「打开插件」跳转目标 */
  open: () => void;
  /** 宿主查找（index.ts 注入 app.plugins.find，便于测试注入） */
  findPlugin: (name: string) => unknown | undefined;
}

/** moduleId 白名单/长度自检（协议：≤64 字符，A-Za-z0-9._:-） */
export function assertModuleId(id: string): boolean {
  return id.length <= 64 && /^[A-Za-z0-9._:-]+$/.test(id);
}

/** 当日练习快照条目（纯函数；只用 derived() 缓存重算，不触碰 listQuestions） */
export function buildDailyItems(
  app: ExamApp,
  t: (key: string, fallback?: string) => string,
): { label: string; value: string }[] {
  const d = app.derived();
  const today = localDateKey(Date.now());
  let attempts = 0;
  let correct = 0;
  for (const e of app.attempts.all()) {
    if (e.verdict === "not_attempted") continue;
    const key = localDateKey(e.ts);
    if (key !== today) continue;
    attempts++;
    if (e.verdict === "correct") correct++;
  }
  const wrongActive = [...d.wrongbook.values()].filter((w) => w.status === "active").length;
  const items = [
    { label: t("eco.todayAttempts", "今日作答"), value: String(attempts) },
    {
      label: t("eco.accuracy", "正确率"),
      value: attempts ? `${Math.round((correct / attempts) * 100)}%` : "—",
    },
    { label: t("eco.wrongActive", "错题在册"), value: String(wrongActive) },
  ];
  return items;
}

function localDateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface ExamDailySummaryHandle {
  dispose: () => void;
  /** 注册是否最终成功（重试到顶放弃 = false；仅供诊断，不影响功能） */
  settled: () => boolean;
}

/** 注册考试日摘要组件（onload 调用；返回 dispose 在 onunload 调用） */
export function registerExamDailySummary(deps: ExamDailyDeps): ExamDailySummaryHandle {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unregister: { unregister?: () => void } | null = null;
  let registered = false;
  let disposed = false;

  const tryOnce = (): boolean => {
    if (disposed || registered) return true;
    const host = deps.findPlugin("siyuan-speed-switch") as SpeedSwitchHost | undefined;
    if (typeof (host as SpeedSwitchHost | undefined)?.registerHomeModule !== "function") return false;
    const module: SpeedSwitchModule = {
      moduleId: MODULE_ID,
      title: deps.t("eco.moduleTitle", "小驴考试（内测版） · 今日练习"),
      icon: "iconExam",
      category: "plugin",
      supportedDevices: ["desktop", "sidebar", "mobile"],
      sizes: ["xs", "small"],
      description: deps.t("eco.moduleDesc", "今日作答量、正确率与错题在册"),
      read: async () => ({ items: buildDailyItems(deps.app, deps.t) }),
      open: () => deps.open(),
      source: { pluginId: "siyuan-exam", name: "小驴考试（内测版）", icon: "iconExam" },
    };
    if (!assertModuleId(module.moduleId)) return false; // 协议白名单守卫（不满足则放弃而非误注册）
    unregister = host!.registerHomeModule(module) as { unregister?: () => void };
    // no-op 句柄兜底核验：有列表 API 时以列表为准，未列上则清理并继续重试
    const listed = host!.getHomeModules?.("desktop")?.some((m) => m.moduleId === MODULE_ID);
    if (listed === false) {
      unregister.unregister?.();
      unregister = null;
      return false;
    }
    registered = true;
    return true;
  };

  const schedule = () => {
    if (disposed || registered || attempt >= RETRY_DELAYS.length) return;
    timer = setTimeout(() => {
      timer = null;
      if (tryOnce()) return;
      schedule();
    }, RETRY_DELAYS[attempt++]);
  };

  if (!tryOnce()) schedule();

  return {
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      unregister?.unregister?.();
      unregister = null;
    },
    settled: () => registered,
  };
}
