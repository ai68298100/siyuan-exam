import { describe, expect, it, vi } from "vitest";
import { TabAppRegistry } from "../src/core/tabAppRegistry";

describe("TabAppRegistry", () => {
  it("同 type 的两个宿主页签各自销毁，不误卸载另一实例", async () => {
    const registry = new TabAppRegistry();
    const ownerA = { type: "siyuan-examexam-practice" };
    const ownerB = { type: "siyuan-examexam-practice" };
    const appA = {};
    const appB = {};
    const unmount = vi.fn();
    registry.set(ownerA, appA);
    registry.set(ownerB, appB);

    expect(await registry.destroy(ownerA, unmount)).toBe(true);
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(unmount).toHaveBeenCalledWith(appA);
    expect(registry.size).toBe(1);
    expect(registry.has(ownerB)).toBe(true);

    expect(await registry.destroy(ownerA, unmount)).toBe(false);
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(await registry.destroy(ownerB, unmount)).toBe(true);
    expect(unmount).toHaveBeenLastCalledWith(appB);
    expect(registry.size).toBe(0);
  });

  it("clear 在调用卸载前清空注册表，重复 clear 不重复卸载", async () => {
    const registry = new TabAppRegistry();
    registry.set({}, {});
    registry.set({}, {});
    const unmount = vi.fn();
    const cleared = registry.clear(unmount);

    expect(registry.size).toBe(0);
    await cleared;
    expect(unmount).toHaveBeenCalledTimes(2);
    await registry.clear(unmount);
    expect(unmount).toHaveBeenCalledTimes(2);
  });

  it("卸载拒绝也继续清理全部页签，并向调用方报告清理错误", async () => {
    const registry = new TabAppRegistry();
    const appA = {};
    const appB = {};
    registry.set({}, appA);
    registry.set({}, appB);
    const unmount = vi.fn(async (instance: object) => {
      if (instance === appA) throw new Error("A cleanup failed");
    });

    await expect(registry.clear(unmount)).rejects.toThrow("Failed to unmount exam tabs");
    expect(unmount).toHaveBeenCalledTimes(2);
    expect(unmount).toHaveBeenLastCalledWith(appB);
    expect(registry.size).toBe(0);
  });

  it("同一页签的异步销毁尚未结束时，重复销毁不会再次触发卸载", async () => {
    const registry = new TabAppRegistry();
    const owner = {};
    registry.set(owner, {});
    let finish: () => void;
    const unmount = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const destroying = registry.destroy(owner, unmount);

    expect(await registry.destroy(owner, unmount)).toBe(false);
    expect(unmount).toHaveBeenCalledTimes(1);
    finish!();
    expect(await destroying).toBe(true);
  });
});
