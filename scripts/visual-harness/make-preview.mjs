// 合成市场预览图 preview.png（1024×768 @2x）：真实截图（隐藏 harness 工具条）× 产品设计语言
// 用法：node scripts/visual-harness/make-preview.mjs
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const HARNESS = resolve("output/harness");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
const server = createServer((req, res) => {
  const p = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
    res.end(readFileSync(join(HARNESS, p)));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(4209, r));

const browser = await chromium.launch({ executablePath: EDGE });
// 源图：首帧前注入样式隐藏 harness 工具条（避免渲染中布局抖动）；等应用就绪再拍
const newPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = "#bar{display:none!important}#stage{height:100vh!important}";
      document.head.appendChild(s);
    });
  });
  return ctx.newPage();
};
// 源图：隐藏 harness 工具条（#bar）与主题钮，只留产品 UI；1280×800 供裁切
const shoot = async (name, { dark = false, path = "" } = {}) => {
  const page = await newPage();
  await page.goto("http://127.0.0.1:4209/");
  await page.waitForFunction(() => typeof window.__theme === "function", { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.evaluate(({ d, p }) => {
    window.__theme(d);
    if (p) window.__show(p);
  }, { d: dark, p: path });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve("output/playwright", name) });
  console.log("shot:", name);
  await page.context().close();
};

await shoot("pv-entry.png");
await shoot("pv-report-dark.png", { dark: true, path: "report" });
await shoot("pv-mock.png", { path: "mock" });
// 暗色报告滚到图表区
{
  const page = await newPage();
  await page.goto("http://127.0.0.1:4209/");
  await page.waitForFunction(() => typeof window.__theme === "function", { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.__theme(true);
    window.__show("report");
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => [...document.querySelectorAll(".lv-main, .lv-pad")].forEach((m) => (m.scrollTop = 620)));
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve("output/playwright", "pv-charts-dark.png") });
  console.log("shot: pv-charts-dark.png");
  await page.context().close();
}

const img = (name) => `data:image/png;base64,${readFileSync(resolve("output/playwright", name)).toString("base64")}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1024px; height: 768px; overflow: hidden; position: relative;
    background: linear-gradient(135deg, #f2f1ec 0%, #eeede6 60%, #e9e8e0 100%);
    font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #262a33; }
  .glow { position: absolute; right: -120px; top: -120px; width: 420px; height: 420px; border-radius: 50%;
    background: radial-gradient(closest-side, rgba(97,83,213,.08), transparent); }
  .brand { position: absolute; left: 40px; top: 34px; display: flex; align-items: center; gap: 13px; }
  .mark { width: 44px; height: 48px; border-radius: 12px; display: grid; place-items: center;
    background: linear-gradient(160deg, #6153d5, #4a3fb8); color: #fff; font-size: 26px;
    box-shadow: 0 2px 6px rgba(97,83,213,.28), inset 0 1px 0 rgba(255,255,255,.25); }
  .name { font-size: 21px; font-weight: 700; letter-spacing: -.2px; }
  .sub { font-size: 10px; letter-spacing: 2.6px; color: #8b91a0; font-weight: 600; margin-top: 2px; }
  .tagline { position: absolute; left: 40px; top: 108px; font-size: 14px; color: #676e7d; }
  .shot { position: absolute; border-radius: 12px; overflow: hidden; border: 1px solid #e2e3da;
    box-shadow: 0 2px 4px rgba(38,42,51,.06), 0 24px 48px -16px rgba(38,42,51,.22); background: #fff; }
  .shot img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top left; }
  .main { left: 40px; top: 152px; width: 596px; height: 574px; }
  .side1 { left: 664px; top: 152px; width: 320px; height: 276px; }
  .side2 { left: 664px; top: 450px; width: 320px; height: 276px; }
  .cap { position: absolute; left: 12px; bottom: 10px; padding: 3px 10px; border-radius: 7px;
    background: rgba(38,42,51,.78); color: #fff; font-size: 11px; letter-spacing: .4px; }
</style></head><body>
  <div class="glow"></div>
  <div class="brand"><div class="mark">驴</div><div><div class="name">小驴考试</div><div class="sub">LV EXAM</div></div></div>
  <div class="tagline">思源笔记里的备考工作台 —— 题库、练习、模考、证据报告，一条流水线</div>
  <div class="shot main"><img src="${img("pv-entry.png")}" alt=""></div>
  <div class="shot side1"><img src="${img("pv-charts-dark.png")}" alt=""><span class="cap">证据报告 · 暗色</span></div>
  <div class="shot side2"><img src="${img("pv-mock.png")}" alt=""><span class="cap">模考场 · 蓝图配卷</span></div>
</body></html>`;

const page = await (await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2 })).newPage();
await page.setContent(html, { waitUntil: "networkidle" });
await page.waitForTimeout(300);
await page.screenshot({ path: resolve("preview.png") });
await browser.close();
server.close();
console.log("preview.png 已重新合成（无 harness 痕迹）");
