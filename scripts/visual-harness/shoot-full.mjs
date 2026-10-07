// 全视图截图（本轮 UI 打磨用）：真实 harness 全路由 + 明暗双模式
// 用法：node scripts/visual-harness/shoot-full.mjs [前缀=now]
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../output/harness");
const OUT = resolve(import.meta.dirname, "../../output/playwright");
const PREFIX = process.argv[2] ?? "now";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
if (!existsSync(join(ROOT, "index.html"))) {
  console.error("✗ 先构建 harness：npx vite build --config scripts/visual-harness/vite.config.ts");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".json": "application/json",
};
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
await new Promise((r) => server.listen(4199, r));
let browser = await chromium.launch({ executablePath: EDGE });

const btn = (text) => `#app button:has-text("${text}")`;
const shotOnce = async (name, { dark = false, narrow = false, steps = [] } = {}) => {
  const ctx = await browser.newContext({
    viewport: narrow ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  // 运行时错误采集：pageerror（未捕获异常）+ console.error（渲染正常但隐形报错的视图会在此现形）
  const errs = [];
  page.on("pageerror", (err) => errs.push("pageerror: " + String(err).slice(0, 140)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errs.push("console.error: " + msg.text().slice(0, 140));
  });
  await page.goto("http://127.0.0.1:4199/");
  await page.evaluate((d) => {
    window.__theme(d);
    window.__show("practice");
  }, dark);
  await page.waitForTimeout(700);
  for (const step of steps) {
    try {
      if (step.click)
        await page
          .locator(step.click)
          .first()
          .click({ timeout: step.t ?? 4000 });
      if (step.fill)
        await page
          .locator(step.fill[0])
          .first()
          .fill(step.fill[1], { timeout: step.t ?? 4000 });
      if (step.eval) await page.evaluate(step.eval);
      if (step.keyboard) await page.keyboard.press(step.keyboard);
      await page.waitForTimeout(step.wait ?? 700);
    } catch (e) {
      console.log(
        `  ⚠ ${name} 步骤失败：${step.click ?? step.fill?.[0] ?? step.keyboard ?? step.eval} — ${String(e).slice(0, 100)}`,
      );
    }
  }
  try {
    await page.screenshot({ path: join(OUT, `${PREFIX}-${name}.png`) });
  } catch (e) {
    // Edge 偶发截图崩溃：等一拍重试一次
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, `${PREFIX}-${name}.png`) });
  }
  if (errs.length) {
    console.log(`  ✗ ${PREFIX}-${name}.png 运行时错误 ${errs.length} 条：`);
    errs.forEach((e) => console.log(`      ${e}`));
  } else {
    console.log(`✓ ${PREFIX}-${name}.png`);
  }
  await ctx.close();
};
// Edge 长会话偶发整浏览器断连：自动重启并重试该张一次
const shot = async (name, opts = {}) => {
  try {
    await shotOnce(name, opts);
  } catch (e) {
    console.log(`  ⚠ ${name} 浏览器异常，重启重试 — ${String(e).slice(0, 90)}`);
    try {
      await browser.close();
    } catch {
      /* 已死 */
    }
    browser = await chromium.launch({ executablePath: EDGE });
    await shotOnce(name, opts);
  }
};

