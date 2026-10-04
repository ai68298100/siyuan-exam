import { describe, it, expect } from "vitest";
import {
  addMisdiagnosis,
  latestOf,
  markAdopted,
  serializeMisdiagnosis,
  parseMisdiagnosis,
  EMPTY_MISDIAGNOSIS,
} from "../src/core/misdiagnosis";
import type { MisdiagnosisRecord } from "../src/core/misdiagnosis";

const rec = (qid: string, at: number, text = "【事实】…【错因假设】…【验证行动】…"): MisdiagnosisRecord => ({
  qid,
  text,
  at,
  sessionId: "s-1",
  evidence: { myAnswer: "B", confidence: "sure", timeMs: 30_000, helped: true },
});

describe("116-01/U14 错因假设独立存储", () => {
  it("同题保留最新（重生成取代旧假设），上限 200 FIFO", () => {
    let s = addMisdiagnosis(EMPTY_MISDIAGNOSIS, rec("q-a", 1, "v1"));
    s = addMisdiagnosis(s, rec("q-b", 2));
    s = addMisdiagnosis(s, rec("q-a", 3, "v2"));
    expect(s.items).toHaveLength(2);
    expect(latestOf(s, "q-a")!.text).toBe("v2");
    expect(latestOf(s, "q-a")!.at).toBe(3);
    expect(latestOf(s, "q-none")).toBeNull();
    let big = EMPTY_MISDIAGNOSIS;
    for (let i = 0; i < 210; i++) big = addMisdiagnosis(big, rec(`q-x${i}`, i));
    expect(big.items).toHaveLength(200);
  });

  it("缺 qid/文本报错；adopted 只打点不改原文", () => {
    expect(() => addMisdiagnosis(EMPTY_MISDIAGNOSIS, rec("", 1))).toThrow(/qid/);
    expect(() => addMisdiagnosis(EMPTY_MISDIAGNOSIS, rec("q-a", 1, "  "))).toThrow(/文本/);
    const s = addMisdiagnosis(EMPTY_MISDIAGNOSIS, rec("q-a", 1));
    const after = markAdopted(s, "q-a", 99);
    expect(after.items[0].adoptedAt).toBe(99);
    expect(after.items[0].text).toBe(s.items[0].text);
    expect(markAdopted(s, "q-none").items[0].adoptedAt).toBeUndefined();
  });

  it("序列化往返；过版本拒绝为空+标记；非法条目剔除", () => {
    const s = addMisdiagnosis(EMPTY_MISDIAGNOSIS, rec("q-a", 1));
    const back = parseMisdiagnosis(JSON.parse(JSON.stringify(serializeMisdiagnosis(s))));
    expect(back.store.items).toEqual(s.items);
    expect(back.versionTooNew).toBe(false);
    const tooNew = parseMisdiagnosis({ v: 2, items: [] });
    expect(tooNew.versionTooNew).toBe(true);
    const dirty = parseMisdiagnosis({ v: 1, items: [{ qid: "q-a" }, rec("q-ok", 5)] });
    expect(dirty.store.items.map((r) => r.qid)).toEqual(["q-ok"]);
    expect(parseMisdiagnosis(undefined).store).toEqual(EMPTY_MISDIAGNOSIS);
  });
});
