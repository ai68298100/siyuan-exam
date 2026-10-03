import { describe, it, expect } from "vitest";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";
import type { Question } from "../src/core/types";
import { makeQuestion } from "../src/core/blockTemplate";

/** stub 内核：riff/SQL/属性写 全记录 */
function stubClient(opts: { decks?: { id: string; name: string }[]; failAttrOn?: Set<string> } = {}) {
  const calls = {
    addRiffCards: [] as { deckId: string; blockIds: string[] }[],
    reviewRiffCard: [] as { cardId: string; deckId: string; rating: number }[],
    setExamAttrs: [] as { blockId: string; attrs: Record<string, string> }[],
    appendBlock: [] as { parentId: string; md: string }[],
    createRiffDeck: [] as string[],
  };
  let decks = opts.decks ?? [];
  const client = {
    sql: async () => [],
    getRiffDecks: async () => decks,
    createRiffDeck: async (name: string) => { calls.createRiffDeck.push(name); decks = [...decks, { id: "deck-1", name }]; return "deck-1"; },
    addRiffCards: async (deckId: string, blockIds: string[]) => { calls.addRiffCards.push({ deckId, blockIds }); },
    getCardIDsByBlockIDs: async (blockIds: string[]) => new Map(blockIds.map((b) => [b, `card-${b}`])),
    reviewRiffCard: async (cardId: string, deckId: string, rating: number) => { calls.reviewRiffCard.push({ cardId, deckId, rating }); },
    setExamAttrs: async (blockId: string, attrs: Record<string, string>) => {
      if (opts.failAttrOn?.has(blockId)) throw new Error("attr write failed");
      calls.setExamAttrs.push({ blockId, attrs });
    },
    appendBlock: async (parentId: string, md: string) => { calls.appendBlock.push({ parentId, md }); return ["id1"]; },
  } as unknown as KernelApiClient;
  return { client, calls, setDecks: (d: { id: string; name: string }[]) => (decks = d) };
}

const mkApp = (client: KernelApiClient, kernelOnline = true) => {
  const app = new ExamApp({ client, storage: new MemoryStorage(), now: () => 1_800_000_000_000 });
  app.kernelOnline = kernelOnline;
  return app;
};

const qWithBlock = (id: string): Question & { blockId?: string } => ({ ...makeQuestion({ type: "single", stem: id, options: ["1", "2"], answer: "A" }), id, blockId: `b-${id}` });

describe("应用层记忆/写入路径（应用编排层测试补盲）", () => {
  it("reciteAnswer：自评落流水（≥3 记对，<3 记错）且已转卡题同步 riff 评级", async () => {
    const { client, calls } = stubClient({ decks: [{ id: "deck-1", name: "小驴考试/公考" }] });
    const app = mkApp(client);
    const q = qWithBlock("q1");
    await app.reciteAnswer("公考", q, 2, "s1");          // 不会
    await app.reciteAnswer("公考", q, 4, "s1");          // 熟知
    const events = app.attempts.all();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: "recite", verdict: "wrong", selfRating: 2 });
    expect(events[1]).toMatchObject({ kind: "recite", verdict: "correct", selfRating: 4 });
    expect(calls.reviewRiffCard).toHaveLength(2);
    expect(calls.reviewRiffCard[1].rating).toBe(3);      // 4→Easy(3)
  });

  it("convertToCards：只送有块 ID 的题；无块返回 0 不调内核", async () => {
    const { client, calls } = stubClient();
    const app = mkApp(client);
    const n1 = await app.convertToCards("bank1", "公考", [qWithBlock("a"), qWithBlock("b"), { ...makeQuestion({ type: "single", stem: "noblock", options: [], answer: "A" }), id: "c" }]);
    expect(n1).toBe(2);
    expect(calls.addRiffCards[0].blockIds).toEqual(["b-a", "b-b"]);
    const n2 = await app.convertToCards("bank1", "公考", [{ ...makeQuestion({ type: "single", stem: "x", options: [], answer: "A" }), id: "d" }]);
    expect(n2).toBe(0);
    expect(calls.addRiffCards).toHaveLength(1);
  });

  it("applyBatchEdit：逐题写属性计数回执；失败不中断；离线拒绝", async () => {
    const { client, calls } = stubClient({ failAttrOn: new Set(["b2"]) });
    const app = mkApp(client);
    const r = await app.applyBatchEdit([
      { blockId: "b1", field: "kp", to: "言语" },
      { blockId: "b2", field: "kp", to: "数量" },
      { blockId: "b3", field: "difficulty", to: "3" },
    ]);
    expect(r).toEqual({ ok: 2, failed: 1 });
    const byBlock = new Map(calls.setExamAttrs.map((c) => [c.blockId, c.attrs]));
    expect(byBlock.get("b1")).toEqual({ "exam-kp": "言语" });
    expect(byBlock.get("b3")).toEqual({ "exam-difficulty": "3" });
    expect(byBlock.has("b2")).toBe(false);               // 失败项未写入
    const offline = mkApp(client, false);
    await expect(offline.applyBatchEdit([{ blockId: "b1", field: "kp", to: "x" }])).rejects.toThrow("离线");
  });

  it("findQuestionByBlock：跨库定位命中；离线返回 null", async () => {
    const target = { ...qWithBlock("hit"), rootId: "r1" } as Question & { blockId: string; rootId: string };
    const client = {
      sql: async () => [],
      listQuestions: async (nb: string) => (nb === "bank2" ? [target] : []),
      getRiffDecks: async () => [],
    } as unknown as KernelApiClient;
    const app = mkApp(client, true);
    app["banks"] = [{ id: "bank1", name: "A", createdAt: 1 }, { id: "bank2", name: "B", createdAt: 2 }] as never;
    const hit = await app.findQuestionByBlock("b-hit");
    expect(hit?.bank.id).toBe("bank2");
    expect(hit?.q.id).toBe("hit");
    expect(await app.findQuestionByBlock("missing")).toBeNull();
    const offline = mkApp(client, false);
    expect(await offline.findQuestionByBlock("b-hit")).toBeNull();
  });
});
