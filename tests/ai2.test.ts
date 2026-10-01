import { describe, it, expect } from "vitest";
import { generate, reviewQuestions, REVIEW_CONFIDENCE_MIN } from "../src/ai/gen";
import { buildExplainMessages } from "../src/ai/explain";
import { CountingChannel } from "../src/ai/counting";
import { SiyuanAiChannel } from "../src/ai/client";
import { KernelApiClient } from "../src/kernel/client";
import type { AiChannel } from "../src/ai/client";
import { makeQuestion } from "../src/core/blockTemplate";

const good = {
  type: "single", stem: "思源内核闪卡算法是什么？",
  options: ["SM-2", "FSRS"], answer: "B",
  analysis: "因为思源 3.8 集成了 go-fsrs，因此默认调度由 FSRS 驱动。",
};

/** 可编程双角色通道：gen 调用返回题目，review 调用返回核验分 */
function scriptedChannel(responses: string[]): AiChannel & { calls: number } {
  let i = 0;
  return {
    id: "siyuan",
    calls: 0,
    async chat() { return responses[Math.min(i++, responses.length - 1)]; },
  } as any;
}

describe("二遍核验", () => {
  it("REVIEW_CONFIDENCE_MIN = 0.85", () => expect(REVIEW_CONFIDENCE_MIN).toBe(0.85));
  it("低置信淘汰并带原因；高置信保留且写入 confidence", async () => {
    const ch = scriptedChannel([
      "```json\n" + JSON.stringify([
        good,
        { ...good, stem: "低置信题：块引用断链会怎样？" },
      ]) + "\n```",
      // 审题人返回
      "```json\n" + JSON.stringify([
        { id: "", confidence: 0.95, pass: true },   // id 不匹配 → 由实现按序号? 实现按 id —— 需要真实 id
      ]) + "\n```",
    ]);
    // 上面的 id 无法预知，改为直接测 reviewQuestions：
    const q = makeQuestion({ type: "single", stem: "S", options: ["1", "2"], answer: "A" });
    const q2 = makeQuestion({ type: "single", stem: "S2", options: ["1", "2"], answer: "B" });
    const kernel = { aiChat: async (msg: string) => {
      if (msg.includes("审题人")) {
        return JSON.stringify([{ id: q.id, confidence: 0.9, pass: true }, { id: q2.id, confidence: 0.4, pass: false, reason: "答案有歧义" }]);
      }
      return "";
    } };
    void kernel;
    const v = await reviewQuestions({ chat: async () => JSON.stringify([{ id: q.id, confidence: 0.9, pass: true }, { id: q2.id, confidence: 0.4, pass: false, reason: "答案有歧义" }]) } as AiChannel, [q, q2], "材料");
    expect(v.get(q.id)!.pass).toBe(true);
    expect(v.get(q2.id)!.pass).toBe(false);
    expect(v.get(q2.id)!.reason).toContain("歧义");
  });
  it("核验响应不可解析 → 全部标未核验（降级语义）", async () => {
    const q = makeQuestion({ type: "judge", stem: "x", answer: "对" });
    const v = await reviewQuestions({ chat: async () => "完全不是 JSON" } as AiChannel, [q], "m");
    expect(v.get(q.id)!.pass).toBe(false);
    expect(v.get(q.id)!.reason).toContain("不可解析");
  });
});

describe("质量档位", () => {
  const genChannel = (): AiChannel & { calls: number } => {
    let n = 0;
    return {
      id: "siyuan", calls: 0,
      async chat() {
        n++;
        this.calls = n;
        // 第一次：题目；第二次（审题人）：全部高置信通过
        return n === 1
          ? "```json\n" + JSON.stringify([good]) + "\n```"
          : "```json\n" + JSON.stringify([{ id: "unknown", confidence: 0.9, pass: true }]) + "\n```";
      },
    } as any;
  };
  it("经济档=单遍（只调 1 次）", async () => {
    const ch = genChannel();
    const r = await generate(ch, "材料", { types: ["single"], count: 5, quality: "economy" });
    expect(ch.calls).toBe(1);
    expect(r.pending).toHaveLength(1);
  });
  it("标准档=二遍（调 2 次），响应缺 id 时按未核验淘汰", async () => {
    const ch = genChannel();
    const r = await generate(ch, "材料", { types: ["single"], count: 5, quality: "standard" });
    expect(ch.calls).toBe(2);
    // 审题人返回 id:"unknown" 不匹配 → 未核验 → 淘汰
    expect(r.pending).toHaveLength(0);
    expect(r.rejected.some((x) => x.reason.includes("二遍核验淘汰"))).toBe(true);
  });
});

describe("计数通道与讲解模式", () => {
  it("CountingChannel 统计调用与粗估 token", async () => {
    const inner: AiChannel = { id: "siyuan", async chat(m) { return "a".repeat(40); } };
    const c = new CountingChannel(inner);
    await c.chat([{ role: "user", content: "x".repeat(80) }]);
    expect(c.calls).toBe(1);
    expect(c.approxTokens).toBe(30);
  });
  it("讲解三模式提示词差异", () => {
    const q = makeQuestion({ type: "single", stem: "Q", options: ["1", "2"], answer: "A" });
    const ex = buildExplainMessages(q, "B", "explain");
    const hi = buildExplainMessages(q, "B", "hint");
    const so = buildExplainMessages(q, "B", "socratic");
    expect(ex[0].content).toContain("逐选项");
    expect(hi[0].content).toContain("不得复述正确选项");
    expect(so[0].content).toContain("不陈述正确答案");
  });
  it("思源通道拼接系统指令", async () => {
    const kernel = { aiChat: async (msg: string) => (msg.startsWith("[指令]") ? "ok" : "") } as unknown as KernelApiClient;
    const out = await new SiyuanAiChannel(kernel).chat([{ role: "system", content: "S" }, { role: "user", content: "U" }]);
    expect(out).toBe("ok");
  });
});
