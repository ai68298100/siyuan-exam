import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildLvExamBridge,
  mountLvExamBridge,
  LVEXAM_BRIDGE_PROTOCOL,
  LVEXAM_API_NAME,
  LVEXAM_API_ALIASES,
  type ExamBridgeHost,
} from "../src/core/examBridge";
import { probeCheckinApi } from "../src/core/checkinBridge";
import { probeGlean } from "../src/core/gleanBridge";

function createMockHost(overrides: Partial<ExamBridgeHost> = {}): ExamBridgeHost {
  return {
    version: "0.10.4",
    openPractice: vi.fn(),
    openWrongbook: vi.fn(),
    openMock: vi.fn(),
    openReport: vi.fn(),
    getStats: vi.fn().mockReturnValue({ streak: 5, accuracy: 92, attempts: 120 }),
    statsRead: vi.fn().mockResolvedValue({ streak: 5, accuracy: 92, attempts: 120 }),
    onBridgeDisposed: vi.fn(),
    ...overrides,
  };
}

describe("小驴考试 · 服务桥与生态集成契约 (Epoch 6)", () => {
  let originalWindow: unknown;

  beforeEach(() => {
    originalWindow = (globalThis as any).window;
    (globalThis as any).window = {
      dispatchEvent: vi.fn(),
    };
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
  });

  it("protocol 与 capabilities 契约固定", () => {
    const host = createMockHost();
    const bridge = buildLvExamBridge(host);

    expect(bridge.protocol).toBe(LVEXAM_BRIDGE_PROTOCOL);
    expect(bridge.protocol).toBe(1);
    expect(bridge.version).toBe("0.10.4");
    expect(bridge.capabilities).toEqual([
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
    ]);
    expect(bridge.hasCapability("statsRead")).toBe(true);
    expect(bridge.hasCapability("unknownCap")).toBe(false);
  });

  it("whenReady 恒为 resolve(true)", async () => {
    const host = createMockHost();
    const bridge = buildLvExamBridge(host);
    await expect(bridge.whenReady()).resolves.toBe(true);
  });

  it("stats 与 statsRead 返回脱敏快照", async () => {
    const host = createMockHost();
    const bridge = buildLvExamBridge(host);

    expect(bridge.stats()).toEqual({ streak: 5, accuracy: 92, attempts: 120 });
    await expect(bridge.statsRead()).resolves.toEqual({ streak: 5, accuracy: 92, attempts: 120 });
  });

  it("getOverview 返回版本化无泄漏概览快照", () => {
    const host = createMockHost();
    const bridge = buildLvExamBridge(host);
    const overview = bridge.getOverview();

    expect(overview.protocol).toBe(1);
    expect(overview.version).toBe("0.10.4");
    expect(overview.capabilities).toContain("statsRead");
    expect(overview.stats).toEqual({ streak: 5, accuracy: 92, attempts: 120 });
    expect(overview.updatedAt).toBeTruthy();
  });

  it("open/practice/wrongbook/mock/report 导航转发到宿主并分发事件", () => {
    const host = createMockHost();
    const bridge = buildLvExamBridge(host);

    bridge.open();
    expect(host.openPractice).toHaveBeenCalledTimes(1);

    bridge.practice();
    expect(host.openPractice).toHaveBeenCalledTimes(2);

    bridge.wrongbook();
    expect(host.openWrongbook).toHaveBeenCalledTimes(1);

    bridge.mock();
    expect(host.openMock).toHaveBeenCalledTimes(1);

    bridge.report();
    expect(host.openReport).toHaveBeenCalledTimes(1);
  });

  it("mountLvExamBridge 支持多别名挂载 (siyuanExam, xiaolvExam, lvExam, LvExam)", () => {
    const host = createMockHost();
    const dispose = mountLvExamBridge(host);
    const w = (globalThis as any).window;

    for (const alias of LVEXAM_API_ALIASES) {
      expect(w[alias]).toBeDefined();
      expect(w[alias].protocol).toBe(1);
      expect(w[alias].version).toBe("0.10.4");
    }

    dispose();

    for (const alias of LVEXAM_API_ALIASES) {
      expect(w[alias]).toBeUndefined();
    }
    expect(host.onBridgeDisposed).toHaveBeenCalledTimes(1);
  });

  it("First-Instance-Wins：主别名已存在时不覆盖且返回安全空注销器", () => {
    const existing = { protocol: 99, version: "old" };
    (globalThis as any).window[LVEXAM_API_NAME] = existing;

    const host = createMockHost();
    const dispose = mountLvExamBridge(host);

    expect((globalThis as any).window[LVEXAM_API_NAME]).toBe(existing);
    expect(host.onBridgeDisposed).not.toHaveBeenCalled();

    dispose();
    expect((globalThis as any).window[LVEXAM_API_NAME]).toBe(existing);
    expect(host.onBridgeDisposed).not.toHaveBeenCalled();
  });

  it("注销器仅清理自身实例，被覆盖时不误删后继实例", () => {
    const host1 = createMockHost({ version: "1.0.0" });
    const dispose1 = mountLvExamBridge(host1);

    const w = (globalThis as any).window;
    expect(w[LVEXAM_API_NAME].version).toBe("1.0.0");

    // 模拟被外部更替
    const dummyBridge = { version: "2.0.0" };
    w[LVEXAM_API_NAME] = dummyBridge;

    dispose1();
    // 依然保留新实例，且不触发 host1 的 disposed 回调
    expect(w[LVEXAM_API_NAME]).toBe(dummyBridge);
    expect(host1.onBridgeDisposed).not.toHaveBeenCalled();
  });

  it("打卡与拾遗桥探测支持生态多别名降级", () => {
    // 打卡多别名
    const fakeCheckin = { protocol: "siyuan-checkin", whenReady: () => Promise.resolve() };
    expect(probeCheckinApi({ xiaolvCheckin: fakeCheckin })).toBe(fakeCheckin);
    expect(probeCheckinApi({ lvCheckin: fakeCheckin })).toBe(fakeCheckin);

    // 拾遗多别名
    const fakeGlean = { apiVersion: 1, listClips: vi.fn() };
    expect(probeGlean({ xiaolvGlean: fakeGlean })).toBe(fakeGlean);
    expect(probeGlean({ lvGlean: fakeGlean })).toBe(fakeGlean);
    expect(probeGlean({ LvGlean: fakeGlean })).toBe(fakeGlean);
  });
});
