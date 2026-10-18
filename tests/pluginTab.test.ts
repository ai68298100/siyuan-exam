import { describe, expect, it, vi } from "vitest";
import { consumePendingPracticeView, createExamTabDescriptor, findExamTabHeader, findOpenedExamTab, focusExamTab, isCurrentPracticeViewRequest, observeTabOpen, openPracticeView } from "../src/core/pluginTab";
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

  it("跨宿主 getOpenedTab 键名找到恢复中的页签，并支持 tab 形态模型", () => {
    const head = { click: vi.fn() } as unknown as HTMLElement;
    const restored = { type: "siyuan-examexam-practice", tab: { headElement: head } };
    const opened = { "siyuan-examexam-practice": [restored] };
    expect(findOpenedExamTab(opened, "siyuan-exam", "exam-practice")).toBe(restored);
    expect(focusExamTab(restored)).toBe(true);
    expect(head.click).toHaveBeenCalledOnce();
  });

  it("恢复页签模型没有可识别 type 时仍按稳定 map key 聚焦", () => {
    const head = { click: vi.fn() } as unknown as HTMLElement;
    const restored = { tab: { headElement: head } };
    expect(findOpenedExamTab({ "exam-practice": [restored] }, "siyuan-exam", "exam-practice")).toBe(restored);
    expect(focusExamTab(restored)).toBe(true);
  });

  it("模型尚未注册时可从恢复的宿主标题节点聚焦", () => {
    const header = {
      getAttribute: (name: string) => name === "data-id" ? "siyuan-examexam-practice" : "tab-header",
    } as unknown as HTMLElement;
    vi.stubGlobal("document", { querySelectorAll: () => [header] });
    try {
      expect(findExamTabHeader("siyuan-exam", "exam-practice")).toBe(header);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("真实宿主 UUID 标题按 data-initdata 中的 customModelType 复用，不增加恢复页签", () => {
    const header = {
      getAttribute: (name: string) => name === "data-id"
        ? "304278d0-18b5-44e2-b219-ccebd32c11e8"
        : name === "data-initdata"
          ? JSON.stringify({ customModelData: {}, customModelType: "siyuan-examexam-practice", instance: "Custom" })
          : null,
    } as unknown as HTMLElement;
    vi.stubGlobal("document", { querySelectorAll: () => [header] });
    try {
      expect(findExamTabHeader("siyuan-exam", "exam-practice")).toBe(header);
      expect(findExamTabHeader("siyuan-exam", "exam-mock")).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("宿主恢复数据损坏或属于其他实例时不拦截新页签打开", () => {
    const header = (initData: string) => ({
      getAttribute: (name: string) => name === "data-initdata" ? initData : "host-tab-uuid",
    });
    vi.stubGlobal("document", {
      querySelectorAll: () => [
        header("{broken"),
        header(JSON.stringify({ instance: "Editor", customModelType: "siyuan-examexam-practice" })),
        header(JSON.stringify({ instance: "Custom", customModelType: "other-pluginexam-practice" })),
      ],
    });
    try {
      expect(findExamTabHeader("siyuan-exam", "exam-practice")).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
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

  it("观察页签打开的同步抛错和异步拒绝，不留下未处理 Promise", async () => {
    const success: string[] = [];
    const failure: string[] = [];
    observeTabOpen(() => Promise.resolve("opened"), (value) => success.push(value), (error) => failure.push(String(error)));
    observeTabOpen(() => Promise.reject(new Error("host rejected")), () => success.push("unexpected"), (error) => failure.push(String(error)));
    observeTabOpen(() => { throw new Error("host threw"); }, () => success.push("unexpected"), (error) => failure.push(String(error)));
    await Promise.resolve();
    await Promise.resolve();
    expect(success).toEqual(["opened"]);
    expect(failure).toEqual(["Error: host threw", "Error: host rejected"]);
  });
});
