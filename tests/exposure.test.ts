// 63-02：暴露记录测试（节点集合保全/向后兼容 help 派生/逐节点计数/布尔事实口径）
import { describe, expect, it } from "vitest";
import { abandonedExposureInputs, helpFromExposure, exposureNodeCounts } from "../src/core/exposure";
import { exposureStats } from "../src/core/report";
import type { AttemptEvent } from "../src/core/types";

let seq = 0;
function ev(partial: Partial<AttemptEvent>): AttemptEvent {
  return {
    v: 2,
    eid: `e-${++seq}`,
    ts: 1_800_000_000_000 + seq * 1000,
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

describe("helpFromExposure（向后兼容派生）", () => {
  it("取最具揭示性的受助节点；无受助 → undefined", () => {
    expect(helpFromExposure(["hint", "explain", "followup"])).toBe("explain");
    expect(helpFromExposure(["hint", "followup"])).toBe("hint");
    expect(helpFromExposure(["material", "analysis"])).toBeUndefined();
    expect(helpFromExposure([])).toBeUndefined();
  });
});

describe("exposureNodeCounts（逐节点计数）", () => {
  it("跨事件计数；无 exposure 字段的旧事件如实为空", () => {
    const counts = exposureNodeCounts([
      ev({ exposure: ["hint", "analysis"] }),
      ev({ exposure: ["hint", "followup"] }),
      ev({}), // 旧事件
    ]);
    expect(counts).toEqual({ hint: 2, analysis: 1, followup: 1 });
  });
});

describe("exposureStats 扩展（节点计数并入三口径）", () => {
  it("三口径不受影响 + nodes 逐节点累计；not_attempted 不计", () => {
    const events: AttemptEvent[] = [
      ev({ confidence: "sure", verdict: "correct", exposure: ["material", "analysis"] }),
      ev({ confidence: "guess", verdict: "wrong", help: "hint", exposure: ["hint"] }),
      ev({ verdict: "not_attempted", exposure: ["analysis"] }),
    ];
    const r = exposureStats(events);
    expect(r.attempts).toBe(2);
    expect(r.independent).toBe(1);
    expect(r.assisted).toBe(1);
    expect(r.nodes).toEqual({ material: 1, analysis: 1, hint: 1 });
  });
});

describe("abandonedExposureInputs（63-02 边界前推）", () => {
  const exposures = new Map<string, Set<string>>([
    ["q-hint", new Set(["hint", "material"])],
    ["q-done", new Set(["analysis"])], // 已提交 → 不重复落
    ["q-empty", new Set()], // 无暴露 → 不落
  ]);
  const answered = ["q-done"];

  it("只生成未提交且确有暴露的 exposure-only 事件", () => {
    const out = abandonedExposureInputs(answered, exposures, { kind: "practice", mode: "daily", sessionId: "s-1" });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      qid: "q-hint", kind: "practice", mode: "daily", sessionId: "s-1",
      verdict: "not_attempted", myAnswer: null, exposure: ["hint", "material"],
    });
  });

  it("全空 exposures → 零事件", () => {
    expect(abandonedExposureInputs([], new Map(), { kind: "practice", mode: "daily", sessionId: "s" })).toEqual([]);
  });
});
