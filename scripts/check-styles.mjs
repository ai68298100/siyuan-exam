// ============================================================
// 样式 token 审计（TODO 45-10 lite）：扫描源内样式的裸色值
// 白名单：src/scss/lv-tokens.scss（token 定义处允许 fallback 裸值，须注明理由）
//         任意文件中 var(--b3-…, <fallback>) 的思源 token 回退位
// 其余位置出现 #hex / rgb() / hsl() / 色名 即失败——产品色必须走 --lv-* token。
// 用法：node scripts/check-styles.mjs；退出码 0 = 通过
// ============================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const ALLOWED_FILES = ["lv-tokens.scss"]; // token 定义文件：裸值 = 有意的主题 fallback
const COLOR_RE = /(#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()/g;
// 色名黑名单只查常见易错词（CSS 色名上百，重点防手写 white/red/blue 等）
const NAMED_COLOR_RE = /:\s*(white|black|red|green|blue|gray|grey|orange|yellow|pink|purple)\s*[;}]/g;

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(p);
    } else if (/\.(svelte|scss|css)$/.test(name)) files.push(p);
  }
};
walk(SRC);

const violations = [];
for (const file of files) {
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
  const base = rel.split("/").pop();
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const noComment = line.replace(/\/\/.*$/, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const ln = i + 1;
    for (const m of noComment.matchAll(COLOR_RE)) {
      const inFallback = /var\(--[^)]*$/.test(noComment.slice(0, m.index)); // 位于 var() 回退位
      if (!ALLOWED_FILES.includes(base) && !inFallback) {
        violations.push(`${rel}:${ln}  裸色值 ${m[0]}（应使用 --lv-* token 或作为思源 token 回退）`);
      }
    }
    if (!ALLOWED_FILES.includes(base)) {
      for (const m of noComment.matchAll(NAMED_COLOR_RE)) {
        violations.push(`${rel}:${ln}  裸色名 ${m[0].trim()}（应使用 --lv-* token）`);
      }
    }
  });
}

for (const v of violations) console.error("✗ " + v);
console.log(`\n========== 样式 token 审计（45-10 lite）==========`);
console.log(`扫描 ${files.length} 个样式文件：${violations.length ? violations.length + " 处违规" : "通过（裸色值仅存在于 token 定义与思源回退位）"}`);
process.exit(violations.length ? 1 : 0);
