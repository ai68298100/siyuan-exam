// 可视化测试台截图脚本：本地静态服务 output/harness + 本机 Edge 截图
// 产物：output/playwright/real-<屏>-<变体>.png（改前基准 / 改后对比共用）
// 用法：node scripts/visual-harness/shoot.mjs [前缀=real]
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../output/harness");
const OUT = resolve(import.meta.dirname, "../../output/playwright");
const PREFIX = process.argv[2] ?? "real";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
if (!existsSync(EDGE)) {
  console.error(`✗ 未找到 Edge：${EDGE}`);
  process.exit(1);
}
if (!existsSync(join(ROOT, "index.html"))) {
  console.error("✗ 缺少 output/harness/index.html——先跑：npx vite build --config scripts/visual-harness/vite.config.ts");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer((req, res) => {
  const path = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    const body = readFileSync(join(ROOT, path));
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(4199, r));

const browser = await chromium.launch({ executablePath: EDGE });
const shots = [
  ["practice-entry", "practice", false, { width: 1440, height: 900 }],
  ["practice-dark", "practice", true, { width: 1440, height: 900 }],
  ["practice-narrow", "practice", false, { width: 390, height: 844 }],
  ["report", "report", false, { width: 1440, height: 900 }],
  ["mock", "mock", false, { width: 1440, height: 900 }],
];

for (const [name, tab, dark, viewport] of shots) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:4199/");
  await page.waitForTimeout(300);
  await page.evaluate(([t, d]) => {
    window.__theme(d);
    window.__show(t);
  }, [tab, dark]);
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, `${PREFIX}-${name}.png`) });
  console.log(`✓ ${PREFIX}-${name}.png`);
  await ctx.close();
}

// 会话作答屏：练习台内点「开始今日」类主按钮（进入会话后再拍）
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:4199/");
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.__theme(false);
    window.__show("practice");
  });
  await page.waitForTimeout(700);
  // 点击入口视图里第一个主按钮（开始练习/今日任务）
  const primary = page.locator("#app button.lv-btn--primary").first();
  if (await primary.count()) {
    await primary.click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(OUT, `${PREFIX}-practice-session.png`) });
    console.log(`✓ ${PREFIX}-practice-session.png`);
  } else {
    console.log("… 未找到主按钮，跳过会话屏");
  }
  await ctx.close();
}

await browser.close();
server.close();
console.log("完成 →", OUT);
