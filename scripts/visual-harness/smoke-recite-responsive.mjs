// Recitation rating controls must remain visible and usable in narrow host panes.
// Run after pnpm build:harness; uses the real production Svelte component.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { launchHarnessBrowser } from "./browser.mjs";

const root = resolve(import.meta.dirname, "../../output/harness");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const path = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    res.writeHead(200, { "Content-Type": mime[extname(path)] ?? "application/octet-stream" });
    res.end(readFileSync(join(root, path)));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
const errors = [];

try {
  browser = await launchHarnessBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__app && window.__plugin);
  const messages = await page.evaluate(() => window.__plugin.i18n);
  await page.getByRole("button", { name: messages["mode.recite"], exact: false }).first().click();
  const reveal = page.getByRole("button", { name: messages["recite.reveal"], exact: true });
  await reveal.click();
  const ratings = page.locator("#app .lv-rate");

  async function verifyLayout(expectedColumns, context) {
    const layout = await ratings.evaluate((grid) => {
      const rect = grid.getBoundingClientRect();
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        clientWidth: grid.clientWidth,
        scrollWidth: grid.scrollWidth,
        buttons: [...grid.querySelectorAll("button")].map((button) => {
          const box = button.getBoundingClientRect();
          return { width: box.width, height: box.height, inside: box.left >= rect.left - 1 && box.right <= rect.right + 1, textFits: button.scrollWidth <= button.clientWidth + 1 };
        }),
      };
    });
    assert.equal(layout.columns, expectedColumns, `${context}: wrong number of rating columns`);
    assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `${context}: ratings need horizontal scrolling: ${JSON.stringify(layout)}`);
    assert.equal(layout.buttons.length, 4, `${context}: all four ratings must remain present`);
    assert.ok(layout.buttons.every((button) => button.inside && button.textFits && button.width >= 44 && button.height >= 44), `${context}: a rating is clipped or too small: ${JSON.stringify(layout)}`);
  }

  for (const width of [320, 390, 600, 601, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await verifyLayout(width <= 600 ? 2 : 4, `${width}px viewport`);
  }
  console.log("✓ 背诵评分在 320/390/600px 为两列，601/1440px 为四列，四项均完整且至少 44px");

  // A split SiYuan pane can be narrow even when the surrounding window is wide.
  await page.locator("#app").evaluate((app) => { app.style.flex = "0 0 390px"; });
  await verifyLayout(2, "390px split pane inside 1440px window");
  await page.evaluate(() => window.__theme(true));
  await verifyLayout(2, "dark split pane");
  const enlarged = await page.addStyleTag({ content: "#app .lv-rate .lv-btn { font-size: 28px !important; }" });
  await verifyLayout(2, "200% rating text");
  await enlarged.evaluate((style) => style.remove());
  await ratings.screenshot({ path: resolve(import.meta.dirname, "../../output/recite-ratings-mobile.png"), animations: "disabled" });
  console.log("✓ 宽窗口的窄分栏、暗色与 200% 评分文字均无需横向滚动");

  const before = await page.evaluate(() => window.__app.attempts.all().filter((event) => event.kind === "recite").length);
  for (let rating = 1; rating <= 4; rating += 1) {
    const button = ratings.locator(`.r${rating}`);
    await button.focus();
    assert.equal(await button.evaluate((node) => node === document.activeElement), true, `rating ${rating}: control should be focusable`);
  }
  // A seeded harness may contain one due question, so activate one rating and
  // verify the saved event while the loop above covers all focus targets.
  await ratings.locator(".r3").click();
  await page.waitForFunction((count) => window.__app.attempts.all().filter((event) => event.kind === "recite").length >= count, before + 1);
  const saved = await page.evaluate(() => window.__app.attempts.all().filter((event) => event.kind === "recite").at(-1)?.selfRating);
  assert.equal(saved, 3, "selected rating should save the matching self rating");
  const after = await page.evaluate(() => window.__app.attempts.all().filter((event) => event.kind === "recite").length);
  assert.equal(after, before + 1, "one rating activation should save exactly one recitation event");
  assert.deepEqual(errors, [], "recitation must not produce page errors");
  console.log("✓ 四个评分均可键盘聚焦，选中项可保存正确自评，且没有页面异常");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
