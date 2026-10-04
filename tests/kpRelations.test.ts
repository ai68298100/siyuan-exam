import { describe, it, expect } from "vitest";
import {
  addRelation,
  removeRelation,
  setConfirmed,
  detectPrereqCycles,
  invalidEndpoints,
  diffSyllabusVersions,
  serializeRelations,
  parseRelations,
  EMPTY_RELATIONS,
} from "../src/core/kpRelations";
import type { KpRelation, RelationKind } from "../src/core/kpRelations";
import { parseSyllabus } from "../src/core/syllabus";
import type { SyllabusNode } from "../src/core/syllabus";

const rel = (from: string, to: string, kind: RelationKind = "prereq", confirmed = true, source = "manual"): KpRelation => ({
  from, to, kind, confirmed, source: source as KpRelation["source"], createdAt: 1,
});

describe("51-04 关系契约 CRUD", () => {
  it("同 from+to+kind 去重（后到覆盖）；自环与空端点拒绝；上限 1000", () => {
    let d = addRelation(EMPTY_RELATIONS, rel("资料分析", "增速计算"));
    d = addRelation(d, rel("资料分析", "增速计算", "prereq", false, "ai-proposal"));
    expect(d.relations).toHaveLength(1);
    expect(d.relations[0].confirmed).toBe(false); // 后到覆盖确认态
    expect(() => addRelation(d, rel("A", "A"))).toThrow(/自环/);
    expect(() => addRelation(d, rel("", "B"))).toThrow(/端点/);
    let big = EMPTY_RELATIONS;
    for (let i = 0; i < 1010; i++) big = addRelation(big, rel(`a${i}`, `b${i}`, "related"));
    expect(big.relations).toHaveLength(1000);
  });

  it("remove / setConfirmed", () => {
    let d = addRelation(EMPTY_RELATIONS, rel("A", "B", "related"));
    d = setConfirmed(d, { from: "A", to: "B", kind: "related" }, true);
    expect(d.relations[0].confirmed).toBe(true);
    d = removeRelation(d, { from: "A", to: "B", kind: "related" });
    expect(d.relations).toHaveLength(0);
  });
});

describe("51-04 先修循环检测（小型大纲可验证）", () => {
  it("A→B→C→A 成环被检出；未确认提案不参与；无环为空", () => {
    let d = addRelation(EMPTY_RELATIONS, rel("A", "B"));
    d = addRelation(d, rel("B", "C"));
    d = addRelation(d, rel("C", "A"));
    expect(detectPrereqCycles(d.relations)).toHaveLength(1);
    // 断开一环即无环
    const broken = removeRelation(d, { from: "C", to: "A", kind: "prereq" });
    expect(detectPrereqCycles(broken.relations)).toEqual([]);
    // 未确认的成环提案不算数（人工确认前不参与拓扑）
    const proposal = addRelation(broken, rel("C", "A", "prereq", false, "ai-proposal"));
    expect(detectPrereqCycles(proposal.relations)).toEqual([]);
    expect(detectPrereqCycles(EMPTY_RELATIONS.relations)).toEqual([]);
  });
});

describe("51-04 失效节点", () => {
  it("端点不在已知 kp 集合 → missing from/to/both", () => {
    const d = addRelation(EMPTY_RELATIONS, rel("资料分析", "增速计算", "prereq"));
    const known = new Set(["资料分析"]);
    const inv = invalidEndpoints(d.relations, known);
    expect(inv).toHaveLength(1);
    expect(inv[0].missing).toBe("to");
    const d2 = addRelation(d, rel("不存在A", "不存在B", "related"));
    const inv2 = invalidEndpoints(d2.relations, known);
    expect(inv2.filter((x) => x.missing === "both")).toHaveLength(1);
  });
});

describe("51-04 跨版本大纲映射", () => {
  const v1 = parseSyllabus("# 第一章 资料\n## 增长率\n# 第二章 数量\n# 附录\n## 公式");
  const v2 = parseSyllabus("# 第一章 资料分析\n## 增长率\n# 第三章 判断\n# 附录\n## 公式");

  it("unchanged/moved/added/removed 四类齐备（同名不同位=moved）", () => {
    const diff = diffSyllabusVersions(v1 as SyllabusNode[], v2 as SyllabusNode[]);
    expect(diff.unchanged).toContain("附录/公式");
    expect(diff.moved.some((m) => m.includes("增长率"))).toBe(true);
    expect(diff.added).toContain("第三章 判断");
    expect(diff.removed).toContain("第二章 数量");
  });

  it("空版本 → 全 added/全 removed", () => {
    expect(diffSyllabusVersions([], v1).added.length).toBe(5);
    expect(diffSyllabusVersions(v1, []).removed.length).toBe(5);
  });
});

describe("序列化", () => {
  it("往返一致；过版本拒绝+标记；非法 kind/source 条目剔除", () => {
    const d = addRelation(EMPTY_RELATIONS, rel("A", "B", "prereq"));
    const back = parseRelations(JSON.parse(JSON.stringify(serializeRelations(d))));
    expect(back.doc.relations).toEqual(d.relations);
    const tooNew = parseRelations({ v: 2, relations: [] });
    expect(tooNew.versionTooNew).toBe(true);
    const dirty = parseRelations({ v: 1, relations: [{ from: "A", to: "B", kind: "magic", source: "manual", confirmed: true }, rel("A", "C", "related") as unknown as Record<string, unknown>] });
    expect(dirty.doc.relations).toHaveLength(1);
    expect(parseRelations(undefined).doc).toEqual(EMPTY_RELATIONS);
  });
});