// 练习台路由
await shot("entry");
await shot("entry-dark", { dark: true });
await shot("wrongbook", { steps: [{ click: "#app .lv-rail-btn:has-text('错题本')", wait: 900 }] });
await shot("palette", {
  steps: [{ keyboard: "Control+k", wait: 400 }],
});
await shot("browse", { steps: [{ click: btn("浏览") }] });
await shot("import", { steps: [{ click: btn("导入题库") }] });
await shot("manual", { steps: [{ click: btn("手工录题") }] });
await shot("ai", { steps: [{ click: btn("AI 出题") }] });
await shot("materials", { steps: [{ click: btn("学习资料") }] });
await shot("recite", { steps: [{ click: "#app .lv-mode:has-text('背诵')", wait: 1100 }] });
await shot("recite-reveal", {
  steps: [
    { click: "#app .lv-mode:has-text('背诵')", wait: 1100 },
    { click: btn("翻开答案"), wait: 900 },
  ],
});
await shot("session-start", { steps: [{ click: "#app .lv-mode:has-text('快速刷题')", wait: 1100 }] });
await shot("session-done", {
  steps: [
    { click: "#app .lv-mode:has-text('错题重练')", wait: 1100 },
    // 队列 3 题（错题加权，题型混合）：每轮「能填就填 → 提交 → 下一题」，多余步骤自动容忍
    { fill: ["#app .lv-answer-num", "999"], wait: 200 },
    { fill: ["#app .lv-answer-blank >> nth=0", "甲"], wait: 200 },
    { click: btn("提交"), wait: 900 },
    { click: btn("下一题"), wait: 700 },
    { fill: ["#app .lv-answer-num", "999"], wait: 200 },
    { fill: ["#app .lv-answer-blank >> nth=1", "乙"], wait: 200 },
    { click: btn("提交"), wait: 900 },
    { click: btn("下一题"), wait: 700 },
    { fill: ["#app .lv-answer-num", "999"], wait: 200 },
    { fill: ["#app .lv-answer-blank >> nth=0", "甲"], wait: 200 },
    { click: btn("提交"), wait: 900 },
    { click: btn("下一题"), wait: 900 },
    { fill: ["#app .lv-answer-num", "999"], t: 1200, wait: 200 },
    { fill: ["#app .lv-answer-blank >> nth=0", "甲"], t: 1200, wait: 200 },
    { click: btn("提交"), wait: 900 },
    { click: btn("下一题"), wait: 900 },
    { fill: ["#app .lv-answer-num", "999"], t: 1200, wait: 200 },
    { fill: ["#app .lv-answer-blank >> nth=0", "甲"], t: 1200, wait: 200 },
    { click: btn("提交"), wait: 900 },
    { click: btn("下一题"), wait: 900 },
  ],
});
await shot("session-feedback", {
  steps: [
    { click: "#app .lv-mode:has-text('快速刷题')", wait: 1100 },
    { click: "#app button.lv-opt", wait: 300 },
    { fill: ["#app .lv-answer-num, #app .lv-answer-blank", "350"], wait: 300 },
    { click: btn("提交"), wait: 900 },
  ],
});
await shot("import-preview", {
  steps: [
    { click: btn("导入题库"), wait: 700 },
    {
      fill: ["#app textarea.lv-textarea", "思源笔记的内核是什么？\nA. Electron + Node.js\nB. Go\nC. Rust\nANSWER: A"],
      t: 2000,
      wait: 300,
    },
    { click: btn("解析预览"), wait: 1500 },
  ],
});
await shot("browse-detail", {
  steps: [
    { click: btn("浏览"), wait: 900 },
    { click: "#app .lv-qrow-head", wait: 900 },
  ],
});
await shot("browse-wrong-filter", {
  steps: [
    { click: btn("浏览"), wait: 700 },
    { click: "#app button:has-text('错题')", wait: 700 },
  ],
});

// 模考场
await shot("mock", { steps: [{ eval: "window.__show('mock')" }] });
// 模考成绩单（8 题经答题卡逐题作答后交卷，无未答确认直达）
await shot("mock-score", {
  steps: [
    { eval: "window.__show('mock')", wait: 600 },
    { click: btn("开始模考"), wait: 1200 },
    { click: "#app .lv-cell >> nth=0", wait: 400 },
    { click: "#app button.lv-opt", t: 1200, wait: 200 },
    { fill: ["#app .lv-question textarea", "模拟作答"], t: 1200, wait: 200 },
    { click: "#app .lv-cell >> nth=1", wait: 400 },
    { click: "#app button.lv-opt", t: 1200, wait: 200 },
    { fill: ["#app .lv-question textarea", "模拟作答"], t: 1200, wait: 200 },
    { click: "#app .lv-cell >> nth=2", wait: 400 },
    { click: "#app button.lv-opt", t: 1200, wait: 200 },
    { fill: ["#app .lv-question textarea", "模拟作答"], t: 1200, wait: 200 },
    { click: "#app .lv-cell >> nth=3", wait: 400 },
    { click: "#app button.lv-opt", t: 1200, wait: 200 },
    { fill: ["#app .lv-question textarea", "模拟作答"], t: 1200, wait: 200 },
    { click: "#app .lv-cell >> nth=4", wait: 400 },
    { click: "#app button.lv-opt", t: 1200, wait: 200 },
    { fill: ["#app .lv-question textarea", "模拟作答"], t: 1200, wait: 200 },
    { click: "#app .lv-cell >> nth=5", wait: 400 },
    { click: "#app button.lv-opt", t: 1200, wait: 200 },
    { fill: ["#app .lv-question textarea", "模拟作答"], t: 1200, wait: 200 },
    { click: "#app .lv-cell >> nth=6", wait: 400 },
    { click: "#app button.lv-opt", t: 1200, wait: 200 },
    { fill: ["#app .lv-question textarea", "模拟作答"], t: 1200, wait: 200 },
    { click: "#app .lv-cell >> nth=7", wait: 400 },
    { click: "#app button.lv-opt", t: 1200, wait: 200 },
    { fill: ["#app .lv-question textarea", "模拟作答"], t: 1200, wait: 200 },
    { click: btn("交卷"), wait: 600 },
    { click: "#confirmDialogConfirmBtn", wait: 1800 },
  ],
});
await shot("mock-running", {
  steps: [
    { eval: "window.__show('mock')", wait: 500 },
    { click: btn("开始模考"), wait: 1200 },
  ],
});

