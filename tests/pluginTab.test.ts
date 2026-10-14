import { describe, expect, it, vi } from "vitest";
import { consumePendingPracticeView, createExamTabDescriptor, focusExamTab, isCurrentPracticeViewRequest, openPracticeView } from "../src/core/pluginTab";
import { onExamEvent } from "../src/core/bus";

describe("自定义页签持久化数据", () => {
  it("不会把与思源 app 构成循环引用的插件实例写入 custom.data", () => {
    const hostApp: { plugins: unknown[] } = { plugins: [] };
    const plugin: { name: string; app: typeof hostApp } = { name: "siyuan-exam", app: hostApp };
    hostApp.plugins.push(plugin);
    const examApp = { plugin };

    // 复现宿主保存 custom.data 时遇到的 Plugin -> app -> plugins -> Plugin 环。
    expect(() => JSON.stringify({ plugin, examApp })).toThrow(/circular/i);

    const descriptor = createExamTabDescriptor(plugin.name, "exam-practice", "iconExam", "练习台");
    expect(JSON.parse(JSON.stringify(descriptor))).toEqual({
      id: "siyuan-examexam-practice",
      icon: "iconExam",
      title: "练习台",
    });
    expect(descriptor).not.toHaveProperty("data");
  });
  it("已开页签按 Custom → Tab → Wnd 层级聚焦，页内按钮可切换回已有练习台", () => {
    const head = { click: vi.fn() } as unknown as HTMLElement;
    const switchTab = vi.fn();
    const model = { parent: { headElement: head, parent: { switchTab } } };
    expect(focusExamTab(model)).toBe(true);
    expect(switchTab).toHaveBeenCalledWith(head);
    expect(head.click).not.toHaveBeenCalled();
  });
  it("窗口方法缺失时点击 Tab 的标题，无法定位时允许调用方重新打开", () => {
    const head = { click: vi.fn() } as unknown as HTMLElement;
    expect(focusExamTab({ parent: { headElement: head } })).toBe(true);
    expect(head.click).toHaveBeenCalledOnce();
    expect(focusExamTab({})).toBe(false);
  });

  it("已存在页签收到一次广播，新页签只消费挂载目标，连续目标只保留最新待进入视图", () => {
    vi.stubGlobal("window", new EventTarget() as unknown as Window & typeof globalThis);
    const calls: string[] = [];
    const plugin = { openPractice: vi.fn(() => { calls.push("open"); return true; }) };
    const off = onExamEvent<{ view: string }>("open-view", ({ payload }) => calls.push(payload.view));
    try {
      openPracticeView(plugin, "manual");
      const firstRequest = plugin.pendingPracticeView;
      expect(firstRequest?.view).toBe("manual");
      expect(calls).toEqual(["open", "manual"]);
      expect(isCurrentPracticeViewRequest(plugin, firstRequest!.id)).toBe(true);
      expect(consumePendingPracticeView(plugin)).toEqual(firstRequest);

      openPracticeView(plugin, "entry");
      const staleId = plugin.pendingPracticeView!.id;
      openPracticeView(plugin, "browse");
      const currentId = plugin.pendingPracticeView!.id;
      expect(staleId).not.toBe(currentId);
      expect(isCurrentPracticeViewRequest(plugin, staleId)).toBe(false);
      expect(isCurrentPracticeViewRequest(plugin, currentId)).toBe(true);
      expect(calls.slice(-4)).toEqual(["open", "entry", "open", "browse"]);

      const newTab = { openPractice: vi.fn(() => false) };
      const request = openPracticeView(newTab, "ai", {
        sourceText: "所选块内容",
        sourceTitle: "当前块",
        sourceKind: "block",
        sourceTruncated: true,
      });
      expect(request).toMatchObject({ view: "ai", sourceText: "所选块内容", sourceTitle: "当前块", sourceKind: "block", sourceTruncated: true });
      expect(consumePendingPracticeView(newTab)).toEqual(request);
      expect(consumePendingPracticeView(newTab)).toBeUndefined();
    } finally {
      off();
      vi.unstubAllGlobals();
    }
  });
});
