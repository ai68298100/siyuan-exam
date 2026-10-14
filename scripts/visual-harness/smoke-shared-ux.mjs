// 共享命令面板/导航抽屉的真实组件回归：先构建 visual-harness，独立使用 4217 端口。
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { launchHarnessBrowser } from "./browser.mjs";

const root = resolve(import.meta.dirname, "../../output/harness");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const path = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    res.writeHead(200, { "content-type": mime[extname(path)] ?? "application/octet-stream" });
    res.end(readFileSync(join(root, path)));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(4217, "127.0.0.1", resolve));
let browser;
try {
  browser = await launchHarnessBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("http://127.0.0.1:4217/");
  const trigger = page.locator("#app .lv-palette-btn");
  await trigger.click();
  const input = page.locator("#app .lv-palette input");
  await input.waitFor();
  await input.evaluate((el) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })));
  if (!await input.isVisible()) throw new Error("输入法 Enter 执行了命令");
  console.log("✓ 命令面板输入法确认不执行命令");

  await input.press("Tab");
  await page.keyboard.press("Tab");
  const focusedText = await page.evaluate(() => document.activeElement.textContent.trim());
  if (focusedText !== "错题本") throw new Error(`Tab 未聚焦第二条命令：${focusedText}`);
  await page.keyboard.press("Enter");
  await page.locator("#app h1.lv-h1").filter({ hasText: "错题本" }).waitFor({ state: "visible", timeout: 4000 });
  console.log("✓ Tab 聚焦命令后 Enter 执行焦点项");

  await trigger.click();
  await input.waitFor();
  const count = await page.locator("#app .lv-palette-item").count();
  for (let i = 0; i < count; i++) await input.press("ArrowDown");
  const visibleSelected = await page.locator("#app .lv-palette-item.sel").evaluate((el) => {
    const list = el.closest(".lv-palette-list").getBoundingClientRect();
    const item = el.getBoundingClientRect();
    return item.top >= list.top && item.bottom <= list.bottom;
  });
  if (!visibleSelected) throw new Error("方向键选中项滚出了命令列表");
  await input.press("Escape");
  if (!await trigger.evaluate((el) => document.activeElement === el)) throw new Error("关闭命令面板未归还触发钮焦点");
  if (await page.locator("#app .block__icons[inert]").count()) throw new Error("关闭后背景仍 inert");
  console.log("✓ 方向键滚动跟随选中项，Esc 后归还焦点和背景操作");

  await page.setViewportSize({ width: 759, height: 900 });
  const menu = page.locator("#app .lv-menu-btn");
  if (await menu.getAttribute("aria-expanded") !== "false") throw new Error("closed navigation trigger must expose aria-expanded=false");
  await menu.click();
  if (await menu.getAttribute("aria-expanded") !== "true") throw new Error("open navigation trigger must expose aria-expanded=true");
  await page.locator("#app .lv-rail.open .lv-project").click();
  await page.locator("#app .lv-rail.open").waitFor({ state: "hidden" });
  if (!await menu.evaluate((el) => document.activeElement === el)) throw new Error("题库卡导航后未归还菜单钮焦点");
  console.log("✓ 窄屏点击题库卡完成导航后收起抽屉并归还焦点");

  await menu.click();
  await page.locator("#app .lv-rail.open .lv-drawer-close").waitFor();
  await page.keyboard.press("Escape");
  await page.locator("#app .lv-rail.open").waitFor({ state: "hidden" });
  if (await menu.getAttribute("aria-expanded") !== "false") throw new Error("navigation trigger must report closed after Escape");
  if (!await menu.evaluate((el) => document.activeElement === el)) throw new Error("Esc 后未归还菜单钮焦点");
  if (await page.locator("#app .lv-main[inert]").count()) throw new Error("抽屉关闭后主内容仍 inert");
  console.log("✓ 窄屏 Esc 关闭抽屉后主内容可操作");

  await menu.click();
  await page.locator("#app .lv-rail.open .lv-drawer-close").waitFor();
  await page.keyboard.press("Control+k");
  await input.waitFor();
  await input.press("Tab");
  if (!await page.locator("#app .lv-palette-item").first().evaluate((el) => document.activeElement === el)) throw new Error("导航抽屉劫持了命令面板的 Tab");
  await page.keyboard.press("Escape");
  await page.locator("#app .lv-palette").waitFor({ state: "hidden" });
  await page.keyboard.press("Escape");
  await page.locator("#app .lv-rail.open").waitFor({ state: "hidden" });
  console.log("✓ 导航抽屉上方呼出命令面板，两个焦点循环不冲突");
  for (const tab of ["mock", "report"]) {
    await page.locator(`#bar [data-tab=${tab}]`).click();
    const tabMenu = page.locator("#app .lv-menu-btn");
    if (await tabMenu.getAttribute("aria-expanded") !== "false") throw new Error(`${tab} navigation trigger must start collapsed`);
    await tabMenu.click();
    if (await tabMenu.getAttribute("aria-expanded") !== "true") throw new Error(`${tab} navigation trigger must report expanded`);
    await page.keyboard.press("Escape");
    await page.locator("#app .lv-rail.open").waitFor({ state: "hidden" });
    if (await tabMenu.getAttribute("aria-expanded") !== "false") throw new Error(`${tab} navigation trigger must report collapsed after Escape`);
  }
  console.log("✓ 练习、模考、复盘导航触发器均同步读屏展开状态");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("✓ 无页面运行时异常");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
