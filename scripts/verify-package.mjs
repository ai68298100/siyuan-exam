// verify-package.mjs —— 产物白名单校验（TODO 26.3）
// package.zip 必须只含运行必需文件：无源码、无密钥、无测试资料
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const ALLOW = [
  /^index\.js$/,
  /^index\.css$/,
  /^plugin\.json$/,
  /^icon\.png$/,
  /^preview\.png$/,
  /^i18n\/[a-zA-Z-]+\.json$/,
  /^README(\.en-US)?\.md$/,
  // 打包器拆出的 vendored 依赖 chunk（如 xlsx-C6P8P8QC.cjs / gen-BS969Kwy.cjs）
  /^[a-zA-Z0-9_.-]+-[A-Za-z0-9_-]{8}\.(cjs|js)$/,
];

if (!existsSync("package.zip")) {
  console.error("✗ package.zip 不存在（先 pnpm build）");
  process.exit(1);
}
let out;
try {
  out = execSync("unzip -Z1 package.zip", { encoding: "utf8" });
} catch {
  // Git Bash 无 unzip 时退回 powershell
  out = execSync('powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::OpenRead(\\"package.zip\\").Entries.FullName -join \\"`n\\""', { encoding: "utf8" });
}
const names = out.split(/\r?\n/).map((s) => s.replace(/^\.\//, "").trim()).filter((n) => n && !n.endsWith("/"));
const bad = names.filter((n) => !ALLOW.some((re) => re.test(n)));
const mustHave = ["index.js", "plugin.json", "i18n/zh-CN.json", "i18n/en.json", "icon.png"];
const missing = mustHave.filter((m) => !names.includes(m));

if (bad.length) {
  console.error("✗ 白名单外文件:\n" + bad.map((b) => "  - " + b).join("\n"));
  process.exit(1);
}
if (missing.length) {
  console.error("✗ 缺少必需文件:\n" + missing.map((b) => "  - " + b).join("\n"));
  process.exit(1);
}
console.log(`✓ package.zip 白名单校验通过（${names.length} 个文件）`);
