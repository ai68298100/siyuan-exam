import { describe, it, expect } from "vitest";
import {
  kindFromFileName,
  formatBytes,
  canCopyIntoAssets,
  resolveMaterialUrl,
  assetsPathFor,
  registerMaterial,
  attachLocation,
  bumpRevision,
  removeMaterial,
  serializeRegistry,
  parseRegistry,
  EMPTY_REGISTRY,
  ASSETS_COPY_LIMIT_BYTES,
  type MaterialRegistry,
} from "../src/core/materials";

const NOW = 1_700_000_000_000;
const input = (path: string, kind = "assets") => ({
  title: "考研数学讲义",
  kind: "pdf" as const,
  subject: "数学",
  location: { kind: kind as "assets" | "link", path },
});

describe("120-01/02 资料对象", () => {
  it("kindFromFileName：扩展名映射，未知 → other 不猜", () => {
    expect(kindFromFileName("讲义.PDF")).toBe("pdf");
    expect(kindFromFileName("课.mp4")).toBe("video");
    expect(kindFromFileName("听力.m4a")).toBe("audio");
    expect(kindFromFileName("图.png")).toBe("image");
    expect(kindFromFileName("笔记.md")).toBe("doc");
    expect(kindFromFileName("未知.xyz")).toBe("other");
    expect(kindFromFileName("无扩展名")).toBe("other");
  });

  it("体积守卫：30MB 上限，超限拒绝并给可行动理由", () => {
    expect(canCopyIntoAssets(1024).ok).toBe(true);
    expect(canCopyIntoAssets(0).ok).toBe(false);
    const big = canCopyIntoAssets(ASSETS_COPY_LIMIT_BYTES + 1);
    expect(big.ok).toBe(false);
    expect(big.reason).toContain("链接登记");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });

  it("登记：新位置入册；同位置重复登记 → deduped 返回既有对象（同文件不产生第二条记录）", () => {
    const r1 = registerMaterial(EMPTY_REGISTRY, input("/assets/lv-exam/a.pdf"), NOW);
    expect(r1.deduped).toBe(false);
    expect(r1.material.id).toMatch(/^m-/);
    expect(r1.material.revision).toBe(1);
    expect(r1.material.locations).toEqual([{ kind: "assets", path: "/assets/lv-exam/a.pdf", addedAt: NOW }]);
    const r2 = registerMaterial(r1.registry, { ...input("/assets/lv-exam/a.pdf"), title: "换了个名字" }, NOW + 1);
    expect(r2.deduped).toBe(true);
    expect(r2.material.id).toBe(r1.material.id);
    expect(r2.material.title).toBe("考研数学讲义"); // 不被改名覆盖
    expect(r2.registry.materials).toHaveLength(1);
  });

  it("attachLocation：同一资料追加第二位置；同位置无操作；缺 id 返回 null", () => {
    const { registry, material } = registerMaterial(EMPTY_REGISTRY, input("/assets/a.pdf"), NOW);
    const r2 = attachLocation(registry, material.id, { kind: "link", path: "https://cdn.example.com/a.pdf" }, NOW + 1);
    expect(r2.deduped).toBe(false);
    expect(r2.material!.locations).toHaveLength(2);
    expect(r2.material!.updatedAt).toBe(NOW + 1);
    const r3 = attachLocation(r2.registry, material.id, { kind: "link", path: "https://cdn.example.com/a.pdf" }, NOW + 2);
    expect(r3.deduped).toBe(true);
    expect(r3.material!.locations).toHaveLength(2);
    expect(attachLocation(registry, "m-nope", { kind: "link", path: "x" }).material).toBeNull();
  });

  it("bumpRevision / removeMaterial", () => {
    const { registry, material } = registerMaterial(EMPTY_REGISTRY, input("/assets/a.pdf"), NOW);
    const bumped = bumpRevision(registry, material.id, NOW + 5);
    expect(bumped.materials[0].revision).toBe(2);
    expect(bumped.materials[0].updatedAt).toBe(NOW + 5);
    expect(removeMaterial(bumped, "m-nope").materials).toHaveLength(1);
    expect(removeMaterial(bumped, material.id).materials).toHaveLength(0);
  });

  it("序列化往返；更高版本拒绝为空 + 标记（不降级覆盖）", () => {
    const { registry } = registerMaterial(EMPTY_REGISTRY, input("/assets/a.pdf"), NOW);
    const back = parseRegistry(JSON.parse(JSON.stringify(serializeRegistry(registry))));
    expect(back.registry.materials).toEqual(registry.materials);
    expect(back.versionTooNew).toBe(false);
    const tooNew = parseRegistry({ v: 2, materials: [] });
    expect(tooNew.registry.materials).toHaveLength(0);
    expect(tooNew.versionTooNew).toBe(true);
    expect(parseRegistry(undefined).registry).toEqual(EMPTY_REGISTRY);
    // 非法条目剔除（locations 缺失）
    const dirty = parseRegistry({ v: 1, materials: [{ id: "m-x" }, { id: "m-y", locations: [], kind: "pdf", title: "t", revision: 1, createdAt: 0, updatedAt: 0 }] });
    expect(dirty.registry.materials.map((m) => m.id)).toEqual(["m-y"]);
  });
});

describe("120-06 最低查看", () => {
  it("resolveMaterialUrl：assets → 内核服务 URL；link 原样；非 http link 与空路径 → null", () => {
    expect(resolveMaterialUrl({ kind: "assets", path: "/assets/lv-exam/a.pdf", addedAt: 0 }, "http://127.0.0.1:6806"))
      .toBe("http://127.0.0.1:6806/assets/lv-exam/a.pdf");
    expect(resolveMaterialUrl({ kind: "link", path: "https://x.com/a.pdf", addedAt: 0 }, "http://o"))
      .toBe("https://x.com/a.pdf");
    expect(resolveMaterialUrl({ kind: "link", path: "javascript:alert(1)", addedAt: 0 }, "http://o")).toBeNull();
    expect(resolveMaterialUrl({ kind: "assets", path: "", addedAt: 0 }, "http://o")).toBeNull();
  });

  it("assetsPathFor：时间戳前缀防碰撞 + 文件名安全化", () => {
    const p = assetsPathFor("my 讲义/第1章?:*.pdf", 123);
    expect(p).toMatch(/^\/assets\/lv-exam\/123-my_讲义_第1章___\.pdf$/);
    expect(assetsPathFor("", 1)).toBe("/assets/lv-exam/1-material");
  });
});

describe("registry 类型形状", () => {
  it("EMPTY_REGISTRY v=1", () => {
    const r: MaterialRegistry = EMPTY_REGISTRY;
    expect(r.v).toBe(1);
    expect(r.materials).toEqual([]);
  });
});
