import { describe, it, expect } from "vitest";
import { sliceText, buildPrompt, extractJsonArray, generate } from "../src/ai/gen";
import { SiyuanAiChannel, OpenAiChannel } from "../src/ai/client";
import type { KernelApiClient } from "../src/kernel/client";
import type { AiChannel } from "../src/ai/client";

describe("切片与提示词", () => {
  it("段落聚合不超上限", () => {
    const text = Array.from({ length: 50 }, (_, i) => `段落${i} ${"x".repeat(200)}`).join("\n\n");
    const chunks = sliceText(text, 6000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(6100);
  });
  it("提示词含硬性规则与题型", () => {
    const msgs = buildPrompt("材料内容", { types: ["single", "judge"], count: 5, difficulty: "hard" });
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("JSON 数组");
    expect(msgs[1].content).toContain("5 道");
    expect(msgs[1].content).toContain("判断");
  });
});

describe("容错 JSON 解析", () => {
  it("裸数组", () => {
    expect(extractJsonArray('[{"a":1}]')).toEqual([{ a: 1 }]);
  });
  it("代码围栏 + 前后噪声", () => {
    const raw = '好的，以下是题目：\n```json\n[{"a":1},{"b":"x]y"}]\n```\n希望有帮助';
    expect(extractJsonArray(raw)).toEqual([{ a: 1 }, { b: "x]y" }]);
  });
  it("字符串内的括号/转义不破坏平衡", () => {
    expect(extractJsonArray('noise ["a\\"[x]b"] tail')).toEqual(["a\"[x]b"]);
  });
  it("非数组/坏 JSON → null", () => {
    expect(extractJsonArray('{"a":1}')).toBeNull();
    expect(extractJsonArray("[{broken]")).toBeNull();
    expect(extractJsonArray("完全没有")).toBeNull();
  });
});

describe("生成管线（mock 通道）", () => {
  const good = {
    type: "single", stem: "思源内核闪卡算法是什么？",
    options: ["SM-2", "FSRS"], answer: "B",
    analysis: "因为思源 3.8 集成了 go-fsrs，因此默认调度由 FSRS 驱动。",
    kp: "闪卡",
  };
  const channel: AiChannel = {
    id: "siyuan",
    async chat() {
      return "```json\n" + JSON.stringify([
        good,
        { ...good },   // 同题同指纹 → 去重
        { type: "single", stem: "解析太短", options: ["1", "2"], answer: "A", analysis: "短" },
        { type: "single", stem: "以上都对是哪个？", options: ["以上都对", "2"], answer: "A", analysis: "解析足够长，含因果说明内容。" },
        { type: "essay", stem: "坏题型", options: [], answer: "A", analysis: "解析足够长，含因果说明内容。" },
        "not-an-object",
      ]) + "\n```";
    },
  };

  it("质量门槛：好题入库；短解析/禁用选项/坏题型/非对象拒绝；重复去重", async () => {
    const r = await generate(channel, "一些材料", {
      types: ["single"], count: 10, difficulty: "mixed",
      existingHashes: new Set(),
    });
    expect(r.pending).toHaveLength(1);
    expect(r.pending[0].origin).toBe("ai");
    expect(r.pending[0].review).toBe("pending");
    expect(r.duplicates).toBe(1);
    const reasons = r.rejected.map((x) => x.reason).join("|");
    expect(reasons).toContain("解析过短");
    expect(reasons).toContain("以上都对");
    expect(reasons).toContain("题型无法识别");
    expect(reasons).toContain("非对象");
  });
  it("外部 hash 去重", async () => {
    const seed = await generate(channel, "材料", { types: ["single"], count: 10 });
    const r2 = await generate(channel, "材料", { types: ["single"], count: 10, existingHashes: new Set(seed.pending.map((q) => q.hash)) });
    expect(r2.pending).toHaveLength(0);
    expect(r2.duplicates).toBe(2);   // mock 通道两次出现同一好题，均撞外部 hash
  });
});

describe("双通道客户端", () => {
  it("思源通道：拼接 msg 并取 data 字符串", async () => {
    const kernel = { aiChat: async (msg: string) => (msg.includes("[指令]") ? "OK-JSON" : "") } as unknown as KernelApiClient;
    const out = await new SiyuanAiChannel(kernel).chat([{ role: "system", content: "S" }, { role: "user", content: "U" }]);
    expect(out).toBe("OK-JSON");
  });
  it("OpenAI 通道：Bearer 头 + choices 解析；未配置报错", async () => {
    let captured: any;
    const ch = new OpenAiChannel(
      { endpoint: "https://x/v1/chat/completions", apiKey: "sk", model: "m" },
      async (url, init) => { captured = init; return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "hi" } }] }) }; },
    );
    expect(await ch.chat([{ role: "user", content: "q" }])).toBe("hi");
    expect(captured.headers.Authorization).toBe("Bearer sk");
    expect(JSON.parse(captured.body).model).toBe("m");
    const bad = new OpenAiChannel({ endpoint: "", apiKey: "", model: "" }, async () => ({ ok: true, status: 200, text: async () => "" }));
    await expect(bad.chat([{ role: "user", content: "q" }])).rejects.toThrow(/未配置/);
  });
});
