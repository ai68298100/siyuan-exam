// ============================================================
// 小驴考试 · 服务桥与跨插件多别名公开 API（Epoch 6 / 47-04 / 48-06）
// 对外提供稳定入口、按需脱敏统计快照与概览。
// 遵循脱敏红线：无题目内容、无 key、无路径。
// ============================================================

import { emitExamEvent } from "./bus";

export const LVEXAM_BRIDGE_PROTOCOL = 1;
export const LVEXAM_API_NAME = "LvExam";
export const LVEXAM_API_ALIASES = [
  "LvExam",
  "siyuanExam",
  "xiaolvExam",
  "lvExam",
] as const;

export type LvExamApiAlias = (typeof LVEXAM_API_ALIASES)[number];

export interface LvExamBridgeOverview {
  protocol: number;
  version: string;
  capabilities: readonly string[];
  stats: unknown;
  updatedAt: string;
}

export interface ExamBridgeHost {
  version: string;
  openPractice: () => void;
  openWrongbook: () => void;
  openMock: () => void;
  openReport: () => void;
  getStats: () => unknown;
  statsRead: () => Promise<unknown>;
  onBridgeDisposed?: () => void;
}

export interface LvExamBridgeApi {
  version: string;
  protocol: number;
  capabilities: readonly string[];
  whenReady: () => Promise<boolean>;
  hasCapability: (name: string) => boolean;
  open: () => void;
  practice: () => void;
  wrongbook: () => void;
  mock: () => void;
  report: () => void;
  stats: () => unknown;
  statsRead: () => Promise<unknown>;
  getOverview: () => LvExamBridgeOverview;
}

function dispatchExamNavigated(target: "practice" | "wrongbook" | "mock" | "report") {
  try {
    emitExamEvent("open-view", { view: target });
  } catch {
    // 忽略事件发射异常，保证主导航调用不阻断
  }
}

export function buildLvExamBridge(host: ExamBridgeHost): LvExamBridgeApi {
  const capabilities = [
    "open",
    "practice",
    "wrongbook",
    "mock",
    "report",
    "stats",
    "statsRead",
    "whenReady",
    "hasCapability",
    "getOverview",
  ] as const;

  return {
    version: host.version,
    protocol: LVEXAM_BRIDGE_PROTOCOL,
    capabilities,
    whenReady() {
      return Promise.resolve(true);
    },
    hasCapability(name: string) {
      return (capabilities as readonly string[]).includes(name);
    },
    open() {
      host.openPractice();
      dispatchExamNavigated("practice");
    },
    practice() {
      host.openPractice();
      dispatchExamNavigated("practice");
    },
    wrongbook() {
      host.openWrongbook();
      dispatchExamNavigated("wrongbook");
    },
    mock() {
      host.openMock();
      dispatchExamNavigated("mock");
    },
    report() {
      host.openReport();
      dispatchExamNavigated("report");
    },
    stats() {
      return host.getStats();
    },
    statsRead() {
      return host.statsRead();
    },
    getOverview() {
      return {
        protocol: LVEXAM_BRIDGE_PROTOCOL,
        version: host.version,
        capabilities,
        stats: host.getStats(),
        updatedAt: new Date().toISOString(),
      };
    },
  };
}

/**
 * 挂载考试服务桥到 window（多别名 + First-Instance-Wins + 身份校验安全注销）
 */
export function mountLvExamBridge(host: ExamBridgeHost): () => void {
  if (typeof window === "undefined") return () => undefined;
  const w = window as unknown as Record<string, unknown>;

  // 首实例独占保护：主别名已存在时静默跳过
  if (w[LVEXAM_API_NAME]) return () => undefined;

  const bridge = buildLvExamBridge(host);
  const mounted: string[] = [];

  for (const alias of LVEXAM_API_ALIASES) {
    if (!w[alias] || w[alias] === bridge) {
      w[alias] = bridge;
      mounted.push(alias);
    }
  }

  let disposed = false;
  return () => {
    if (disposed || w[LVEXAM_API_NAME] !== bridge) return;
    disposed = true;
    for (const alias of mounted) {
      if (w[alias] === bridge) {
        delete w[alias];
      }
    }
    host.onBridgeDisposed?.();
  };
}
