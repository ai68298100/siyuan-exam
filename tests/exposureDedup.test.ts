// 65-06 lite：跨模式曝光索引/去重测试
import { describe, expect, it } from "vitest";
import { recentlySeen, recentExposureList, seenIndex } from "../src/core/exposure";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { AttemptEvent } from "../src/core/types";
import type { KernelApiClient } from "../src/kernel/client";
import { makeQuestion } from "../src/core/blockTemplate";

const app = new ExamApp({ client: {} as unknown as KernelApiClient, storage: new MemoryStorage() });

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
let seq = 0;
function ev(partial: Partial<AttemptEvent>): AttemptEvent {
  return {
    v: 2,
    eid: `e-${++seq}`,
    ts: NOW,
    qid: "q1",
    kind: "practice",
    mode: "daily",
    verdict: "correct",
    myAnswer: "A",
    sessionId: "s1",
    queue: "normal",
    device: "t",
    seq,
    ...partial,
  };
}

describe("seenIndex / recentlySeen（65-06）", () => {
  it("时间窗过滤：窗外不计、窗内跨模式合并", () => {
    const events = [
      ev({ qid: "q-old", ts: NOW - 5 * DAY }),
      ev({ qid: "q-mix", kind: "practice", ts: NOW - 2 * DAY }),
      ev({ qid: "q-mix", kind: "mock", ts: NOW - DAY, exposure: ["hint"] }),
      ev({ qid: "q-new", ts: NOW - 1000 }),
    ];
    const idx = seenIndex(events, 3 * DAY, NOW);
    expect(idx.has("q-old")).toBe(false);
    expect(idx.get("q-mix")?.kinds.has("practice")).toBe(true);
    expect(idx.get("q-mix")?.kinds.has("mock")).toBe(true);
    expect(idx.get("q-mix")?.count).toBe(2);
    expect(idx.get("q-mix")?.nodes.has("hint")).toBe(true);
    const seen = recentlySeen(events, 3 * DAY, NOW);
    expect(seen.has("q-old")).toBe(false);
    expect(seen.has("q-mix")).toBe(true);
    expect(seen.has("q-new")).toBe(true);
  });

  it("not_attempted（跳过）不算曝光", () => {
    const seen = recentlySeen([ev({ verdict: "not_attempted" })], 3 * DAY, NOW);
    expect(seen.size).toBe(0);
  });
});

describe("quickDrill 去重（65-06 × 65-05 组合）", () => {
  const pool = Array.from({ length: 10 }, (_, i) =>
    makeQuestion({ type: "single", stem: `题${i}`, options: ["1", "2"], answer: "A" }),
  );

  it("池充足时避开近期已见题", () => {
    const avoid = new Set([pool[0].id, pool[1].id]);
    const picked = app.quickDrill(pool, 5, "s-1", { avoid });
    expect(picked).toHaveLength(5);
    expect(picked.some((q) => avoid.has(q.id))).toBe(false);
  });

  it("可复现：同 seed+同 avoid → 同卷", () => {
    const avoid = new Set([pool[0].id]);
    expect(app.quickDrill(pool, 5, "s-9", { avoid })).toEqual(app.quickDrill(pool, 5, "s-9", { avoid }));
  });

  it("池不足回退全量（如实，不静默缩短卷长）", () => {
    const avoid = new Set(pool.slice(0, 9).map((q) => q.id));
    const picked = app.quickDrill(pool, 5, "s-1", { avoid });
    expect(picked).toHaveLength(5); // 回退全量池仍出 5 题
  });
});

describe("recentExposureList（65-06 查询面）", () => {
  it("倒序、limit 截断、kinds/nodes 展开", () => {
    const events = [
      ev({ eid: "e-old", qid: "q-a", ts: NOW - DAY }),
      ev({ eid: "e-new", qid: "q-b", kind: "mock", ts: NOW - 1000, exposure: ["analysis"] }),
    ];
    const list = recentExposureList(events, 3 * DAY, NOW, 30);
    expect(list[0].qid).toBe("q-b");
    expect(list[0].kinds).toContain("mock");
    expect(list[0].nodes).toContain("analysis");
    expect(list).toHaveLength(2);
  });
});
