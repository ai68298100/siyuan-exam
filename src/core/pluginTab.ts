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

/** getOpenedTab 返回 Custom model，其 parent 是 Tab，Tab.parent 才是窗口。 */
export function focusExamTab(model: {
  parent?: { headElement?: HTMLElement; parent?: { switchTab?: (head: HTMLElement) => void } };
}): boolean {
  const tab = model?.parent;
  if (!tab?.headElement) return false;
  if (tab.parent?.switchTab) tab.parent.switchTab(tab.headElement);
  else tab.headElement.click();
  return true;
}
