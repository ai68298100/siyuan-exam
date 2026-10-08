// 重制 icon.png（160×160）+ 矢量源 design/social/icon.svg
// 家族设计语言（对齐小驴系列：家=房子 / 闪卡=闪电卡片 / 人脉=双人 / 快门=门框）：
//   彩色渐变底 + 白色领域图形 + 一个暖色小点缀。考试 = 白色试卷卡 + 靛紫判卷对勾 + 橙点。
// 用法：node scripts/visual-harness/make-icon.mjs
import { chromium } from "playwright-core";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
mkdirSync(resolve("design/social"), { recursive: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8b7cf7"/>
      <stop offset="1" stop-color="#5646d6"/>
    </linearGradient>
    <linearGradient id="peek" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#d9d2fb"/>
      <stop offset="1" stop-color="#bdb2f6"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="224" fill="url(#bg)"/>
  <!-- 后层便签卡（家族分层母题，仿闪卡） -->
  <rect x="560" y="150" width="300" height="300" rx="72" fill="url(#peek)" opacity="0.92"/>
  <!-- 主试卷卡 -->
  <rect x="170" y="210" width="500" height="560" rx="72" fill="#ffffff"/>
  <!-- 题目行 -->
  <rect x="240" y="300" width="270" height="26" rx="13" fill="#c9c2f5"/>
  <rect x="240" y="368" width="200" height="26" rx="13" fill="#ded9fb"/>
  <!-- 判卷对勾 -->
  <path d="M 245 520 L 330 610 L 500 420" fill="none" stroke="#5646d6"
    stroke-width="52" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- 暖色点缀（家族母题：橙点） -->
  <circle cx="700" cy="700" r="42" fill="#f27a2c"/>
  <circle cx="688" cy="688" r="12" fill="#ffb98a"/>
</svg>`;
writeFileSync(resolve("design/social/icon.svg"), svg.trim() + "\n");
console.log("icon.svg written");

const browser = await chromium.launch({ executablePath: EDGE });
const html = `<!doctype html><html><head><style>*{margin:0}body{width:1024px;height:1024px}img{display:block;width:1024px;height:1024px}</style></head><body><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body></html>`;

const page = await (await browser.newContext({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 })).newPage();
await page.setContent(html);
await page.waitForTimeout(400);
const hi = resolve("design/social/icon-1024.png");
await page.screenshot({ path: hi });
await page.context().close();

const down = `<!doctype html><html><head><style>*{margin:0}body{width:160px;height:160px;overflow:hidden}img{display:block;width:160px;height:160px}</style></head><body><img src="data:image/png;base64,${readFileSync(hi).toString("base64")}"></body></html>`;
const page2 = await (await browser.newContext({ viewport: { width: 160, height: 160 }, deviceScaleFactor: 1 })).newPage();
await page2.setContent(down);
await page2.waitForTimeout(300);
await page2.screenshot({ path: resolve("icon.png") });
await browser.close();
console.log("icon.png 已重制（160×160）");
