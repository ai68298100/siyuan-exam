// 报告页下一行动交互回归：确认分支、忙碌锁、成功提示及写入成功/列表刷新失败降级。
// 前置：pnpm exec vite build --config scripts/visual-harness/vite.config.ts
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import assert from "node:assert/strict";
import { launchHarnessBrowser } from "./browser.mjs";

const root = resolve(import.meta.dirname, "../../output/harness");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const path = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    res.writeHead(200, { "content-type": mime[extname(path)] ?? "application/octet-stream" });
    res.end(readFileSync(join(root, path)));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolvePromise) => server.listen(4224, "127.0.0.1", resolvePromise));
let browser;
try {
  browser = await launchHarnessBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(8000);
  await page.goto("http://127.0.0.1:4224/");
  await page.waitForFunction(() => window.__app && window.__plugin);

  const addAction = async (detail) => {
    await page.evaluate(async (text) => {
      await window.__app.addActions([{ kind: "custom", detail: text }]);
      window.__show("report");
      // report onMount reads the action list; give it a bus event after mounting.
      window.dispatchEvent(new Event("lv-harness-action-added"));
    }, detail);
    await page.getByRole("button", { name: "记录与证据", exact: true }).click();
    await page.getByText(detail, { exact: true }).waitFor();
  };
  const rowFor = (detail) => page.locator(".lv-row").filter({ hasText: detail }).first();
  const dismissButton = (detail) => rowFor(detail).getByRole("button", { name: "取消此行动", exact: true });

  // 取消确认：点取消，行动仍在待办；再确认，写入期间所有该列表按钮锁定。
  const first = "smoke：取消确认分支";
  await addAction(first);
  await dismissButton(first).click();
  const dialog = page.locator(".b3-dialog");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByText(first, { exact: true }).waitFor();
  const afterConfirmCancel = await page.evaluate(async (detail) => {
    const items = await window.__app.deps.storage.load("actions/items");
    return items.find((item) => item.detail === detail)?.status;
  }, first);
  assert.equal(afterConfirmCancel, "open", "cancelling confirmation must preserve the open action");

  await page.evaluate(() => {
    const app = window.__app;
    const original = app.cancelAction.bind(app);
    window.__originalCancelAction = app.cancelAction;
    window.__cancelStarted = false;
    window.__resolveCancel = null;
    app.cancelAction = async (id) => {
      window.__cancelStarted = true;
      await new Promise((resolvePromise) => { window.__resolveCancel = resolvePromise; });
      return original(id);
    };
  });
  await dismissButton(first).click();
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await page.waitForFunction(() => window.__cancelStarted === true);
  assert.equal(await rowFor(first).getByRole("button").first().isDisabled(), true, "cancel in flight must lock row controls");
  await page.evaluate(() => window.__resolveCancel());
  await page.getByText("行动已取消，记录仍保留", { exact: true }).last().waitFor();
  await page.getByText(first, { exact: true }).waitFor({ state: "hidden" });
  await page.evaluate(() => { window.__app.cancelAction = window.__originalCancelAction; });

  // 写入已成功但刷新列表失败：行动先从当前待办移除，给出可读的刷新失败提示。
  const second = "smoke：刷新失败分支";
  await addAction(second);
  await page.evaluate(() => {
    const app = window.__app;
    const original = app.listOpenActions.bind(app);
    window.__originalListOpenActions = original;
    app.listOpenActions = async () => {
      throw new Error("模拟列表刷新失败");
    };
  });
  await dismissButton(second).click();
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await page.getByText("行动已取消，记录仍保留", { exact: true }).last().waitFor();
  await page.getByText(/行动已更新，但列表刷新失败/).waitFor();
  await page.getByText(second, { exact: true }).waitFor({ state: "hidden" });
  const persistedStatus = await page.evaluate(async (detail) => {
    window.__app.listOpenActions = window.__originalListOpenActions;
    const items = await window.__app.deps.storage.load("actions/items");
    return items.find((item) => item.detail === detail)?.status;
  }, second);
  assert.equal(persistedStatus, "cancelled", "the cancellation write must persist despite refresh failure");
  console.log("✓ 报告行动：取消确认/保留、忙碌锁、成功提示及刷新失败降级均可观察");
} finally {
  await browser?.close();
  await new Promise((resolvePromise) => server.close(resolvePromise));
}
