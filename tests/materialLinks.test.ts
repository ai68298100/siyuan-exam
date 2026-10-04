import { describe, it, expect } from "vitest";
import {
  linkQuestion,
  unlinkQuestion,
  refOf,
  questionsOfMaterial,
  linkNeedsRelocate,
  dropMaterial,
  serializeLinkStore,
  parseLinkStore,
  EMPTY_LINK_STORE,
} from "../src/core/materialLinks";

const NOW = 1_700_000_000_000;
const input = { qid: "q-aaa11111", materialId: "m-bbb22222", revision: 3, locator: { page: 12 } };

describe("120-05 题目↔资料关联", () => {
  it("link：新链入册；改链替换（replaced=true，一题一主链）", () => {
    const r1 = linkQuestion(EMPTY_LINK_STORE, input, NOW);
    expect(r1.replaced).toBe(false);
    expect(r1.ref.locator).toEqual({ page: 12, tSec: undefined, quote: undefined });
    const r2 = linkQuestion(r1.store, { ...input, locator: { tSec: 95 } }, NOW + 1);
    expect(r2.replaced).toBe(true);
    expect(r2.store.refs).toHaveLength(1);
    expect(r2.store.refs[0].locator).toEqual({ page: undefined, tSec: 95, quote: undefined });
    expect(r2.store.refs[0].createdAt).toBe(NOW + 1);
  });

  it("校验：qid/资料归属/版本缺失报错；locator 全空 → null（只挂资料不定位）", () => {
    expect(() => linkQuestion(EMPTY_LINK_STORE, { ...input, qid: " " })).toThrow(/qid/);
    expect(() => linkQuestion(EMPTY_LINK_STORE, { ...input, materialId: "" })).toThrow(/资料/);
    expect(() => linkQuestion(EMPTY_LINK_STORE, { ...input, revision: 0 })).toThrow(/版本/);
    const r = linkQuestion(EMPTY_LINK_STORE, { ...input, locator: null }, NOW);
    expect(r.ref.locator).toBeNull();
    expect(() => linkQuestion(EMPTY_LINK_STORE, { ...input, locator: { page: 0 } })).toThrow(/页码/);
  });

  it("查询：refOf / questionsOfMaterial 双向；unlink 删除", () => {
    const a = linkQuestion(EMPTY_LINK_STORE, input, NOW);
    const b = linkQuestion(a.store, { ...input, qid: "q-ccc33333" }, NOW + 1);
    expect(refOf(b.store, "q-aaa11111")!.materialId).toBe("m-bbb22222");
    expect(refOf(b.store, "q-none")).toBeNull();
    expect(questionsOfMaterial(b.store, "m-bbb22222")).toHaveLength(2);
    expect(questionsOfMaterial(b.store, "m-other")).toHaveLength(0);
    const u = unlinkQuestion(b.store, "q-aaa11111");
    expect(u.removed).toBe(true);
    expect(u.store.refs).toHaveLength(1);
    expect(unlinkQuestion(b.store, "q-none").removed).toBe(false);
  });

  it("换版待重定位 + 资料移除孤儿清理", () => {
    const { store, ref } = linkQuestion(EMPTY_LINK_STORE, input, NOW);
    expect(linkNeedsRelocate(ref, 3)).toBe(false);
    expect(linkNeedsRelocate(ref, 4)).toBe(true);
    const other = linkQuestion(store, { ...input, qid: "q-ddd44444", materialId: "m-other9999" }, NOW);
    const cleaned = dropMaterial(other.store, "m-bbb22222");
    expect(cleaned.refs.map((r) => r.qid)).toEqual(["q-ddd44444"]);
  });

  it("序列化往返；过版本拒绝为空+标记；非法条目剔除", () => {
    const { store } = linkQuestion(EMPTY_LINK_STORE, input, NOW);
    const back = parseLinkStore(JSON.parse(JSON.stringify(serializeLinkStore(store))));
    expect(back.store.refs).toEqual(store.refs);
    expect(back.versionTooNew).toBe(false);
    const tooNew = parseLinkStore({ v: 2, refs: [] });
    expect(tooNew.versionTooNew).toBe(true);
    expect(tooNew.store.refs).toHaveLength(0);
    const dirty = parseLinkStore({ v: 1, refs: [{ materialId: "m-1" }, { qid: "q-ok", materialId: "m-1", revision: 1, locator: null, createdAt: 0 }] });
    expect(dirty.store.refs.map((r) => r.qid)).toEqual(["q-ok"]);
    expect(parseLinkStore(undefined).store).toEqual(EMPTY_LINK_STORE);
  });
});
