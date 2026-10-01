// check-arch.mjs —— 架构一致性检查（TODO 26.3 P1）：设计承诺 ↔ 实际文件
// 规则集可随实现进度更新；失败=退出 1 并列出断言
import { existsSync, readFileSync } from "node:fs";

const checks = [];
const must = (name, ok) => checks.push({ name, ok });

// 1. docs/03 承载的模块树关键文件存在
for (const f of [
  "src/app.ts", "src/app-runtime.ts", "src/core/types.ts", "src/core/answer.ts",
  "src/core/attemptLog.ts", "src/core/replayer.ts", "src/core/session.ts",
  "src/core/memory.ts", "src/core/blockTemplate.ts", "src/core/planner.ts",
  "src/core/mock.ts", "src/kernel/client.ts", "src/importer/pipeline.ts",
  "src/ai/client.ts", "src/ai/gen.ts",
]) must(`存在 ${f}`, existsSync(f));

// 2. 构建入口与 plugin.json 声明一致（无 kernel.js：docs/03 决策 #9）
const manifest = JSON.parse(readFileSync("plugin.json", "utf8"));
must("plugin.json 无 kernels 字段（无内核插件）", !("kernels" in manifest));
must("无 src/kernel.ts 死分支", !existsSync("src/kernel.ts"));
must("vite.config 无 kernel target", !readFileSync("vite.config.ts", "utf8").includes("VITE_BUILD_TARGET === \"kernel\""));

// 3. i18n 路径与双语文件
for (const f of ["public/i18n/zh-CN.json", "public/i18n/en.json"]) must(`存在 ${f}`, existsSync(f));

// 4. UI 入口：三 Tab 组件真实存在（非占位判定=包含 lv- 组件类消费）
for (const f of ["src/ui/practice/PracticeTab.svelte", "src/ui/mock/MockTab.svelte", "src/ui/report/ReportTab.svelte"]) {
  must(`存在 ${f}`, existsSync(f));
}
must("MockTab 已实现（含答题卡）", readFileSync("src/ui/mock/MockTab.svelte", "utf8").includes("lv-sheet"));

// 5. 无硬编码十六进制色值进 src（token 文件与原型除外）
const hexRe = /#[0-9a-fA-F]{6}\b/;
const offenders = [];
for (const f of ["src/index.ts", "src/app.ts", "src/ui/practice/PracticeTab.svelte", "src/ui/mock/MockTab.svelte", "src/ui/report/ReportTab.svelte"]) {
  const src = readFileSync(f, "utf8");
  // 允许：白名单内语义色原型值（--green 等 fallback 已在 token 层）——组件层零容忍
  const lines = src.split("\n");
  lines.forEach((l, i) => {
    if (hexRe.test(l) && !l.includes("xlink") && !l.includes("http")) offenders.push(`${f}:${i + 1}`);
  });
}
must("组件层零硬编码色值", offenders.length === 0);
if (offenders.length) console.error("  违规行:\n" + offenders.map((o) => "  - " + o).join("\n"));

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log((c.ok ? "✓" : "✗") + " " + c.name);
if (failed.length) process.exit(1);
console.log(`✓ 架构一致性 ${checks.length} 项全部通过`);
