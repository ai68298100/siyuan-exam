// ESLint flat config（TODO 0 组：官方模板未含 lint）
// 定位：guard 已有类型/svelte-check/架构锁——eslint 只补「代码卫生」层，
// 不重复类型检查（ts-eslint 只做语法级规则），不做风格格式化（归 Prettier）。
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "output/", "coverage/", "*.d.ts", "design/prototype/prototype.js", "scripts/visual-harness/"] },
  js.configs.recommended,
  ...tseslint.config({
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommended],
    rules: {
      // 与既有代码风格对齐：下划线前缀=有意不使用
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off", // 类型安全由 guard 的 core 层规则与 tsc 把守
      "no-console": ["error", { allow: ["warn", "error", "info", "debug"] }], // 统一走 logger/既有控制台口径
    },
  }),
  // 构建与发布工具脚本：node 环境，卫生规则放宽到 recommended 级
  {
    files: ["scripts/**/*.{js,mjs,ts}", "yaml-plugin.js", "vite.config.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // 工具脚本直接 console 输出运行/校验结果，属设计行为
      "no-console": "off",
    },
  },
  ...svelte.configs["flat/recommended"],
  {
    files: ["**/*.svelte"],
    plugins: { "@typescript-eslint": tseslint.plugin },
    languageOptions: {
      parserOptions: { parser: tseslint.parser, extraFileExtensions: [".svelte"] },
      globals: { ...globals.browser },
    },
    rules: {
      // 组件内事件处理常用内联 async，避免误报
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // 基础 no-unused-vars 关闭：.svelte 是 TS，由上一行接管（否则双跑误报 interface 成员）
      "no-unused-vars": "off",
      // {@html} 是插件核心渲染路径（题面/材料 = 内核 lute md2html 可信源）；
      // 动态文本进 innerHTML 已由 sanitize.ts escapeHtml 政策约束（见 17 组审计）
      "svelte/no-at-html-tags": "off",
      // .svelte 内 TS 类型/导入由 tsc 守卫，no-undef 误报 TS 类型引用（ISettingItem 等）
      "no-undef": "off",
    },
  },
  {
    files: ["**/*.svelte.ts", "tests/**/*.ts", "scripts/**/*.mjs"],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
