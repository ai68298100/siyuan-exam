// ============================================================
// 发版自动检查（docs/23 清单的可自动化面，七十六批固化）
// 用法：node scripts/release-check.mjs（任一失败退出码 1）
// 覆盖：版本一致性 / EN i18n 无 CJK 残留 / 占位符一致 / 依赖审计 /
//       CHANGELOG 用户摘要存在 / 生产构建产物与白名单
// 人工项（真机走查、smoke）不在本脚本范围——见 docs/23 第 1 节。
// ============================================================
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const results = [];
const check = (name, ok, note = "") => {
  results.push({ name, ok, note });
  console.log(`${ok ? "✓" : "✗"} ${name}${note ? "  — " + note : ""}`);
};

// 1. 版本一致性
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const pluginJson = JSON.parse(readFileSync("plugin.json", "utf8"));
check("版本一致性 package.json == plugin.json", pkg.version === pluginJson.version,
  pkg.version === pluginJson.version ? pkg.version : `${pkg.version} vs ${pluginJson.version}`);

// 2. EN i18n 质量：无 CJK 残留、占位符与 zh 一致
const zh = JSON.parse(readFileSync("public/i18n/zh-CN.json", "utf8"));
const en = JSON.parse(readFileSync("public/i18n/en.json", "utf8"));
const cjk = Object.entries(en).filter(([, v]) => typeof v === "string" && /[\u4e00-\u9fff]/.test(v.replace(/小驴/g, "")));
check("EN i18n 无 CJK 残留", cjk.length === 0, cjk.length ? cjk.map(([k]) => k).join("、") : `${Object.keys(en).length} 键全译`);
const ph = (s) => (String(s).match(/\{[a-z]+\}/gi) ?? []).sort().join(",");
const mismatch = Object.keys(zh).filter((k) => en[k] != null && ph(zh[k]) !== ph(en[k]));
check("i18n 占位符 zh/en 一致", mismatch.length === 0, mismatch.length ? mismatch.join("、") : "全部一致");

// 3. 依赖安全审计（生产依赖）
let auditOk;
let auditNote;
try {
  const out = execSync("pnpm audit --prod", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  auditNote = out.trim().split("\n").pop() ?? "";
  auditOk = true;
} catch (err) {
  auditOk = false;
  auditNote = String(err.stdout ?? err.message ?? "").split("\n").filter(Boolean).slice(-3).join(" | ");
}
check("依赖审计（pnpm audit --prod）", auditOk, auditNote);

// 4. CHANGELOG：用户可读摘要存在（0.7.0 发版说明草稿）
const changelog = readFileSync("CHANGELOG.md", "utf8");
const unreleased = changelog.slice(changelog.indexOf("## Unreleased"), changelog.indexOf("## 0.6.0"));
check("CHANGELOG 含用户可读摘要", unreleased.includes("用户可读摘要") && unreleased.includes("发版说明草稿"),
  `${(unreleased.match(/^- /gm) ?? []).length} 条详情 + 摘要段`);

// 5. 生产构建产物与白名单
check("生产构建产物存在", existsSync("dist/index.js") && existsSync("dist/plugin.json") && existsSync("dist/i18n/zh-CN.json"));
try {
  const out = execSync("node scripts/verify-package.mjs", { encoding: "utf8" });
  check("打包白名单校验", out.includes("✓"), out.trim().split("\n").pop() ?? "");
} catch {
  check("打包白名单校验", false, "verify-package 失败（先 pnpm build）");
}

// 6. 文档本地链接有效性（README/CHANGELOG/TODO/docs，七十九批加入；链接腐坏=发版门面 404）
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
const docFiles = ["README.md", "README.en-US.md", "CHANGELOG.md", "TODO.md",
  ...readdirSync("docs").filter((f) => f.endsWith(".md")).map((f) => join("docs", f))];
const linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g;
const docBroken = [];
let docTotal = 0;
for (const f of docFiles) {
  const text = readFileSync(f, "utf8");
  const base = dirname(f);
  for (const m of text.matchAll(linkRe)) {
    const target = m[1];
    if (/^https?:|^mailto:/.test(target)) continue;
    docTotal++;
    const p = decodeURIComponent(target.split("#")[0]);
    if (!p) continue;
    if (!existsSync(join(base, p))) docBroken.push(`${f} → ${target}`);
  }
}
check("文档本地链接有效", docBroken.length === 0, docBroken.length ? docBroken.slice(0, 5).join(" | ") : `${docTotal} 链接全有效`);

// ---------- 汇总 ----------
const failed = results.filter((r) => !r.ok);
console.log(`\n========== 发版自动检查 ==========`);
console.log(`通过 ${results.filter((r) => r.ok).length} · 失败 ${failed.length}`);
if (failed.length) {
  console.log("\n存在失败项——处理后再发版（人工项见 docs/23 第 1 节）");
  process.exit(1);
}
console.log("自动项全部通过；人工项（真机走查 / smoke）按 docs/23 第 1 节执行。");
