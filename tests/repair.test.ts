// repairIssues（AI 拒绝项修复重试）管道回归：可修复过滤 / 修复并回 / 修复后仍淘汰 / 去重 / prompt 内容
import { describe, it, expect } from "vitest";
import { repairIssues, type GenIssue } from "../src/ai/gen";
import type { AiChannel, AiMessage } from "../src/ai/client";

const OPT = {
  types: ["single" as const], count: 5, difficulty: "medium" as const,
  kp: "", sourceTitle: "t", preset: "default" as const, quality: "standard" as const,
};

const GOOD = JSON.stringify({
  type: "single", stem: "修复后的题干（长度足够作为合法题干使用）", options: ["甲", "乙", "丙", "丁"],
  answer: "A", analysis: "修复后的解析，含因果解释链，长度超过三十字的门槛线以上才可以通过。", kp: "K",
});

/** 复合 mock：出题/修复调用返回脚本；审题人调用按待核题目动态回 verdict（reviewQuestions 按 id 匹配） */
function smartChannel(repairResponse: string, verdict: { confidence: number; pass: boolean; reason?: string } = { confidence: 0.95, pass: true }) {
  const seen: AiMessage[][] = [];
  const channel: AiChannel = {
    id: "openai" as const,
    async chat(messages: AiMessage[]) {
      seen.push(messages);
      if (messages[0]?.content.includes("审题人")) {
        const m = messages[1].content.match(/【待核题目】\n(\[[\s\S]*\])/);
        const arr = m ? (JSON.parse(m[1]) as { id: string }[]) : [];
        return JSON.stringify(arr.map((x) => ({ id: x.id, ...verdict })));
      }
      return repairResponse;
    },
  };
  return { channel, seen };
}

describe("repairIssues", () => {
  it("可修复过滤：非 JSON raw 原样保留在 rejected", async () => {
    const { channel } = smartChannel(JSON.stringify([JSON.parse(GOOD)]));
    const issues: GenIssue[] = [
      { index: 1, reason: "响应不是有效 JSON 数组", raw: "<html>bad" },
      { index: 2, reason: "二遍核验淘汰：置信 0.40", raw: GOOD },
    ];
    const r = await repairIssues(channel, issues, "材料", OPT);
    expect(r.pending).toHaveLength(1);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].index).toBe(1);
  });
  it("修复通过二遍核验 → 并回 pending", async () => {
    const { channel } = smartChannel(JSON.stringify([JSON.parse(GOOD)]));
    const issues: GenIssue[] = [{ index: 1, reason: "置信低", raw: GOOD }];
    const r = await repairIssues(channel, issues, "材料", OPT);
    expect(r.pending).toHaveLength(1);
    expect(r.pending[0].confidence).toBeCloseTo(0.95);
  });
  it("重复题目按 hash 计 duplicates 不重复入库", async () => {
    const { channel } = smartChannel(JSON.stringify([JSON.parse(GOOD), JSON.parse(GOOD)]));
    const issues: GenIssue[] = [{ index: 1, reason: "置信低", raw: GOOD }];
    const r = await repairIssues(channel, issues, "材料", OPT);
    expect(r.pending).toHaveLength(1);
    expect(r.duplicates).toBe(1);
  });
  it("修复后二遍核验仍淘汰 → 留在 rejected 且 raw 为完整 JSON", async () => {
    const { channel } = smartChannel(JSON.stringify([JSON.parse(GOOD)]), { confidence: 0.1, pass: false, reason: "仍不行" });
    const issues: GenIssue[] = [{ index: 1, reason: "置信低", raw: GOOD }];
    const r = await repairIssues(channel, issues, "材料", OPT);
    expect(r.pending).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].reason).toContain("修复后核验仍淘汰");
    expect(r.rejected[0].raw.startsWith("{\"type\"")).toBe(true);
  });
  it("修复响应不可解析 → 原样保留并标注", async () => {
    const { channel } = smartChannel("抱歉我无法输出 JSON");
    const issues: GenIssue[] = [{ index: 7, reason: "置信低", raw: GOOD }];
    const r = await repairIssues(channel, issues, "材料", OPT);
    expect(r.pending).toHaveLength(0);
    expect(r.rejected[0].reason).toContain("修复响应不可解析");
    expect(r.rejected[0].index).toBe(7);
  });
  it("修复 prompt 携带否决原因与原题 JSON；材料作为上下文", async () => {
    const { channel, seen } = smartChannel(JSON.stringify([JSON.parse(GOOD)]));
    const issues: GenIssue[] = [{ index: 1, reason: "干扰项同质", raw: GOOD }];
    await repairIssues(channel, issues, "原始材料", OPT);
    const user = seen[0].find((m) => m.role === "user")!.content;
    expect(user).toContain("干扰项同质");
    expect(user).toContain("原始材料");
    expect(user).toContain("\"stem\"");
  });
});
