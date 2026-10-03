// check-i18n.mjs —— zh-CN/en 键集合一致性校验（缺键=退出 1）
// v2：新增“使用覆盖率”检查——扫描 src 中 i18n["key"] / t("key") 的字面量键，
//     必须存在于 zh-CN.json（动态拼接键以前缀方式登记在 DYNAMIC_PREFIXES）
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const zh = JSON.parse(readFileSync("public/i18n/zh-CN.json", "utf8"));
const en = JSON.parse(readFileSync("public/i18n/en.json", "utf8"));
const zk = new Set(Object.keys(zh));
const ek = new Set(Object.keys(en));

const missingInEn = [...zk].filter((k) => !ek.has(k));
const missingInZh = [...ek].filter((k) => !zk.has(k));
let fail = false;
if (missingInEn.length) {
  console.error("✗ 缺 en 键:\n" + missingInEn.map((k) => "  - " + k).join("\n"));
  fail = true;
}
if (missingInZh.length) {
  console.error("✗ 缺 zh-CN 键:\n" + missingInZh.map((k) => "  - " + k).join("\n"));
  fail = true;
}
// 空值检查
const empty = [...zk].filter((k) => !String(zh[k]).trim());
if (empty.length) {
  console.error("✗ zh 空值键:\n" + empty.map((k) => "  - " + k).join("\n"));
  fail = true;
}

// —— 使用覆盖率：src 内字面量键必须在 zh-CN.json 中存在 ——
function walk(dir, out = []) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (/\.svelte$|\.ts$/.test(f.name) && !f.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}
const used = new Set();
for (const file of walk("src")) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(
    /i18n\?\.\[?"?([a-zA-Z][\w.]*)"?\]|i18n\["([a-zA-Z][\w.]*)"\]|\bt\("([a-zA-Z][\w.]*)"\)/g,
  )) {
    used.add(m[1] ?? m[2] ?? m[3]);
  }
}
// 动态前缀（代码中 t("xxx." + ...) 的形式，人工登记前缀）
const DYNAMIC_PREFIXES = [
  "qtype.",
  "reason.",
  "rate.",
  "ai.diff.",
  "ai.quality.",
  "setting.",
  "confidence.",
  "health.field.",
  "action.kind.",
];
const missingUsed = [...used].filter((k) => !zk.has(k) && !DYNAMIC_PREFIXES.some((p) => k.startsWith(p)));
if (missingUsed.length) {
  console.error("✗ 代码使用了但 i18n 未定义:\n" + missingUsed.map((k) => "  - " + k).join("\n"));
  fail = true;
}

if (fail) process.exit(1);
console.log(`✓ i18n 键一致（${zk.size} 键）· 使用覆盖率 ${used.size} 个字面量键全部存在`);
