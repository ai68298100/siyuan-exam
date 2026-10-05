// 实际 UI 全视图截图：浏览/导入/录题/AI/资料/背诵/作答反馈/设置页
// 通过 DOM 点击驱动真实组件（与用户操作同路径）
// 用法：node scripts/visual-harness/shoot-views.mjs [前缀=real]
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../output/harness");
const OUT = resolve(import.meta.dirname, "../../output/playwright");
const PREFIX = process.argv[2] ?? "real";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
if (!existsSync(join(ROOT, "index.html"))) {
  console.error("✗ 先构建 harness：npx vite build --config scripts/visual-harness/vite.config.ts");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
const server = createServer((req, res) => {
  const p = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    const body = readFileSync(join(ROOT, p));
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4199, r));
const browser = await chromium.launch({ executablePath: EDGE });

const shot = async (name, steps) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:4199/");
  await page.evaluate(() => { window.__theme(false); window.__show("practice"); });
  await page.waitForTimeout(700);
  for (const step of steps) {
    try {
      if (step.click) await page.locator(step.click).first().click({ timeout: 3000 });
      if (step.eval) await page.evaluate(step.eval);
      await page.waitForTimeout(step.wait ?? 700);
    } catch (e) {
      console.log(`  ⚠ ${name} 步骤失败：${step.click ?? step.eval} — ${String(e).slice(0, 80)}`);
    }
  }
  await page.screenshot({ path: join(OUT, `${PREFIX}-${name}.png`) });
  console.log(`✓ ${PREFIX}-${name}.png`);
  await ctx.close();
};

const btn = (text) => `#app button:has-text("${text}")`;
await shot("browse", [{ click: btn("浏览") }]);
await shot("import", [{ click: btn("导入题库") }]);
await shot("manual", [{ click: btn("手工录题") }]);
await shot("ai", [{ click: btn("AI 出题") }]);
await shot("materials", [{ click: btn("学习资料") }]);
await shot("recite", [{ click: "#app .lv-mode:has-text('背诵')" }]);
await shot("session-feedback", [
  { click: btn("开始（零决策）"), wait: 900 },
  { click: "#app button.lv-opt" },
  { click: btn("提交"), wait: 900 },
]);
await shot("settings", [{ eval: "window.__settings()" }]);

await browser.close();
server.close();
console.log("完成 →", OUT);
