import { describe, it, expect } from "vitest";
import { diffBank, type PkgEntry } from "../src/core/bankPackage";

const e = (id: string, hash: string): PkgEntry => ({ id, hash, type: "single", stem: "题干 " + id });

describe("题库包 diff（exam-id 版本化）", () => {
  it("新增/更新/移除/未变 四分类", () => {
    const local = [e("a", "h1"), e("b", "h2-old"), e("c", "h3")];
    const incoming = [e("a", "h1"), e("b", "h2-new"), e("d", "h4")];
    const r = diffBank(local, incoming);
    expect(r.added.map((x) => x.id)).toEqual(["d"]);
    expect(r.updated.map((x) => x.id)).toEqual(["b"]);
    expect(r.removed.map((x) => x.id)).toEqual(["c"]);
    expect(r.unchanged).toBe(1);
  });
  it("空本地 → 全部新增", () => {
    const r = diffBank([], [e("a", "h1")]);
    expect(r.added).toHaveLength(1);
    expect(r.removed).toHaveLength(0);
  });
});
