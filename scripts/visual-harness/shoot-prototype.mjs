// 原型基准截图：design/prototype 15 路由 → output/playwright/proto-<路由>.png
// 用法：node scripts/visual-harness/shoot-prototype.mjs
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../design/prototype");
const OUT = resolve(import.meta.dirname, "../../output/playwright");
mkdirSync(OUT, { recursive: true });
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const ROUTES = [
  "home",
  "project",
  "onboarding",
  "sources",
  "reader",
  "import",
  "bank",
  "practice",
  "review",
  "wrongbook",
  "mock-setup",
  "mock",
  "debrief",
  "report",
  "ai",
  "assets",
  "settings",
];

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const p = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    const body = readFileSync(join(ROOT, p));
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(4198, r));

const browser = await chromium.launch({ executablePath: EDGE });
for (const route of ROUTES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:4198/index.html#" + route);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, `proto-${route}.png`) });
  console.log(`✓ proto-${route}.png`);
  await ctx.close();
}
// 命令面板（⌘K 浮层）单独截图：home 上打开并输入过滤词
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:4198/index.html#home");
  await page.waitForTimeout(500);
  await page.evaluate(() => document.getElementById("palette-open").click());
  await page.fill("#palette-q", "模考");
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, "proto-palette.png") });
  console.log("✓ proto-palette.png");
  await ctx.close();
}
await browser.close();
server.close();
console.log("完成 →", OUT);
