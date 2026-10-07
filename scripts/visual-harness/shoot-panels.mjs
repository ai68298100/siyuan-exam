// 一次性显影未检 UI 面板：批量编辑/题库健康/勘误/纸笔回录/Hint 递进/退出确认/背诵完成
// 用法：node scripts/visual-harness/shoot-panels.mjs [前缀=ux2]
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../output/harness");
const OUT = resolve(import.meta.dirname, "../../output/playwright");
const PREFIX = process.argv[2] ?? "ux2";
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
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(4201, r));
let browser = await chromium.launch({ executablePath: EDGE });

const shot = async (name, { dark = false, narrow = false, steps = [] } = {}) => {
  const ctx = await browser.newContext({
    viewport: narrow ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (err) => errs.push("pageerror: " + String(err).slice(0, 140)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errs.push("console.error: " + msg.text().slice(0, 140));
  });
  await page.goto("http://127.0.0.1:4201/");
  await page.evaluate((d) => {
    window.__theme(d);
    window.__show("practice");
  }, dark);
  await page.waitForTimeout(700);
  for (const step of steps) {
    try {
      if (step.click) await page.locator(step.click).first().click({ timeout: step.t ?? 4000 });
      if (step.eval) await page.evaluate(step.eval);
      if (step.keyboard) await page.keyboard.press(step.keyboard);
      await page.waitForTimeout(step.wait ?? 700);
    } catch (e) {
      console.log(`  ⚠ ${name} 步骤失败：${step.click ?? step.keyboard ?? "eval"} — ${String(e).slice(0, 90)}`);
    }
  }
  await page.screenshot({ path: join(OUT, `${PREFIX}-${name}.png`) });
  if (errs.length) {
    console.log(`  ✗ ${PREFIX}-${name}.png 运行时错误：`);
    errs.forEach((e) => console.log(`      ${e}`));
  } else {
    console.log(`✓ ${PREFIX}-${name}.png`);
  }
  await ctx.close();
};

const BROWSE = [{ click: "#app button:has-text('浏览')", wait: 800 }];
// 工具行收敛后：维护面板入口在「更多」菜单内
const MORE = [...BROWSE, { click: "#app .lv-more > button", wait: 400 }];
const menuItem = (text) => `#app .lv-more-pop button:has-text("${text}")`;

// —— 模考成绩单：逐题分支作答（选择点首项 / 填空填写）后交卷 ——
{
  const perQuestion = Array.from({ length: 8 }, (_, i) => [
    { click: `#app .lv-cell >> nth=${i}`, wait: 400 },
    { click: "#app button.lv-opt >> nth=0", t: 1200, wait: 250 },
    { fill: ["#app .lv-question textarea", "模拟作答"], t: 1200, wait: 250 },
  ]).flat();
  await shot("mock-score", {
    steps: [
      { eval: "window.__show('mock')", wait: 700 },
      { click: "#app button:has-text('开始模考')", wait: 1200 },
      ...perQuestion,
      { click: "#app button:has-text('交卷')", wait: 600 },
      { click: "#confirmDialogConfirmBtn", wait: 1800 },
    ],
  });
}

// —— 报告下钻（44-02）：种子含「自评确定却答错」事件，校准卡出下钻按钮 ——
await shot("report-drill", {
  steps: [
    { eval: "window.__show('report')", wait: 1000 },
    { click: "#app button:has-text('确定-错 题目下钻')", t: 5000, wait: 800 },
  ],
});

await shot("batch-mode", {
  steps: [
    ...BROWSE,
    { click: "#app button:has-text('批量编辑')", wait: 500 },
    { click: "#app .lv-qrow-head >> nth=0", wait: 300 },
    { click: "#app .lv-qrow-head >> nth=1", wait: 400 },
  ],
});
await shot("health-panel", { steps: [...MORE, { click: menuItem("题库健康"), wait: 700 }] });
await shot("errata-panel", { steps: [...MORE, { click: menuItem("勘误回导"), wait: 700 }] });
await shot("paper-panel", { steps: [...MORE, { click: menuItem("纸笔回录"), wait: 700 }] });
await shot("kp-panel", { steps: [...MORE, { click: menuItem("考点治理"), wait: 700 }] });
// 更多菜单展开态
await shot("more-menu", { steps: [...MORE] });
await shot("hint-panel", {
  steps: [
    { click: "#app .lv-mode:has-text('快速刷题')", wait: 1100 },
    { click: "#app button:has-text('Hint 递进')", wait: 800 },
  ],
});
await shot("exit-confirm", {
  steps: [
    { click: "#app .lv-mode:has-text('快速刷题')", wait: 1100 },
    { click: "#app button:has-text('结束练习')", wait: 800 },
  ],
});
await shot("recite-done", {
  dark: true,
  steps: [
    { click: "#app .lv-mode:has-text('背诵')", wait: 1100 },
    { click: "#app button:has-text('翻开答案')", wait: 700 },
    { click: "#app .lv-rate .r3", wait: 700 },
    { click: "#app button:has-text('翻开答案')", wait: 700 },
    { click: "#app .lv-rate .r4", wait: 900 },
  ],
});

await browser.close();
server.close();
console.log("完成 →", OUT);
