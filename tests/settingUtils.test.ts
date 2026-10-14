// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("siyuan", () => ({
  Setting: class {
    readonly items: { createActionElement: () => HTMLElement }[] = [];
    constructor(readonly options: { confirmCallback: () => Promise<void>; destroyCallback: () => void }) {}
    addItem(item: { createActionElement: () => HTMLElement }) { this.items.push(item); }
  },
}));

import { SettingUtils } from "../src/libs/setting-utils";

function setup(saveData = vi.fn().mockResolvedValue(undefined)) {
  const callback = vi.fn();
  const onSaveError = vi.fn();
  const plugin = { data: {}, saveData, setting: null } as any;
  const settings = new SettingUtils({ plugin, callback, onSaveError });
  settings.addItem({ key: "examDate", type: "textinput", title: "考试日期", description: "", value: "" });
  const input = settings.getElement("examDate") as HTMLInputElement;
  return { settings, plugin, input, callback, onSaveError };
}

function setupValidated(saveData = vi.fn().mockResolvedValue(undefined)) {
  const base = setup(saveData);
  base.settings.addItem({ key: "sprintDays", type: "number", title: "冲刺天数", description: "", value: 14 });
  const days = base.settings.getElement("sprintDays") as HTMLInputElement;
  return { ...base, days };
}

describe("设置保存回执", () => {
  it("思源返回保存成功后才通知用户，不能把在途保存显示为成功", async () => {
    let resolveSave!: () => void;
    const write = new Promise<void>((resolve) => { resolveSave = resolve; });
    const saveData = vi.fn().mockReturnValue(write);
    const { settings, plugin, input, callback, onSaveError } = setup(saveData);
    input.value = "2026-11-01";
    const confirming = plugin.setting.options.confirmCallback();
    expect(saveData).toHaveBeenCalledWith("settings.json", { examDate: "2026-11-01" });
    expect(callback).not.toHaveBeenCalled();
    resolveSave();
    await confirming;
    expect(callback).toHaveBeenCalledWith({ examDate: "2026-11-01" });
    expect(onSaveError).not.toHaveBeenCalled();
    expect(settings.get("examDate")).toBe("2026-11-01");
  });

  it("保存失败不会弹成功提示，关闭重开设置仍保留输入并可重试", async () => {
    const error = new Error("存储暂不可用");
    const saveData = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
    const { settings, plugin, input, callback, onSaveError } = setup(saveData);
    input.value = "2026-12-01";
    await plugin.setting.options.confirmCallback();
    expect(callback).not.toHaveBeenCalled();
    expect(onSaveError).toHaveBeenCalledWith(error);
    plugin.setting.options.destroyCallback();
    const reopened = plugin.setting.items[0].createActionElement() as HTMLInputElement;
    expect(reopened.value).toBe("2026-12-01");
    expect(settings.get("examDate")).toBe("2026-12-01");
    await plugin.setting.options.confirmCallback();
    expect(callback).toHaveBeenCalledOnce();
    expect(saveData).toHaveBeenCalledTimes(2);
  });

  it("输入法确认候选词不会阻止默认行为，也不会传播成宿主的设置确认", () => {
    const { input } = setup();
    const composing = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, cancelable: true, bubbles: true });
    const hostConfirm = vi.fn();
    document.body.addEventListener("keydown", hostConfirm);
    document.body.appendChild(input);
    input.dispatchEvent(composing);
    expect(composing.defaultPrevented).toBe(false);
    expect(hostConfirm).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-label")).toBe("考试日期");
    document.body.removeEventListener("keydown", hostConfirm);
    input.remove();
  });

  it("拒绝非法日期和负数，且不写入存储", async () => {
    const saveData = vi.fn().mockResolvedValue(undefined);
    const { plugin, input, days, onSaveError } = setupValidated(saveData);
    input.value = "2026-02-30";
    days.value = "-1";
    await plugin.setting.options.confirmCallback();
    expect(saveData).not.toHaveBeenCalled();
    expect(onSaveError).toHaveBeenCalled();
    expect(String(onSaveError.mock.calls[0][0])).toMatch(/考试日期|冲刺天数/);
  });
});
