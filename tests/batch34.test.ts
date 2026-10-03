import { describe, it, expect } from "vitest";
import { interleaveGroups } from "../src/core/interleave";
import { groupAdjacent } from "../src/core/session";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";
import { makeQuestion } from "../src/core/blockTemplate";
import type { Question } from "../src/core/types";

const q = (id: string, group?: string): Question =>
  ({ ...makeQuestion({ type: "judge", stem: id, options: [], answer: "对" }), id, ...(group ? { group } : {}) });

describe("44-03 材料组交错开关（三四批）", () => {
  const qs = [q("g1a", "grp1"), q("g1b", "grp1"), q("g1c", "grp1"), q("loose"), q("g2a", "grp2"), q("g2b", "grp2")];

  it("interleaveGroups：同组不连续（组内题被无组题/他组隔开）", () => {
    const out = interleaveGroups(qs);
    for (let i = 1; i < out.length; i++) {
      if (out[i].group) {
        const sameAsPrev = out[i - 1].group === out[i].group && out[i - 1].group === out[i].group;
        expect(sameAsPrev, `位置 ${i} 出现同组相邻：${out[i - 1].id}/${out[i].id}`).toBe(false);
      }
    }
    expect(out).toHaveLength(qs.length);
  });

  it("groupAdjacent（默认）：同组连排不变", () => {
    const out = groupAdjacent(qs);
    const idx = out.findIndex((x) => x.id === "g1a");
    expect(out[idx + 1].id).toBe("g1b"); // 连排语义保持
  });
});

describe("40-05 活动会话协商（三四批）", () => {
  const mkApp = () => {
    const app = new ExamApp({
      client: { sql: async () => [] } as unknown as KernelApiClient,
      storage: new MemoryStorage(),
      now: () => 1_800_000_000_000,
    });
    return app;
  };

  it("活动会话冲突抛错；discardSession 后可新开", async () => {
    const app = mkApp();
    await app.startSession([q("a")], "single", "b1");
    await expect(app.startSession([q("b")], "single", "b1")).rejects.toThrow("已有进行中的会话");
    await app.discardSession();
    const s = await app.startSession([q("b")], "single", "b1");
    expect(s.state.qids).toEqual(["b"]);
  });

  it("44-03：startSession interleave 选项写入会话状态（结算显示依据）", async () => {
    const app = mkApp();
    const s = await app.startSession([q("a", "g1"), q("b", "g1"), q("c")], "single", "b1", { interleave: true });
    expect(s.state.order).toBe("interleaved");
    await app.discardSession();
    const s2 = await app.startSession([q("d")], "single", "b1");
    expect(s2.state.order).toBe("adjacent");
  });
});
