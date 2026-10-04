import { describe, it, expect } from "vitest";
import {
  normalizeNoteInput,
  addNote,
  updateNote,
  deleteNote,
  notesOfMaterial,
  needsRelocate,
  parseTimeToSec,
  formatSecToTime,
  locatorLabel,
  locatedUrl,
  serializeNoteStore,
  parseNoteStore,
  EMPTY_NOTE_STORE,
} from "../src/core/materialNotes";
import type { MaterialNoteStore } from "../src/core/materialNotes";

const NOW = 1_700_000_000_000;
const input = {
  materialId: "m-abc12345",
  revision: 2,
  locator: { page: 12 },
  text: "这页的公式推导有跳步",
  tags: ["公式", " 疑问 ", "公式"],
};

describe("121/122-02 locator 解析与展示", () => {
  it("parseTimeToSec：mm:ss / h:mm:ss / 裸秒；越界报错", () => {
    expect(parseTimeToSec("12:05")).toBe(725);
    expect(parseTimeToSec("1:02:03")).toBe(3723);
    expect(parseTimeToSec("90")).toBe(90);
    expect(() => parseTimeToSec("12:75")).toThrow(/越界/);
    expect(() => parseTimeToSec("abc")).toThrow(/mm:ss/);
  });

  it("formatSecToTime 与 parse 互逆（<1h 与 ≥1h）", () => {
    expect(formatSecToTime(725)).toBe("12:05");
    expect(formatSecToTime(3723)).toBe("1:02:03");
    expect(formatSecToTime(0)).toBe("0:00");
  });

  it("locatorLabel：页/时间/引文组合", () => {
    expect(locatorLabel({ page: 12 })).toBe("P12");
    expect(locatorLabel({ tSec: 725 })).toBe("12:05");
    expect(locatorLabel({ page: 3, quote: "勾股定理" })).toBe("P3 · 「勾股定理」");
    expect(locatorLabel(null)).toBe("");
  });

  it("locatedUrl：PDF 追加 #page、媒体追加 #t、幂等去旧片段；非 http 拒绝", () => {
    const u = "http://127.0.0.1:6806/assets/lv-exam/a.pdf";
    expect(locatedUrl(u, { page: 12 })).toBe(`${u}#page=12`);
    expect(locatedUrl(`${u}#page=3`, { page: 12 })).toBe(`${u}#page=12`);
    const v = "https://x.com/a.mp4";
    expect(locatedUrl(v, { tSec: 725.4 })).toBe(`${v}#t=725`);
    expect(locatedUrl(v, null)).toBe(v);
    expect(locatedUrl("javascript:alert(1)", { page: 1 })).toBeNull();
    expect(locatedUrl(null, { page: 1 })).toBeNull();
  });
});

describe("121/122-03 笔记 CRUD", () => {
  it("normalize：text 必填、标签去空去重截 8、引文截 120、页码/秒校验", () => {
    const n = normalizeNoteInput(input);
    expect(n.tags).toEqual(["公式", "疑问"]);
    expect(() => normalizeNoteInput({ ...input, text: "  " })).toThrow(/内容为空/);
    expect(() => normalizeNoteInput({ ...input, locator: { page: 0 } })).toThrow(/页码/);
    expect(() => normalizeNoteInput({ ...input, locator: { tSec: -1 } })).toThrow(/时间点/);
    expect(() => normalizeNoteInput({ ...input, locator: {} })).toThrow(/至少含/);
    expect(() => normalizeNoteInput({ ...input, revision: 0 })).toThrow(/版本/);
    const longQuote = normalizeNoteInput({ ...input, locator: { quote: "x".repeat(200) } });
    expect(longQuote.locator!.quote).toHaveLength(120);
  });

  it("addNote：新 store 追加且不动原 store；notesOfMaterial 按资料过滤", () => {
    const r = addNote(EMPTY_NOTE_STORE, input, NOW);
    expect(r.note.id).toMatch(/^n-/);
    expect(r.note.revision).toBe(2);
    expect(r.store.notes).toHaveLength(1);
    expect(EMPTY_NOTE_STORE.notes).toHaveLength(0);
    const r2 = addNote(r.store, { ...input, materialId: "m-other", text: "另一份资料" }, NOW + 1);
    expect(notesOfMaterial(r2.store, "m-abc12345")).toHaveLength(1);
    expect(notesOfMaterial(r2.store, "m-other")).toHaveLength(1);
  });

  it("updateNote：仅更新所给字段，revision/materialId 绑定不变；缺 id 返回 null", () => {
    const { store, note } = addNote(EMPTY_NOTE_STORE, input, NOW);
    const r = updateNote(store, note.id, { text: "改口径：是例 3 跳步", locator: { page: 13, tSec: undefined } }, NOW + 5);
    expect(r.note!.text).toBe("改口径：是例 3 跳步");
    expect(r.note!.locator!.page).toBe(13);
    expect(r.note!.revision).toBe(2);
    expect(r.note!.updatedAt).toBe(NOW + 5);
    expect(r.note!.tags).toEqual(["公式", "疑问"]);
    expect(updateNote(store, "n-nope", { text: "x" }).note).toBeNull();
    // 清空定位：locator=null 合法
    const r2 = updateNote(store, note.id, { locator: null }, NOW + 6);
    expect(r2.note!.locator).toBeNull();
  });

  it("deleteNote 与 needsRelocate（换版判定，不自动改绑）", () => {
    const { store, note } = addNote(EMPTY_NOTE_STORE, input, NOW);
    expect(needsRelocate(note, 2)).toBe(false);
    expect(needsRelocate(note, 3)).toBe(true);
    const after = deleteNote(store, note.id);
    expect(after.notes).toHaveLength(0);
    expect(store.notes).toHaveLength(1);
  });
});

describe("序列化", () => {
  it("往返一致；过版本拒绝为空+标记；非法条目剔除", () => {
    const { store } = addNote(EMPTY_NOTE_STORE, input, NOW);
    const back = parseNoteStore(JSON.parse(JSON.stringify(serializeNoteStore(store))));
    expect((back.store as MaterialNoteStore).notes).toEqual(store.notes);
    expect(back.versionTooNew).toBe(false);
    const tooNew = parseNoteStore({ v: 2, notes: [] });
    expect(tooNew.versionTooNew).toBe(true);
    expect(tooNew.store.notes).toHaveLength(0);
    const dirty = parseNoteStore({ v: 1, notes: [{ id: "x" }, { id: "n-ok", materialId: "m-1", text: "t", revision: 1, locator: null, tags: [], createdAt: 0, updatedAt: 0 }] });
    expect(dirty.store.notes.map((n) => n.id)).toEqual(["n-ok"]);
    expect(parseNoteStore(undefined).store).toEqual(EMPTY_NOTE_STORE);
  });
});
