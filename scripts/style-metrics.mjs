// 样式收敛前后可复核的轻量指标。只统计源码，不读取构建产物。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(scss|svelte)$/.test(entry.name)) files.push(file);
  }
};
walk("src");
const text = files.map((file) => readFileSync(file, "utf8")).join("\n");
const count = (re) => (text.match(re) ?? []).length;
const uniqueTokens = new Set(text.match(/--lv-[a-zA-Z0-9-]+/g) ?? []);
const result = {
  files: files.length,
  rawPx: count(/(?<![\w-])\d+(?:\.\d+)?px/g),
  rawMs: count(/\d+(?:\.\d+)?ms/g),
  colorLiterals: count(/#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(/g),
  inlineStyleAttrs: count(/\bstyle=/g),
  lvTokens: uniqueTokens.size,
};
console.log(JSON.stringify(result, null, 2));
