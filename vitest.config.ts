import { resolve } from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";
import appConfig from "./vite.config.ts";

export default mergeConfig(appConfig, defineConfig({
  test: {
    // 思源包只发布宿主类型；单元测试的 vi.mock 需要一个可解析的本地入口。
    alias: { siyuan: resolve(import.meta.dirname, "tests/stubs/siyuan.ts") },
  },
}));
