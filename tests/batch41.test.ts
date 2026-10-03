import { describe, it, expect, vi, afterEach } from "vitest";
import { registerExamDailySummary, assertModuleId, buildDailyItems } from "../src/ecosystem/speedSwitch";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";

const mkApp = () =>
  new ExamApp({
    client: { sql: async () => [] } as unknown as KernelApiClient,
    storage: new MemoryStorage(),
    now: () => Date.now(),
  });

afterEach(() => {
  vi.useRealTimers();
});

describe("雷切组件面板接入（48-05，四一批）", () => {
  it("moduleId 满足协议白名单（≤64 字符，A-Za-z0-9._:-）", () => {
    expect(assertModuleId("exam-daily-summary")).toBe(true);
    expect(assertModuleId("a".repeat(65))).toBe(false);
    expect(assertModuleId("bad id!")).toBe(false);
  });

  it("buildDailyItems：今日作答/正确率/错题在册（只用 derived，不全库扫描）", async () => {
    const app = mkApp();
    app.recordAttempt({ qid: "q1", kind: "practice", mode: "single", verdict: "correct", myAnswer: "A", sessionId: "s1", queue: "normal" });
    app.recordAttempt({ qid: "q2", kind: "practice", mode: "single", verdict: "wrong", myAnswer: "B", sessionId: "s1", queue: "normal" });
    app.recordAttempt({ qid: "q3", kind: "practice", mode: "single", verdict: "not_attempted", myAnswer: null, sessionId: "s1", queue: "normal" });
    const items = buildDailyItems(app, (k, fb) => fb ?? k);
    expect(items.map((x) => x.label)).toEqual(["今日作答", "正确率", "错题在册"]);
    expect(items[0].value).toBe("2"); // not_attempted 不计
    expect(items[1].value).toBe("50%"); // q1 对
    expect(items[2].value).toBe("1"); // q2 在册
  });

  it("宿主未就绪 → 有界重试后注册成功；dispose 注销且不再重试", async () => {
    vi.useFakeTimers();
    let host: { registerHomeModule?: unknown } | undefined = undefined;
    const registered: string[] = [];
    const findPlugin = (name: string) => {
      if (!host) return undefined;
      return {
        name,
        registerHomeModule: (m: { moduleId: string }) => {
          registered.push(m.moduleId);
          return { unregister: () => {} };
        },
        getHomeModules: () => [{ moduleId: "exam-daily-summary" }],
      };
    };
    const deps = {
      app: mkApp(),
      t: (_k: string, fb?: string) => fb ?? _k,
      open: () => {},
      findPlugin: (name: string) => findPlugin(name) as unknown,
    };
    const handle = registerExamDailySummary(deps as never);
    expect(handle.settled()).toBe(false);
    // 宿主就绪 → 走完重试链注册
    host = {};
    await vi.advanceTimersByTimeAsync(12_000);
    expect(registered).toEqual(["exam-daily-summary"]);
    expect(handle.settled()).toBe(true);
    handle.dispose();
  });

  it("核验未列上（no-op 句柄兜底）→ 清理并继续重试而非误报成功", async () => {
    vi.useFakeTimers();
    const registered: string[] = [];
    let strictHost = false;
    const handle = registerExamDailySummary({
      app: mkApp(),
      t: (_k, fb) => fb ?? _k,
      open: () => {},
      findPlugin: () => {
        if (!strictHost) return undefined;
        return {
          registerHomeModule: (m: { moduleId: string }) => {
            registered.push(m.moduleId);
            return { unregister: () => registered.pop() };
          },
          getHomeModules: () => (strictHost === true ? [] : [{ moduleId: "exam-daily-summary" }]),
        } as never;
      },
    } as never);
    strictHost = "pending" as unknown as boolean;
    await vi.advanceTimersByTimeAsync(12_000);
    strictHost = true;
    await vi.advanceTimersByTimeAsync(12_000);
    expect(registered).toEqual(["exam-daily-summary"]); // 首轮空列表核验失败被清理，第二轮成功
    handle.dispose();
  });
});
