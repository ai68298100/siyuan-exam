import { describe, it, expect, vi, afterEach } from "vitest";
import { formatClipsForSource, listLaterClips, markClipDone, probeGlean, type GleanBridgeV1 } from "../src/core/gleanBridge";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("拾遗桥探测与素材格式化（60-01 lite，四五批）", () => {
  it("probeGlean：apiVersion===1 且有 listClips 才可用；缺失/版本不符/无方法 → null", () => {
    vi.stubGlobal("window", { siyuanGlean: { apiVersion: 1, listClips: () => [] } });
    expect(probeGlean(window)?.apiVersion).toBe(1);
    vi.stubGlobal("window", { siyuanGlean: { apiVersion: 2, listClips: () => [] } });
    expect(probeGlean(window)).toBeNull();
    vi.stubGlobal("window", { siyuanGlean: { apiVersion: 1 } });
    expect(probeGlean(window)).toBeNull();
    vi.stubGlobal("window", {});
    expect(probeGlean(window)).toBeNull();
  });

  it("listLaterClips：status=later 有界拉取；异常 → 空数组降级", async () => {
    const calls: unknown[] = [];
    const g: GleanBridgeV1 = {
      apiVersion: 1,
      listClips: async (filter) => {
        calls.push(filter);
        return [
          { id: "c1", title: "文章一", url: "https://a.example", site: "例站", summary: "摘要一" },
          { id: "c2", title: "文章二" },
        ].slice(0, filter?.limit ?? 10) as never[];
      },
    };
    const clips = await listLaterClips(g, 10);
    expect(calls[0]).toMatchObject({ status: "later", limit: 10 });
    expect(clips).toHaveLength(2);
    const boom: GleanBridgeV1 = { apiVersion: 1, listClips: async () => { throw new Error("x"); } };
    expect(await listLaterClips(boom)).toHaveLength(0);
  });

  it("formatClipsForSource：标题/站点/URL/摘要成行，带来源标注与核对提示", () => {
    const text = formatClipsForSource([
      { id: "c1", title: "文章一", url: "https://a.example", site: "例站", summary: "摘要一" },
      { id: "c2", title: "文章二" },
    ]);
    expect(text).toContain("【拾遗稍后读素材】");
    expect(text).toContain("1. 《文章一》（例站 · https://a.example）");
    expect(text).toContain("摘要：摘要一");
    expect(text).toContain("2. 《文章二》");
    expect(text).toContain("核对原文");
    expect(formatClipsForSource([])).toBe("");
  });

  it("60-01 写方向：markClipDone 成功 true；写开关未开（拒绝）/无方法 → false 不伪造成功", async () => {
    const written: [string, string][] = [];
    const okG: GleanBridgeV1 = {
      apiVersion: 1,
      setClipStatus: async (id, status) => { written.push([id, status]); },
    };
    expect(await markClipDone(okG, "c1")).toBe(true);
    expect(written).toEqual([["c1", "done"]]);
    const rejectG: GleanBridgeV1 = {
      apiVersion: 1,
      setClipStatus: async () => { throw new Error("bridge write disabled"); },
    };
    expect(await markClipDone(rejectG, "c1")).toBe(false);
    expect(await markClipDone({ apiVersion: 1 }, "c1")).toBe(false);
  });
});
