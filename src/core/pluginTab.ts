import { emitExamEvent } from "./bus";

export type PracticeViewTarget = "wrongbook" | "entry" | "browse" | "manual" | "import" | "ai" | "materials" | "recite";
export interface PracticeViewRequest {
  id: string;
  view: PracticeViewTarget;
  bankId?: string;
  search?: string;
  /** Optional material context for an AI view opened from a host surface. */
  sourceText?: string;
  sourceTitle?: string;
  sourceKind?: "block" | "document";
  sourceTruncated?: boolean;
}

type PracticeViewPlugin = {
  pendingPracticeView?: PracticeViewRequest;
  practiceViewRequestId?: string;
  openPractice?: () => boolean | void;
};

let practiceViewSeq = 0;

/** Observe both synchronous host throws and async openTab rejections. */
export function observeTabOpen<T>(open: () => T | PromiseLike<T>, onSuccess: (value: T) => void, onFailure: (error: unknown) => void): void {
  try {
    void Promise.resolve(open()).then(onSuccess, onFailure);
  } catch (error) {
    onFailure(error);
  }
}

/** Existing tabs receive a bus event; new tabs consume the pending route on mount. */
export function openPracticeView(
  plugin: PracticeViewPlugin | null | undefined,
  view: PracticeViewTarget,
  options: Pick<PracticeViewRequest, "bankId" | "search" | "sourceText" | "sourceTitle" | "sourceKind" | "sourceTruncated"> = {},
): PracticeViewRequest | undefined {
  if (!plugin?.openPractice) return;
  practiceViewSeq = (practiceViewSeq + 1) % 1_000_000;
  const request: PracticeViewRequest = {
    id: `pv-${Date.now().toString(36)}-${practiceViewSeq.toString(36)}`,
    view,
    ...options,
  };
  plugin.pendingPracticeView = request;
  plugin.practiceViewRequestId = request.id;
  if (plugin.openPractice() === true) emitExamEvent("open-view", { view, requestId: request.id });
  return request;
}

export function consumePendingPracticeView(plugin: PracticeViewPlugin): PracticeViewRequest | undefined {
  const request = plugin.pendingPracticeView;
  if (!request || request.id !== plugin.practiceViewRequestId) return;
  plugin.pendingPracticeView = undefined;
  return request;
}

export function isCurrentPracticeViewRequest(plugin: PracticeViewPlugin, requestId: string): boolean {
  return plugin.practiceViewRequestId === requestId;
}

/** 构造思源可持久化的自定义页签描述；运行时对象不得放入 custom.data。 */
export function createExamTabDescriptor(pluginName: string, type: string, icon: string, title: string) {
  return {
    id: `${pluginName}${type}`,
    icon,
    title,
  };
}

/**
 * Locate an already-mounted exam custom tab across SiYuan versions.
 *
 * The current host groups models by the short tab type (`exam-practice`)
 * while each model stores the full persisted type (`pluginexam-practice`).
 * Accept both forms of the map key and model metadata before creating a new
 * tab. Lazy restored tabs without a model are handled by findExamTabHeader.
 */
export function findOpenedExamTab(
  opened: Record<string, unknown> | null | undefined,
  pluginName: string,
  type: string,
): unknown | undefined {
  if (!opened || typeof opened !== "object") return;
  const customId = `${pluginName}${type}`;
  for (const [key, value] of Object.entries(opened)) {
    const models = Array.isArray(value) ? value : [];
    const keyMatches = key === type || key === customId;
    for (const model of models) {
      if (!model || typeof model !== "object") continue;
      const item = model as {
        type?: unknown;
        id?: unknown;
        tab?: { id?: unknown };
      };
      const modelType = String(item.type ?? "");
      const modelId = String(item.id ?? item.tab?.id ?? "");
      if (keyMatches || modelType === type || modelType === customId || modelId === customId) return model;
    }
  }
  return;
}

/** Best-effort fallback while layout restoration is still populating models. */
export function findExamTabHeader(pluginName: string, type: string): HTMLElement | undefined {
  if (typeof document === "undefined") return;
  const customId = `${pluginName}${type}`;
  const nodes = document.querySelectorAll<HTMLElement>('[data-type="tab-header"], .layout-tab-bar .item');
  for (const node of nodes) {
    if (node.getAttribute("data-id") === customId || node.getAttribute("data-key") === customId) return node;
    // Current SiYuan gives every Tab a fresh UUID, including restored custom
    // tabs. Its lazy layout header stores the stable custom id in initdata,
    // before the Custom model appears in getOpenedTab().
    const initData = node.getAttribute("data-initdata");
    if (!initData) continue;
    try {
      const data = JSON.parse(initData);
      if (data?.instance === "Custom" && data.customModelType === customId) return node;
    } catch {
      // Invalid or unrelated host layout data must not prevent opening a tab.
    }
  }
  return;
}

/** getOpenedTab 返回 Custom model，其 parent 是 Tab，Tab.parent 才是窗口。 */
export function focusExamTab(model: {
  parent?: { headElement?: HTMLElement; parent?: { switchTab?: (head: HTMLElement) => void } };
  tab?: { headElement?: HTMLElement; parent?: { switchTab?: (head: HTMLElement) => void } };
}): boolean {
  // Custom models in current SiYuan expose `parent`; a few host builds expose
  // the owning Tab as `tab`. Support both so layout-restored tabs are focused
  // instead of duplicated.
  const tab = model?.parent?.headElement ? model.parent : model?.tab;
  if (!tab?.headElement) return false;
  if (tab.parent?.switchTab) tab.parent.switchTab(tab.headElement);
  else tab.headElement.click();
  return true;
}
