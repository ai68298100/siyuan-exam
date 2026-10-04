// check-arch.mjs —— 架构一致性检查（TODO 26.3 P1）：设计承诺 ↔ 实际文件
// 规则集可随实现进度更新；失败=退出 1 并列出断言
import { existsSync, readFileSync } from "node:fs";

const checks = [];
const must = (name, ok) => checks.push({ name, ok });

// 1. docs/03 承载的模块树关键文件存在
for (const f of [
  "src/app.ts",
  "src/app-runtime.ts",
  "src/core/types.ts",
  "src/core/answer.ts",
  "src/core/attemptLog.ts",
  "src/core/replayer.ts",
  "src/core/session.ts",
  "src/core/memory.ts",
  "src/core/blockTemplate.ts",
  "src/core/planner.ts",
  "src/core/mock.ts",
  "src/kernel/client.ts",
  "src/importer/pipeline.ts",
  "src/ai/client.ts",
  "src/ai/gen.ts",
  // v0.6-dev 新增契约模块（2026-10-03 与 docs/03 实际模块清单同步）
  "src/core/saveGate.ts",
  "src/core/migrations.ts",
  "src/core/logger.ts",
  "src/core/bankHealth.ts",
  "src/core/bankCsv.ts",
  "src/core/batchEdit.ts",
  "src/core/actions.ts",
  "src/ai/task.ts",
  "src/ui/shared/SaveStatus.svelte",
])
  must(`存在 ${f}`, existsSync(f));

// 2. 构建入口与 plugin.json 声明一致（无 kernel.js：docs/03 决策 #9）
const manifest = JSON.parse(readFileSync("plugin.json", "utf8"));
must("plugin.json 无 kernels 字段（无内核插件）", !("kernels" in manifest));
must("无 src/kernel.ts 死分支", !existsSync("src/kernel.ts"));
must(
  "vite.config 无 kernel target",
  !readFileSync("vite.config.ts", "utf8").includes('VITE_BUILD_TARGET === "kernel"'),
);

// 3. i18n 路径与双语文件
for (const f of ["public/i18n/zh-CN.json", "public/i18n/en.json"]) must(`存在 ${f}`, existsSync(f));

// 4. UI 入口：三 Tab 组件真实存在（非占位判定=包含 lv- 组件类消费）
for (const f of [
  "src/ui/practice/PracticeTab.svelte",
  "src/ui/mock/MockTab.svelte",
  "src/ui/report/ReportTab.svelte",
]) {
  must(`存在 ${f}`, existsSync(f));
}
must("MockTab 已实现（含答题卡）", readFileSync("src/ui/mock/MockTab.svelte", "utf8").includes("lv-sheet"));

// 5. 无硬编码十六进制色值进 src（token 文件与原型除外）
const hexRe = /#[0-9a-fA-F]{6}\b/;
const offenders = [];
for (const f of [
  "src/index.ts",
  "src/app.ts",
  "src/ui/practice/PracticeTab.svelte",
  "src/ui/mock/MockTab.svelte",
  "src/ui/report/ReportTab.svelte",
]) {
  const src = readFileSync(f, "utf8");
  // 允许：白名单内语义色原型值（--green 等 fallback 已在 token 层）——组件层零容忍
  const lines = src.split("\n");
  lines.forEach((l, i) => {
    if (hexRe.test(l) && !l.includes("xlink") && !l.includes("http")) offenders.push(`${f}:${i + 1}`);
  });
}
must("组件层零硬编码色值", offenders.length === 0);
if (offenders.length) console.error("  违规行:\n" + offenders.map((o) => "  - " + o).join("\n"));

for (const c of checks) console.log((c.ok ? "✓" : "✗") + " " + c.name);

// 6. core/ 纯函数层禁 import "siyuan"（可搬内核/可单测的保障，ADR 0002）
let coreViolation = false;
const { readdirSync } = await import("node:fs");
const walkCore = (dir) => {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = dir + "/" + f.name;
    if (f.isDirectory()) walkCore(p);
    else if (f.name.endsWith(".ts") && /from\s+["']siyuan["']/.test(readFileSync(p, "utf8"))) {
      console.error("  ✗ core 层引入 siyuan: " + p);
      coreViolation = true;
    }
  }
};
walkCore("src/core");
must("core 层不依赖 siyuan 包", !coreViolation);

// 6b. core/ 纯函数层禁 `as any` 强转（类型安全守卫）
let anyCast = false;
for (const f of readdirSync("src/core", { withFileTypes: true })) {
  const p = "src/core/" + f.name;
  if (f.isDirectory() || !f.name.endsWith(".ts")) continue;
  const src = readFileSync(p, "utf8");
  const count = (src.match(/as any/g) || []).length;
  if (count > 0) {
    console.error("  ✗ core 层 as any: " + p + " (" + count + " 处)");
    anyCast = true;
  }
}
must("core 层无 as any 强转", !anyCast);

// 7. 跨插件事件前缀（预留通道契约，ADR/10 §3.3）：凡 emit 自定义事件必须 lv-exam: 前缀
const srcFiles = ["src/index.ts", "src/app.ts"];
const badEvents = [];
for (const f of srcFiles) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/eventBus\.(?:emit|on)\(\s*["']([^"']+)["']/g)) {
    const ev = m[1];
    if (ev !== "click-blockicon" && !ev.startsWith("lv-exam:") && !/^ws-|^open-|^click-|^locked-/.test(ev)) {
      badEvents.push(`${f}: ${ev}`);
    }
  }
}
must("自定义事件带 lv-exam: 前缀", badEvents.length === 0);
if (badEvents.length) console.error("  违规:\n" + badEvents.map((b) => "  - " + b).join("\n"));

// 8. 114-02 严格模考跨入口 AI 禁用：模考场不得出现题目级 AI 发送入口
//（全部题目级 AI 帮助走 AiTaskRunner → helpAllowed 的 session 模式闸门；模考 UI 任何 AI 入口都算违规）
const mockSrc = readFileSync("src/ui/mock/MockTab.svelte", "utf8");
const aiEntryPatterns = [
  /AiTaskRunner/, /aiChat\(/, /explainCurrent/, /requestHint/, /runMisdiagnosis/,
  /buildExplainMessages/, /buildHintMessages/, /buildMisdiagnosisMessages/, /\.chat\(/,
];
const aiHits = aiEntryPatterns.filter((re) => re.test(mockSrc));
must("114-02 模考场无题目级 AI 发送入口", aiHits.length === 0);
if (aiHits.length) console.error("  违规模式:\n" + aiHits.map((re) => "  - " + re).join("\n"));

// 9. 114-02 闸门共用：UI 层不得绕过 AiTaskRunner 直连通道发题目级 AI（.chat 只允许出现在 ai/ 服务层）
const uiFiles = ["src/ui/practice/PracticeTab.svelte", "src/ui/report/ReportTab.svelte", "src/ui/mock/MockTab.svelte"];
for (const f of uiFiles) {
  const direct = /\.chat\(/.test(readFileSync(f, "utf8"));
  must(`114-02 ${f.split("/").pop()} 无直连 .chat（AI 经闸门）`, !direct);
}

const failedAll = checks.filter((c) => !c.ok);
for (const c of checks.slice(-2)) console.log((c.ok ? "✓" : "✗") + " " + c.name);
if (failedAll.length) process.exit(1);
console.log(`✓ 架构一致性 ${checks.length} 项全部通过`);
