// 内核客户端响应形状回归测试（2026-10-02 活内核 3.8.5 预检定案的形状锁定；
// 内核再漂移时此处先红，避免静默失效）
import { describe, it, expect } from "vitest";
import { KernelApiClient, type KernelTransport } from "../src/kernel/client";

type Call = { endpoint: string; payload: Record<string, unknown> };

function makeClient(respond: (endpoint: string, payload: Record<string, unknown>) => unknown) {
  const calls: Call[] = [];
  const t: KernelTransport = {
    async post(endpoint, payload) {
      calls.push({ endpoint, payload: payload as Record<string, unknown> });
      return { code: 0, msg: "", data: respond(endpoint, payload as Record<string, unknown>) };
    },
  };
  return { client: new KernelApiClient(t), calls };
}

describe("KernelApiClient 响应形状（3.8.5 预检定案）", () => {
  it("createRiffDeck 双形态：3.8.5 返回 {id} 对象", async () => {
    const { client } = makeClient(() => ({ id: "deck-1", name: "x", size: 0 }));
    await expect(client.createRiffDeck("x")).resolves.toBe("deck-1");
  });
  it("createRiffDeck 双形态：旧版返回裸 id 字符串", async () => {
    const { client } = makeClient(() => "deck-legacy");
    await expect(client.createRiffDeck("x")).resolves.toBe("deck-legacy");
  });
  it("getDueCards 解开 {cards} 包裹", async () => {
    const { client } = makeClient(() => ({ cards: [{ cardID: "c1", blockID: "b1" }], unreviewedCount: 1 }));
    const cards = await client.getDueCards("deck-1");
    expect(cards).toHaveLength(1);
    expect((cards[0] as { cardID: string }).cardID).toBe("c1");
  });
  it("getCardIDsByBlockIDs 主路径：blocks[].riffCardID", async () => {
    const { client } = makeClient((ep) =>
      ep === "/api/riff/getRiffCardsByBlockIDs"
        ? {
            blocks: [
              { id: "b1", riffCardID: "c1" },
              { id: "b2", riffCardID: "" },
            ],
          }
        : {},
    );
    const map = await client.getCardIDsByBlockIDs(["b1", "b2"]);
    expect(map.get("b1")).toBe("c1");
    expect(map.has("b2")).toBe(false);
  });
  it("getCardIDsByBlockIDs 回退：blocks 索引滞后空 → getRiffDueCards 兜底（带 deckId）", async () => {
    const { client, calls } = makeClient((ep) =>
      ep === "/api/riff/getRiffCardsByBlockIDs"
        ? { blocks: [{ id: "b1", riffCardID: "" }] }
        : ep === "/api/riff/getRiffDueCards"
          ? { cards: [{ cardID: "c-due", blockID: "b1" }] }
          : {},
    );
    const map = await client.getCardIDsByBlockIDs(["b1"], "deck-9");
    expect(map.get("b1")).toBe("c-due");
    expect(calls.some((c) => c.endpoint === "/api/riff/getRiffDueCards" && c.payload.deckID === "deck-9")).toBe(true);
  });
  it("insertBlock/appendQuestions 必须带 dataType:'markdown'（3.8.5 硬要求）", async () => {
    const { client, calls } = makeClient((ep) => {
      if (ep === "/api/filetree/createDocWithMd") return "doc-1";
      if (ep === "/api/block/insertBlock") return [{ doOperations: [{ id: "blk-1" }, { id: "blk-2" }] }];
      return {};
    });
    const out = await client.appendQuestions("doc-1", [
      {
        id: "q1",
        type: "single",
        stem: "s",
        options: ["a"],
        answer: "A",
        hash: "h1",
        score: 1,
        origin: "imported",
      } as never,
    ]);
    expect(out).toHaveLength(1);
    const ins = calls.find((c) => c.endpoint === "/api/block/insertBlock")!;
    expect(ins.payload.dataType).toBe("markdown");
  });
  it("exportDocMarkdown 剥 YAML 头并取文档名", async () => {
    const { client } = makeClient(() => ({
      hPath: "/资料/2023 真题",
      content: "---\ntitle: 2023 真题\ndate: 2026-10-02\n---\n\n# 正文\n",
    }));
    const r = await client.exportDocMarkdown("doc-1");
    expect(r.title).toBe("2023 真题");
    expect(r.content).toBe("# 正文");
  });
  it("setExamFav 写 custom-exam-fav 全名（attributes 表只索引 custom- 前缀）", async () => {
    const { client, calls } = makeClient(() => ({}));
    await client.setExamFav("blk-1", true);
    const c = calls.find((x) => x.endpoint === "/api/attr/setBlockAttrs")!;
    expect((c.payload.attrs as Record<string, string>)["custom-exam-fav"]).toBe("1");
  });
  it("query_embed：getBlockKramdown 返回 kramdown 字段", async () => {
    const { client } = makeClient(() => ({ kramdown: '{{SELECT 1}}\n{: id="x"}' }));
    await expect(client.getBlockKramdown("blk-1")).resolves.toContain("SELECT 1");
  });
});

describe("createNotebook 三形态（3.8.6 漂移：perf-bank 脚本实测发现；② 为旧版 preflight/mock 形态）", () => {
  it("① 3.8.6 嵌套对象 { notebook: { id } } → 取内层 id", async () => {
    const { client } = makeClient(() => ({ notebook: { id: "nb-386", name: "x", closed: false } }));
    await expect(client.createNotebook("x")).resolves.toBe("nb-386");
  });
  it('② 嵌套字符串 { notebook: "id" }（3.8.5 mock/preflight 形态）→ 取字符串', async () => {
    const { client } = makeClient(() => ({ notebook: "nb-nested-str" }));
    await expect(client.createNotebook("x")).resolves.toBe("nb-nested-str");
  });
  it("③ 裸 id 字符串 → 原样返回", async () => {
    const { client } = makeClient(() => "nb-legacy");
    await expect(client.createNotebook("x")).resolves.toBe("nb-legacy");
  });
  it("取不到 id → 显式失败，绝不带 [object Object] 下行（3.8.6 建库 P0）", async () => {
    const { client } = makeClient(() => ({ unexpected: true }));
    await expect(client.createNotebook("x")).rejects.toThrow(/notebook id/);
  });
});
