// 重制 icon.png（160×160，市场标准）+ 矢量源 design/social/icon.svg
// 设计语言与产品内 brand-mark 同源：靛紫渐变 + 白「驴」+ 内高光（docs/25 P2：图标识别度）
// 用法：node scripts/visual-harness/make-icon.mjs
import { chromium } from "playwright-core";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
mkdirSync(resolve("design/social"), { recursive: true });

// 矢量源（单一事实，PNG 由它渲染降采样）
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="#6a5ce0"/>
      <stop offset="1" stop-color="#4a3fb8"/>
    </linearGradient>
    <linearGradient id="hl" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <rect width="512" height="512" rx="112" fill="url(#hl)"/>
  <text x="256" y="262" text-anchor="middle" dominant-baseline="central"
    font-family="Songti SC, SimSun, Georgia, serif" font-weight="700"
    font-size="300" fill="#ffffff">驴</text>
</svg>`;
writeFileSync(resolve("design/social/icon.svg"), svg.trim() + "\n");
console.log("icon.svg written");

const browser = await chromium.launch({ executablePath: EDGE });
// 512 高清渲染 → 160 市场标准（浏览器高质量降采样）
const html = `<!doctype html><html><head><style>
  *{margin:0}body{width:512px;height:512px}
  img{display:block;width:512px;height:512px}
</style></head><body><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body></html>`;

const page = await (await browser.newContext({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 })).newPage();
await page.setContent(html);
await page.waitForTimeout(400);
const hi = resolve("design/social/icon-512.png");
await page.screenshot({ path: hi });
await page.context().close();

// 降采样到 160×160
const down = `<!doctype html><html><head><style>*{margin:0}body{width:160px;height:160px;overflow:hidden}img{display:block;width:160px;height:160px}</style></head><body><img src="data:image/png;base64,${readFileSync(hi).toString("base64")}"></body></html>`;
const page2 = await (await browser.newContext({ viewport: { width: 160, height: 160 }, deviceScaleFactor: 1 })).newPage();
await page2.setContent(down);
await page2.waitForTimeout(300);
await page2.screenshot({ path: resolve("icon.png") });
await browser.close();
console.log("icon.png 已重制（160×160）");
