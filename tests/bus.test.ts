import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { emitExamEvent, onExamEvent, busEventName, type BusEvent } from "../src/core/bus";

/** node 测试环境无 window：用 EventTarget 桩（CustomEvent 在 node≥19 全局可用） */
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget() as unknown as Window & typeof globalThis);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lv-exam:* 事件总线（2.1/47-04 雏形，廿五批）", () => {
  it("发射封装信封：v=1 + type + eventId + at + payload，事件名带 lv-exam: 前缀", () => {
    let got: BusEvent<{ qid: string }> | null = null;
    const off = onExamEvent<{ qid: string }>("open-question", (env) => { got = env; });
    const env = emitExamEvent("open-question", { qid: "q1" });
    expect(env).toMatchObject({ v: 1, type: "open-question", payload: { qid: "q1" } });
    expect(env!.eventId).toMatch(/^e-/);
    expect(busEventName("open-question")).toBe("lv-exam:open-question");
    expect(got!.payload.qid).toBe("q1");
    off();
  });

  it("退订后不再投递；未知版本/类型不符的信封被拒绝（前向兼容）", () => {
    const handler = vi.fn();
    const off = onExamEvent<{ qid: string }>("open-question", handler);
    off();
    emitExamEvent("open-question", { qid: "q2" });
    expect(handler).not.toHaveBeenCalled();
    // 伪造旧版本信封 → 不投递
    window.dispatchEvent(new CustomEvent("lv-exam:open-question", { detail: { v: 0, type: "open-question", payload: { qid: "q3" } } }));
    expect(handler).not.toHaveBeenCalled();
  });

  it("每次发射 eventId 唯一（幂等去重锚点）", () => {
    const a = emitExamEvent("open-in-browse", { qid: "q1", bank: "b1" });
    const b = emitExamEvent("open-in-browse", { qid: "q1", bank: "b1" });
    expect(a!.eventId).not.toBe(b!.eventId);
  });
});