// 报告中心
await shot("report", { steps: [{ eval: "window.__show('report')" }] });
await shot("report-dark", { dark: true, steps: [{ eval: "window.__show('report')" }] });

// 设置
await shot("settings", { steps: [{ eval: "window.__settings()" }] });
// AI 候选审核队列（ai/review-queue 种子驱动）
await shot("ai-queue", {
  steps: [
    { click: btn("AI 出题"), wait: 900 },
    {
      eval: "document.querySelectorAll('.lv-main, .lv-pad').forEach((m) => (m.scrollTop = m.scrollHeight))",
      wait: 500,
    },
  ],
});
// AI 解读结果卡（stub 固定响应驱动 38 历史落盘）
await shot("ai-explain-result", {
  steps: [
    { eval: "window.__show('report')", wait: 900 },
    { click: btn("AI 解读"), wait: 2500 },
  ],
});
// 考后估分（mock 配置内可展开面）
const SCROLL_BOTTOM =
  "[...document.querySelectorAll('#app, .lv-main, .lv-pad')].forEach((m) => (m.scrollTop = m.scrollHeight))";
await shot("estimate-expand", {
  steps: [
    { eval: "window.__show('mock')", wait: 700 },
    { click: btn("考后估分"), wait: 800 },
    { eval: SCROLL_BOTTOM, wait: 400 },
  ],
});
// 报告下钻（44-02：确定-错 逐题展开）
await shot("report-drill", {
  steps: [
    { eval: "window.__show('report')", wait: 900 },
    { click: "#app button:has-text('确定-错 题目下钻')", wait: 800 },
    { eval: "[...document.querySelectorAll('.lv-main, .lv-pad')].forEach((m) => (m.scrollTop = 700))", wait: 400 },
  ],
});
await shot("report-charts", {
  steps: [
    { eval: "window.__show('report')", wait: 900 },
    { eval: "[...document.querySelectorAll('.lv-main, .lv-pad')].forEach((m) => (m.scrollTop = 900))", wait: 500 },
  ],
});

// 窄屏（390）：响应式与抽屉 rail 验证
await shot("entry-narrow", { narrow: true });
await shot("wrongbook-narrow", {
  narrow: true,
  steps: [
    { click: "#app .lv-menu-btn", wait: 600 },
    { click: "#app .lv-rail-btn:has-text('错题本')", wait: 900 },
  ],
});
await shot("session-narrow", {
  narrow: true,
  steps: [
    { click: "#app .lv-mode:has-text('快速刷题')", wait: 1100 },
    { click: "#app button.lv-opt", wait: 400 },
  ],
});
await shot("mock-running-narrow", {
  narrow: true,
  steps: [
    { eval: "window.__show('mock')", wait: 600 },
    { click: btn("开始模考"), wait: 1200 },
  ],
});
await shot("palette-narrow", { narrow: true, steps: [{ keyboard: "Control+k", wait: 500 }] });
// 暗色：错题本 / 面板 token 验证
await shot("wrongbook-dark", { dark: true, steps: [{ click: "#app .lv-rail-btn:has-text('错题本')", wait: 900 }] });
await shot("palette-dark", { dark: true, steps: [{ keyboard: "Control+k", wait: 500 }] });

await browser.close();
server.close();
console.log("完成 →", OUT);
