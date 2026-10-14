import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { launchHarnessBrowser } from "../../scripts/visual-harness/browser.mjs";

const root = resolve(import.meta.dirname);
const server = createServer((req, res) => {
  const requested = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  const path = requested === "/" ? "/index.html" : requested;
  try {
    res.writeHead(200, {
      "Content-Type":
        { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" }[
          extname(path)
        ] ?? "application/octet-stream",
    });
    res.end(readFileSync(join(root, path)));
  } catch {
    res.writeHead(404);
    res.end();
  }
});

await new Promise((listen) => server.listen(0, "127.0.0.1", listen));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
let browser;
const errors = [];

try {
  browser = await launchHarnessBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(7000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.locator("#page-picker").selectOption("report");

  const head = page.locator("#screen .page-head");
  const scopeCopy = await head.innerText();
  assert.match(scopeCopy, /作答统计按日期范围覆盖全部题库/);
  assert.match(scopeCopy, /考点掌握与薄弱项按当前题库累计历史/);
  assert.match(scopeCopy, /热力图、连胜与消灭错题按全局状态统计/);
  assert.match(scopeCopy, /固定样例，范围切换不会真实筛选图表/);

  const chartValues = await page.locator(".chart-column span").allTextContents();
  await page.locator("#report-range").selectOption("day");
  assert.match(await head.innerText(), /作答统计按日期范围覆盖全部题库/);
  assert.deepEqual(await page.locator(".chart-column span").allTextContents(), chartValues, "date selection must not imply that fixed prototype charts were filtered");

  await page.getByRole("button", { name: "考点与错题", exact: true }).click();
  assert.match(await head.innerText(), /考点掌握与薄弱项按当前题库累计历史/);
  await page.getByRole("button", { name: "概览", exact: true }).click();
  await page.getByRole("button", { name: "说明数据口径", exact: true }).click();
  const help = page.locator("#dialog .dialog-body");
  assert.match(await help.innerText(), /作答统计 · 日期范围[\s\S]*覆盖全部题库/);
  assert.match(await help.innerText(), /考点掌握与薄弱项 · 当前题库[\s\S]*不随上方日期范围收窄/);
  assert.match(await help.innerText(), /热力图、连胜与消灭错题 · 全局[\s\S]*不随日期和题库筛选变化/);
  await page.getByRole("button", { name: "关闭弹层" }).click();

  assert.match(await page.locator("#screen").innerText(), /当前题库今日作答，不受上方日期筛选影响/);
  assert.match(await page.locator("#screen").innerText(), /本原型只预览，不写入笔记/);
  await page.getByRole("button", { name: "预览今日战报范围", exact: true }).click();
  const daily = page.locator("#dialog .dialog-body");
  assert.match(await daily.innerText(), /当前示例题库今天的作答记录/);
  assert.match(await daily.innerText(), /不会受上方“今天”筛选影响/);
  assert.match(await daily.innerText(), /本原型只预览口径，不创建或修改笔记/);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "report scope copy and daily preview must fit a 390px viewport",
  );
  await page.setViewportSize({ width: 320, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "report scope copy and daily preview must fit a 320px viewport",
  );
  const kpiValues = page.locator(".metrics strong");
  for (let index = 0; index < (await kpiValues.count()); index++) {
    const box = await kpiValues.nth(index).evaluate((node) => ({
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      height: node.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(node).lineHeight),
    }));
    assert.ok(box.scrollWidth <= box.clientWidth + 1, `320px KPI ${index + 1} should not clip horizontally: ${JSON.stringify(box)}`);
    assert.ok(box.height <= box.lineHeight + 1, `320px KPI ${index + 1} should remain on one line: ${JSON.stringify(box)}`);
  }
  assert.deepEqual(errors, []);
  console.log("✓ R54 复盘口径：页头、日期切换、考点分区、帮助弹窗与今日战报范围通过");
} finally {
  await browser?.close();
  await new Promise((close) => server.close(close));
}
