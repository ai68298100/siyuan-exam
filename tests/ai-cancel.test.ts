import { describe, expect, it } from "vitest";
import { generate } from "../src/ai/gen";
import type { AiChannel } from "../src/ai/client";

const candidate = JSON.stringify([{
  type: "single",
  stem: "这是一道用于取消回归的题目？",
  options: ["甲", "乙"],
  answer: "A",
  analysis: "因为材料明确给出甲项，所以甲项是本题唯一正确答案。",
}]);

describe("AI generation cancellation", () => {
  it("drops a late in-flight chunk while keeping completed chunks", async () => {
    const signal = { aborted: false };
    let calls = 0;
    let release: (() => void) | undefined;
    const channel: AiChannel = {
      id: "siyuan",
      async chat() {
        calls++;
        if (calls === 1) return candidate;
        await new Promise<void>((resolve) => { release = resolve; });
        return candidate;
      },
    };
    const run = generate(channel, `${"第一段材料".repeat(1400)}\n\n第二段材料`, {
      types: ["single"], count: 2, difficulty: "medium", quality: "economy", signal,
    });
    // Let the second request enter its in-flight wait, then emulate the UI's
    // cancel action before the provider returns.
    await new Promise((resolve) => setTimeout(resolve, 0));
    signal.aborted = true;
    release?.();
    const result = await run;
    expect(calls).toBe(2);
    expect(result.pending).toHaveLength(1);
  });
});
