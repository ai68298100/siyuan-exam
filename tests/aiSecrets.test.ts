import { describe, expect, it } from "vitest";
import { AI_SECRET_NAME, resolveAiKey } from "../src/ai/secrets";

describe("resolveAiKey（73-03 读取侧密钥适配）", () => {
  it("宿主密钥优先且去除首尾空白", () => {
    const host = { getSecret: (name: string) => name === AI_SECRET_NAME ? "  secret-key  " : "", settingUtils: { get: () => "legacy" } };
    expect(resolveAiKey(host)).toBe("secret-key");
  });

  it("宿主密钥为空时回退旧设置", () => {
    expect(resolveAiKey({ getSecret: () => "  ", settingUtils: { get: () => " legacy-key " } })).toBe("legacy-key");
  });

  it("宿主读取异常时回退旧设置", () => {
    expect(resolveAiKey({ getSecret: () => { throw new Error("unsupported"); }, settingUtils: { get: () => "legacy-key" } })).toBe("legacy-key");
  });

  it("没有配置或读取旧设置异常时返回空字符串", () => {
    expect(resolveAiKey(undefined)).toBe("");
    expect(resolveAiKey({ settingUtils: { get: () => { throw new Error("broken"); } } })).toBe("");
  });
});
