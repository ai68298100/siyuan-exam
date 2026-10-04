import { describe, it, expect } from "vitest";
import {
  buildFlashCandidateMessages,
  parseFlashCandidates,
  findCardLeaks,
  summarizeLoad,
} from "../src/ai/flashCandidates";
import type { Question } from "../src/core/types";

const q: Question = {
  id: "q-flash001",
  type: "single",
  stem: "FSRS 的目标记忆保留率参数含义是？",
  options: ["期望保留率", "遗忘系数", "间隔上限"],
  answer: "A",
  analysis: "FSRS 以期望保留率（request retention）为核心参数，默认 0.9。",
  score: 1,
  origin: "manual",
  hash: "h",
};

describe("116-03 T10 闪卡候选", () => {
  it("消息构造：证据齐备（题面/答案/解析/反思）且红线入 system", () => {
    const msgs = buildFlashCandidateMessages(q, { reflection: "我以为 retention 是间隔上限" });
    const sys = msgs[0].content;
    expect(sys).toContain('"cards"');
    expect(sys).toContain("一张卡一个原子事实");
    expect(sys).toContain("front 不得包含 back");
    expect(sys).toContain("不凑数");
    const user = msgs[1].content;
    expect(user).toContain("正确答案：A");
    expect(user).toContain("用户反思/自我解释：我以为 retention 是间隔上限");
  });

  it("解析：剥围栏取 JSON、截 5 张、丢非法卡、来源白名单外归「补充」", () => {
    const raw = "```json\n" + JSON.stringify({
      cards: [
        { type: "qa", front: "FSRS 的核心参数是？", back: "期望保留率（request retention）", source: "解析" },
        { type: "bad", front: "x", back: "y", source: "解析" },
        { type: "cloze", front: "FSRS 默认期望保留率是 ____。", back: "0.9", source: "自编" },
        { type: "qa", front: "只有正面", back: "", source: "解析" },
        { type: "contrast", front: "保留率高 vs 低的取舍？", back: "高=记得牢复习频；低=更省时", source: "反思" },
        { type: "qa", front: "第 6 张", back: "被截断", source: "补充" },
        { type: "qa", front: "第 7 张", back: "被截断", source: "补充" },
      ],
      splitReason: "一个参数一张卡，对照卡讲取舍",
    }) + "\n```";
    const r = parseFlashCandidates(raw);
    expect(r.cards).toHaveLength(5);
    expect(r.cards[0].source).toBe("解析");
    expect(r.cards[1].source).toBe("补充");
    expect(r.cards[1].back).toBe("0.9");
    expect(r.splitReason).toContain("一张卡");
  });

  it("解析失败给可行动错误（非 JSON / 无卡）", () => {
    expect(() => parseFlashCandidates("好的，以下是卡片：……")).toThrow(/JSON/);
    expect(() => parseFlashCandidates('{"cards":[{"type":"qa","front":"","back":""}]}')).toThrow(/可用的卡候选/);
  });

  it("泄露守卫：front 含 back（≥4 字）与 front=back 命中；正常卡干净", () => {
    const leaks = findCardLeaks([
      { type: "qa", front: "FSRS 的核心参数是期望保留率（request retention）吗？", back: "期望保留率", source: "解析" },
      { type: "qa", front: "同一个问题", back: "同一个问题", source: "补充" },
      { type: "cloze", front: "FSRS 默认期望保留率是 ____。", back: "0.9", source: "解析" },
    ]);
    expect(leaks).toHaveLength(2);
    expect(findCardLeaks([{ type: "qa", front: "FSRS 的核心参数是？", back: "期望保留率", source: "解析" }])).toEqual([]);
  });

  it("负荷汇总：卡数/题型/来源一览（确认前展示）", () => {
    const s = summarizeLoad([
      { type: "qa", front: "a", back: "b", source: "解析" },
      { type: "cloze", front: "c", back: "d", source: "反思" },
      { type: "qa", front: "e", back: "f", source: "反思" },
    ]);
    expect(s).toBe("3 张（问答 2 / 挖空 1）· 来源：解析 1、反思 2");
  });

  it("system 对无解析/无反思的输入要求不编造", () => {
    const user = buildFlashCandidateMessages(q, {})[1].content;
    expect(user).toContain("（无——卡面来源不要标「反思」）");
  });
});
