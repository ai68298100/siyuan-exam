// check-i18n.mjs —— zh-CN/en 键集合一致性校验（缺键=退出 1）
import { readFileSync } from "node:fs";

const zh = JSON.parse(readFileSync("public/i18n/zh-CN.json", "utf8"));
const en = JSON.parse(readFileSync("public/i18n/en.json", "utf8"));
const zk = new Set(Object.keys(zh));
const ek = new Set(Object.keys(en));

const missingInEn = [...zk].filter((k) => !ek.has(k));
const missingInZh = [...ek].filter((k) => !zk.has(k));
let fail = false;
if (missingInEn.length) { console.error("✗ 缺 en 键:\n" + missingInEn.map((k) => "  - " + k).join("\n")); fail = true; }
if (missingInZh.length) { console.error("✗ 缺 zh-CN 键:\n" + missingInZh.map((k) => "  - " + k).join("\n")); fail = true; }
// 空值检查
const empty = [...zk].filter((k) => !String(zh[k]).trim());
if (empty.length) { console.error("✗ zh 空值键:\n" + empty.map((k) => "  - " + k).join("\n")); fail = true; }

if (fail) process.exit(1);
console.log(`✓ i18n 键一致（${zk.size} 键）`);
