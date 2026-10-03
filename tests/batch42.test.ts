import { describe, it, expect } from "vitest";
import {
  bridgeEnabled,
  buildCheckinEvent,
  fetchStreak,
  localDateKeyOf,
  probeCheckinApi,
  shouldCheckin,
  syncCheckin,
  type CheckinApiV5,
} from "../src/core/checkinBridge";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";

const CFG = { itemId: " 题库打卡 ", threshold: 10 };
const NOW = new Date(2026, 9, 4, 21, 0, 0).getTime(); // 2026-10-04 21:00 本地

describe("考试→打卡桥纯函数（48-03 lite，四二批）", () => {
  it("bridgeEnabled：itemId 空=关闭；非空=开启（trim 后判定）", () => {
    expect(bridgeEnabled({ itemId: "", threshold: 10 })).toBe(false);
    expect(bridgeEnabled(CFG)).toBe(true);
  });

  it("shouldCheckin：阈值优先，0 回退每日目标", () => {
    expect(shouldCheckin(10, CFG, 20)).toBe(true);
    expect(shouldCheckin(9, CFG, 20)).toBe(false);
    expect(shouldCheckin(5, { itemId: "x", threshold: 0 }, 10)).toBe(false); // 回退每日目标 10
    expect(shouldCheckin(10, { itemId: "x", threshold: 0 }, 10)).toBe(true);
  });

  it("buildCheckinEvent：externalRef=exam:<itemId>:<localDate> 幂等身份；source 恒为 api；同日同引用", () => {
    const e = buildCheckinEvent(CFG, 12, NOW);
    expect(e.externalRef).toBe("exam:题库打卡:2026-10-04");
    expect(e.source).toBe("api");
    expect(e.value).toBe(12);
    expect(e.unit).toBe("题");
    const again = buildCheckinEvent(CFG, 15, NOW + 3_600_000); // 同日稍后 → 同引用（值以重试时为准）
    expect(again.externalRef).toBe(e.externalRef);
    expect(localDateKeyOf(NOW)).toBe("2026-10-04");
  });

  it("probeCheckinApi：协议不符/缺失 → null", () => {
    expect(probeCheckinApi({})).toBeNull();
    expect(probeCheckinApi({ siyuanCheckin: { protocol: "other" } })).toBeNull();
    expect(probeCheckinApi({ siyuanCheckin: { protocol: "siyuan-checkin" } })?.protocol).toBe("siyuan-checkin");
  });

  it("syncCheckin：undefined=未写入→pending 保留原引用；duplicate 副本=synced；异常→pending", async () => {
    const evt = buildCheckinEvent(CFG, 12, NOW);
    const undefinedApi = { protocol: "siyuan-checkin", recordEvent: () => undefined } as unknown as CheckinApiV5;
    const p1 = await syncCheckin(undefinedApi, CFG, 12, NOW, 10);
    expect(p1.status).toBe("pending");
    expect(p1.event?.externalRef).toBe(evt.externalRef); // 原引用，不换新

    const dupApi = {
      protocol: "siyuan-checkin",
      whenReady: () => {},
      hasCapability: () => true,
      recordEvent: () => ({ eventId: "ck-1" }),
    } as unknown as CheckinApiV5;
    expect((await syncCheckin(dupApi, CFG, 12, NOW, 10)).status).toBe("synced");

    const boomApi = {
      protocol: "siyuan-checkin",
      whenReady: () => {
        throw new Error("boom");
      },
    } as unknown as CheckinApiV5;
    expect((await syncCheckin(boomApi, CFG, 12, NOW, 10)).status).toBe("pending");

    const noCap = { protocol: "siyuan-checkin", hasCapability: () => false } as unknown as CheckinApiV5;
    expect((await syncCheckin(noCap, CFG, 12, NOW, 10)).status).toBe("no-capability");
  });
});

describe("打卡桥待重试持久化（ExamApp，四二批）", () => {
  it("pending 写读清空", async () => {
    const app = new ExamApp({
      client: { sql: async () => [] } as unknown as KernelApiClient,
      storage: new MemoryStorage(),
      now: () => 1_800_000_000_000,
    });
    expect(await app.getCheckinPending()).toBeNull();
    const evt = buildCheckinEvent(CFG, 12, NOW);
    await app.setCheckinPending(evt);
    expect((await app.getCheckinPending())?.externalRef).toBe(evt.externalRef);
    await app.setCheckinPending(null);
    expect(await app.getCheckinPending()).toBeNull();
  });
});

describe("48-04 打卡只读投影：fetchStreak（四三批）", () => {
  const itemId = "题库打卡";
  const okApi = (streaks: unknown[] | (() => unknown[])) =>
    ({
      protocol: "siyuan-checkin",
      whenReady: () => {},
      hasCapability: (n: string) => n === "metrics.read",
      getStreaks: typeof streaks === "function" ? (streaks as () => unknown[]) : () => streaks,
    }) as unknown as CheckinApiV5;

  it("能力齐备：返回配置项目的连续数", async () => {
    const s = await fetchStreak(okApi([{ itemId, current: 7, longest: 21 }]), itemId);
    expect(s).toEqual({ current: 7, longest: 21 });
  });

  it("能力缺失/异常/项目不匹配/未配置 → null（不影响刷题）", async () => {
    expect(await fetchStreak(okApi([{ itemId, current: 7, longest: 21 }]), "  ")).toBeNull(); // 未配置
    const noCap = {
      protocol: "siyuan-checkin",
      hasCapability: () => false,
      getStreaks: () => [],
    } as unknown as CheckinApiV5;
    expect(await fetchStreak(noCap, itemId)).toBeNull();
    const boom = {
      protocol: "siyuan-checkin",
      whenReady: () => {
        throw new Error("boom");
      },
    } as unknown as CheckinApiV5;
    expect(await fetchStreak(boom, itemId)).toBeNull();
    expect(await fetchStreak(okApi([{ itemId: "其他项目", current: 9, longest: 9 }]), itemId)).toBeNull();
  });
});
