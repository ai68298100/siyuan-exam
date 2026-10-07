// 43-01 lite：题目修订时间线纯函数测试
import { describe, expect, it } from "vitest";
import { appendRevision, specChanged, MAX_REVISIONS, type RevisionStore } from "../src/core/revision";

describe("appendRevision（43-01 修订时间线）", () => {
  it("追加并保留最近 10 条（FIFO）", () => {
    let store: RevisionStore = {};
    for (let i = 0; i < MAX_REVISIONS + 3; i++) {
      store = appendRevision(store, "q1", { ts: 1000 + i, answer: `答案${i}` });
    }
    expect(store.q1).toHaveLength(MAX_REVISIONS);
    expect(store.q1[0].answer).toBe("答案3"); // 最早 3 条被挤出
    expect(store.q1[MAX_REVISIONS - 1].answer).toBe("答案12");
  });

  it("答案与考点均未变 → 不重复记录", () => {
    let store: RevisionStore = {};
    store = appendRevision(store, "q1", { ts: 1, answer: "A", kp: "K" });
    store = appendRevision(store, "q1", { ts: 2, answer: "A", kp: "K" });
    expect(store.q1).toHaveLength(1);
  });

  it("答案未变但考点变了 → 记录（考点也是修订面）", () => {
    let store: RevisionStore = {};
    store = appendRevision(store, "q1", { ts: 1, answer: "A", kp: "旧" });
    store = appendRevision(store, "q1", { ts: 2, answer: "A", kp: "新" });
    expect(store.q1).toHaveLength(2);
    expect(store.q1[1].kp).toBe("新");
  });

  it("答案与考点未变但判分规格变了 → 仍记录", () => {
    let store: RevisionStore = {};
    store = appendRevision(store, "q1", { ts: 1, answer: "A", kp: "K" });
    store = appendRevision(store, "q1", { ts: 2, answer: "A", kp: "K", specChanged: true });
    expect(store.q1).toHaveLength(2);
  });

  it("不同题互不干扰", () => {
    let store: RevisionStore = {};
    store = appendRevision(store, "q1", { ts: 1, answer: "A" });
    store = appendRevision(store, "q2", { ts: 2, answer: "B" });
    expect(store.q1).toHaveLength(1);
    expect(store.q2).toHaveLength(1);
  });
});

describe("specChanged（54 联动标记）", () => {
  it("双向缺失视为未变；键序无关的等价对象视为未变；内容不同视为变更", () => {
    expect(specChanged(undefined, undefined)).toBe(false);
    expect(specChanged({ v: 1, kind: "numeric" }, { kind: "numeric", v: 1 })).toBe(false); // 键序无关
    expect(specChanged({ v: 1, kind: "numeric" }, undefined)).toBe(true);
    expect(specChanged({ v: 1, kind: "numeric", unit: "m" }, { v: 1, kind: "numeric" })).toBe(true);
  });

  it("递归比较多空题嵌套字段，字段顺序不影响结果", () => {
    const a = {
      v: 1,
      kind: "multiBlank",
      blanks: [{ answers: ["甲", "乙"], caseSensitive: false }],
    };
    const same = {
      blanks: [{ caseSensitive: false, answers: ["甲", "乙"] }],
      kind: "multiBlank",
      v: 1,
    };
    const changed = {
      blanks: [{ caseSensitive: false, answers: ["甲", "丙"] }],
      kind: "multiBlank",
      v: 1,
    };
    expect(specChanged(a, same)).toBe(false);
    expect(specChanged(a, changed)).toBe(true);
  });
});
