// 可视化测试台专用 vite 配置：把三个真实 Tab（含真实 ExamApp + 种子数据）
// 构建成独立可截图页面 → output/harness/（不进发行包；eslint/tsconfig 已排除）
// 用法：npx vite build --config scripts/visual-harness/vite.config.ts
import { resolve } from "path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
    root: import.meta.dirname,
    resolve: {
        alias: {
            "@": resolve(import.meta.dirname, "../../src"),
            // 宿主 API 桩：Tab 组件渲染路径所需的 siyuan 面在测试台内 emulation
            siyuan: resolve(import.meta.dirname, "siyuan-stub.ts"),
        },
    },
    base: "./",
    build: {
        outDir: resolve(import.meta.dirname, "../../output/harness"),
        emptyOutDir: true,
        rollupOptions: {
            input: resolve(import.meta.dirname, "index.html"),
        },
    },
    plugins: [svelte()],
});
