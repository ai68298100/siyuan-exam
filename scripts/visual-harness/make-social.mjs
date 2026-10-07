// 品牌/场景截图产出（docs/25 P2）：
//   design/social/github-social-preview.png  — GitHub Social Preview 1280×640
//   design/screenshots/*.png                 — README 界面一览 5 张（无 harness 痕迹）
// 用法：node scripts/visual-harness/make-social.mjs
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const HARNESS = resolve("output/harness");
const OUT_SHOTS = resolve("design/screenshots");
const OUT_SOCIAL = resolve("design/social");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
mkdirSync(OUT_SHOTS, { recursive: true });
mkdirSync(OUT_SOCIAL, { recursive: true });

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
await new Promise((r) => server.listen(4210, r));
const browser = await chromium.launch({ executablePath: EDGE });

const newPage = (width = 1280, height = 800) =>
  (async () => {
    const ctx = await browser.newContext({
      viewport: width === 390 ? { width: 390, height: 844 } : { width, height },
      deviceScaleFactor: 2,
    });
    await ctx.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const s = document.createElement("style");
        s.textContent = "#bar{display:none!important}#stage{height:100vh!important}";
        document.head.appendChild(s);
      });
    });
    const page = await ctx.newPage();
    return { ctx, page };
  })();

const ready = async (page) => {
  await page.goto("http://127.0.0.1:4210/");
  await page.waitForFunction(() => typeof window.__theme === "function", { timeout: 15000 });
  await page.waitForTimeout(600);
};

const save = (page, file) => page.screenshot({ path: resolve(OUT_SHOTS, file) });

// —— 1 练习台首页（桌面亮色） ——
{
  const { ctx, page } = await newPage();
  await ready(page);
  await page.waitForTimeout(1200);
  await save(page, "practice-entry.png");
  console.log("shot: practice-entry.png");
  await ctx.close();
}

// —— 2 作答状态（快速刷题 + 选中一项） ——
{
  const { ctx, page } = await newPage();
  await ready(page);
  await page.click("#app .lv-mode:has-text('快速刷题')");
  await page.waitForTimeout(1100);
  await page.click("#app button.lv-opt >> nth=1").catch(() => {});
  await page.waitForTimeout(500);
  await save(page, "practice-session.png");
  console.log("shot: practice-session.png");
  await ctx.close();
}

// —— 3 窄屏作答（390） ——
{
  const { ctx, page } = await newPage(390);
  await ready(page);
  await page.click("#app .lv-mode:has-text('快速刷题')");
  await page.waitForTimeout(1100);
  await page.click("#app button.lv-opt >> nth=0").catch(() => {});
  await page.waitForTimeout(500);
  await save(page, "session-narrow.png");
  console.log("shot: session-narrow.png");
  await ctx.close();
}

// —— 4 导入与校对（粘贴 + 解析预览） ——
{
  const { ctx, page } = await newPage();
  await ready(page);
  await page.click("#app button:has-text('导入题库')");
  await page.waitForTimeout(800);
  await page.fill(
    "#app textarea.lv-textarea",
    "思源笔记的内核是什么？\nA. Electron + Node.js\nB. Go\nC. Rust\nANSWER: A",
  ).catch(() => {});
  await page.waitForTimeout(400);
  await page.click("#app button:has-text('解析预览')");
  await page.waitForTimeout(1200);
  await save(page, "import-preview.png");
  console.log("shot: import-preview.png");
  await ctx.close();
}

// —— 5 学习证据报告（亮色顶部） ——
{
  const { ctx, page } = await newPage();
  await ready(page);
  await page.evaluate(() => window.__show("report"));
  await page.waitForTimeout(1200);
  await save(page, "report-center.png");
  console.log("shot: report-center.png");
  await ctx.close();
}

// —— GitHub Social Preview 1280×640 ——
const img = (file) => `data:image/png;base64,${readFileSync(resolve(OUT_SHOTS, file)).toString("base64")}`;
const social = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1280px; height: 640px; overflow: hidden; position: relative;
    background: linear-gradient(120deg, #f2f1ec 0%, #eeede6 55%, #e7e6de 100%);
    font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #262a33; }
  .glow { position: absolute; left: -140px; bottom: -180px; width: 460px; height: 460px; border-radius: 50%;
    background: radial-gradient(closest-side, rgba(97,83,213,.09), transparent); }
  .mark { position: absolute; left: 56px; top: 64px; width: 52px; height: 56px; border-radius: 13px;
    display: grid; place-items: center; background: linear-gradient(160deg, #6153d5, #4a3fb8); color: #fff;
    font-size: 30px; box-shadow: 0 2px 6px rgba(97,83,213,.28), inset 0 1px 0 rgba(255,255,255,.25); }
  .name { position: absolute; left: 128px; top: 66px; font-size: 30px; font-weight: 700; letter-spacing: -.3px; }
  .sub { position: absolute; left: 130px; top: 110px; font-size: 11px; letter-spacing: 3px; color: #8b91a0; font-weight: 600; }
  h1 { position: absolute; left: 56px; top: 176px; font-size: 34px; font-weight: 700; letter-spacing: -.5px; line-height: 1.4; max-width: 420px; }
  .tagline { position: absolute; left: 56px; top: 300px; font-size: 15px; color: #676e7d; max-width: 400px; line-height: 1.8; }
  .chips { position: absolute; left: 56px; top: 420px; display: flex; gap: 10px; flex-wrap: wrap; max-width: 420px; }
  .chip { padding: 5px 13px; border-radius: 7px; background: #edeafa; color: #6153d5; font-size: 12.5px; font-weight: 600; }
  .foot { position: absolute; left: 56px; bottom: 40px; font-size: 12px; color: #8b91a0; }
  .shot { position: absolute; border-radius: 14px; overflow: hidden; border: 1px solid #e2e3da;
    box-shadow: 0 2px 4px rgba(38,42,51,.06), 0 28px 56px -18px rgba(38,42,51,.24); background: #fff; }
  .shot img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top left; }
  .main { left: 520px; top: 56px; width: 700px; height: 528px; }
  .dark { left: 470px; top: 96px; width: 340px; height: 210px; transform: rotate(-2deg); z-index: -1; opacity: .96; }
</style></head><body>
  <div class="glow"></div>
  <div class="mark">驴</div><div class="name">小驴考试</div><div class="sub">LV EXAM · SIYUAN PLUGIN</div>
  <h1>每次学习，<br>都知道下一步。</h1>
  <p class="tagline">思源笔记里的备考工作台：把你的题目、资料与作答流水连接起来——练习、模考、错题消灭与证据报告，全部本地可验证。</p>
  <div class="chips"><span class="chip">题库 · 导入校对</span><span class="chip">独立作答 · 键盘优先</span><span class="chip">错题本 · 证据报告</span><span class="chip">⌘K 全局直达</span></div>
  <p class="foot">本地优先 · 数据在你的思源仓库 · AI 只出候选不做决定</p>
  <div class="shot dark"><img src="${img("session-narrow.png")}" alt=""></div>
  <div class="shot main"><img src="${img("practice-entry.png")}" alt=""></div>
</body></html>`;

{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2 })).newPage();
  await page.setContent(social, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT_SOCIAL, "github-social-preview.png") });
  console.log("shot: design/social/github-social-preview.png");
  await page.context().close();
}

writeFileSync(resolve("design/screenshots/.gitkeep"), "");
await browser.close();
server.close();
console.log("完成 →", OUT_SHOTS, "&", OUT_SOCIAL);
