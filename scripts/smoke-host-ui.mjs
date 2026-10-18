// Background UI regression against an explicitly selected real SiYuan host.
// Usage: node scripts/smoke-host-ui.mjs --url http://127.0.0.1:6817 --workspace D:/siyuan-rig/ws-lvexam
// Opens only its own headless Chrome. Existing tabs and notebook data are kept.
/* global document, window, HTMLElement, getComputedStyle */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";

const { values } = parseArgs({
  options: { url: { type: "string" }, workspace: { type: "string" }, chrome: { type: "string" }, reloads: { type: "string", default: "2" }, "settle-ms": { type: "string", default: "750" } },
  strict: true,
});
if (!values.url || !values.workspace) {
  throw new Error("Both --url and --workspace are required; no host or workspace is selected by default.");
}
const target = new URL(values.url);
const reloadCount = Number(values.reloads);
assert.ok(Number.isInteger(reloadCount) && reloadCount >= 1 && reloadCount <= 20, "--reloads must be an integer from 1 to 20");
const settleMs = Number(values["settle-ms"]);
assert.ok(Number.isInteger(settleMs) && settleMs >= 0 && settleMs <= 5000, "--settle-ms must be an integer from 0 to 5000");
if (!["http:", "https:"].includes(target.protocol)
  || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
  || target.username || target.password || target.search || target.hash) {
  throw new Error("--url must be a loopback HTTP(S) URL without credentials, a query, or a fragment.");
}
const workspace = resolve(values.workspace);
let configuration;
try {
  configuration = JSON.parse(readFileSync(join(workspace, "conf/conf.json"), "utf8"));
} catch {
  throw new Error("The selected workspace configuration could not be read as JSON; its contents were not recorded.");
}
// Never log the configuration, authentication code, request body, or cookies.
const accessAuthCode = typeof configuration.accessAuthCode === "string" ? configuration.accessAuthCode : "";
const safeMessage = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  return accessAuthCode ? message.replaceAll(accessAuthCode, "[redacted]") : message;
};
const manifest = JSON.parse(readFileSync(join(workspace, "data/plugins/siyuan-exam/plugin.json"), "utf8"));
const chromePath = [
  values.chrome,
  process.env.CHROME_EXECUTABLE_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find((path) => typeof path === "string" && existsSync(path));
if (!chromePath) throw new Error("Google Chrome was not found. Pass --chrome or set CHROME_EXECUTABLE_PATH.");

const output = resolve(import.meta.dirname, "../output");
mkdirSync(output, { recursive: true });
const reportPath = join(output, "host-ui-smoke.json");
const result = {
  url: target.origin,
  workspace,
  pluginVersion: manifest.version,
  startedAt: new Date().toISOString(),
  status: "running",
  baselinePracticeTabs: null,
  checkpoints: [],
  pageErrors: [],
  diagnostics: [],
  screenshots: [],
};
let browser;
let page;

const entrySelector = '#toolbar [id^="plugin_siyuan-exam_"], #toolbar [id^="plugin_siyuan-exam:"]';
const mainHeadingSelector = ".lv-exam-tab .lv-screen-head .lv-eyebrow";

async function snapshot() {
  return page.evaluate(({ entrySelector, mainHeadingSelector }) => {
    const customType = "siyuan-examexam-practice";
    const headers = [...document.querySelectorAll('[data-type="tab-header"]')];
    const practiceTabs = headers.filter((header) => {
      let restoredType = "";
      try { restoredType = JSON.parse(header.getAttribute("data-initdata") ?? "null")?.customModelType ?? ""; }
      catch { /* unrelated damaged host data is not an exam tab */ }
      const examIcon = [...header.querySelectorAll("use")].some((icon) =>
        (icon.getAttribute("xlink:href") || icon.getAttribute("href")) === "#iconExam");
      // Count each header once even when both the restored metadata and icon
      // identify it. Tab data-id is random and cannot identify the custom type.
      return restoredType === customType || examIcon;
    });
    const visible = (node) => node instanceof HTMLElement
      && node.getClientRects().length > 0
      && getComputedStyle(node).visibility !== "hidden";
    const entries = [...document.querySelectorAll(entrySelector)];
    return {
      runtimeVersion: window.siyuanExam?.version ?? null,
      practiceTabs: practiceTabs.length,
      topbarEntries: entries.length,
      visibleTopbarEntries: entries.filter(visible).length,
      legacyStatusbars: document.querySelectorAll(".lv-statusbar").length,
      examDocks: document.querySelectorAll('.dock__item[data-type^="siyuan-exam"], .lv-dock-body').length,
      mainVisible: [...document.querySelectorAll(mainHeadingSelector)]
        .some((node) => visible(node) && node.textContent.trim() === "今日备考"),
      horizontalOverflow: Math.max(0, ...[...document.querySelectorAll(".lv-main")]
        .filter(visible).map((node) => node.scrollWidth - node.clientWidth)),
    };
  }, { entrySelector, mainHeadingSelector });
}

async function checkPoint(name, expectedCount) {
  await page.waitForFunction((selector) => [...document.querySelectorAll(selector)]
    .some((node) => node instanceof HTMLElement && node.getClientRects().length > 0
      && node.textContent.trim() === "今日备考"), mainHeadingSelector, { timeout: 30000 });
  const state = await snapshot();
  result.checkpoints.push({ name, ...state });
  assert.equal(state.runtimeVersion, manifest.version, `${name}: loaded plugin version differs from the installed manifest`);
  assert.equal(state.topbarEntries, 1, `${name}: expected one exam topbar entry`);
  assert.equal(state.visibleTopbarEntries, 1, `${name}: the exam entry must be visible`);
  assert.equal(state.legacyStatusbars, 0, `${name}: legacy exam statusbar must be absent`);
  assert.equal(state.examDocks, 0, `${name}: exam docks must be absent`);
  assert.equal(state.mainVisible, true, `${name}: the main exam page must be visible`);
  assert.ok(state.horizontalOverflow <= 2, `${name}: exam content overflows its host pane by ${state.horizontalOverflow}px`);
  assert.equal(state.practiceTabs, expectedCount, `${name}: practice tab count changed`);
  assert.deepEqual(result.pageErrors, [], `${name}: uncaught browser page errors`);
  return state;
}

async function screenshot(name) {
  const path = join(output, name);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  result.screenshots.push(path);
}

try {
  browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      console.error("[host-smoke-rejection]", JSON.stringify(reason, Object.getOwnPropertyNames(reason ?? {})));
    });
    window.addEventListener("error", (event) => {
      const error = event.error;
      console.error("[host-smoke-error]", event.message, event.filename, event.lineno,
        JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})));
    });
  });
  if (accessAuthCode) {
    let response;
    try {
      response = await context.request.post(new URL("/api/system/loginAuth", target).href, {
        data: { authCode: accessAuthCode, captcha: "", rememberMe: false },
        timeout: 15000,
      });
    } catch {
      throw new Error("Host authentication request failed; no authentication details were recorded.");
    }
    if (!response.ok()) throw new Error(`Host authentication HTTP status ${response.status()}.`);
    let authentication;
    try { authentication = await response.json(); }
    catch { throw new Error("Host authentication returned invalid JSON; response contents were not recorded."); }
    if (authentication.code !== 0) throw new Error("Host authentication was rejected; no authentication details were recorded.");
  }
  page = await context.newPage();
  page.on("pageerror", (error) => result.pageErrors.push(safeMessage(error.stack ?? error)));
  page.on("console", (message) => {
    if (/\[host-smoke-|\[lv-exam\]/.test(message.text())) result.diagnostics.push(safeMessage(message.text()));
  });
  await page.goto(new URL("/stage/build/desktop/", target).href, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator(entrySelector).first().waitFor({ state: "visible", timeout: 30000 });
  // Loading the plugin may restore old tabs. Record the initial host layout
  // before the first entry click so that duplicate creation cannot hide in it.
  await page.waitForFunction(() => window.siyuanExam?.version, undefined, { timeout: 30000 });
  const initial = await snapshot();
  result.baselinePracticeTabs = initial.practiceTabs;
  result.checkpoints.push({ name: "initial-layout", ...initial });
  assert.equal(initial.runtimeVersion, manifest.version, "initial-layout: loaded plugin version differs from the installed manifest");
  assert.equal(initial.topbarEntries, 1, "initial-layout: expected one exam topbar entry");
  assert.equal(initial.legacyStatusbars, 0, "initial-layout: legacy exam statusbar must be absent");
  assert.equal(initial.examDocks, 0, "initial-layout: exam docks must be absent");
  const expectedCount = Math.max(1, initial.practiceTabs);
  for (let click = 1; click <= 5; click += 1) {
    await page.locator(entrySelector).click();
    await checkPoint(`entry-click-${click}`, expectedCount);
  }
  await screenshot("host-ui-smoke-before-reload.png");
  for (let reload = 1; reload <= reloadCount; reload += 1) {
    // SiYuan reloads the plugin lifecycle asynchronously. A short settle
    // window prevents the next page reload from racing the prior unload and
    // turning a healthy page into a transient 410 lifecycle response.
    if (settleMs) await page.waitForTimeout(settleMs);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.locator(entrySelector).first().waitFor({ state: "visible", timeout: 30000 });
    await page.waitForFunction(() => window.siyuanExam?.version, undefined, { timeout: 30000 });
    await page.locator(entrySelector).click();
    await checkPoint(`reload-${reload}`, expectedCount);
  }
  await screenshot("host-ui-smoke-after-reload.png");
  result.status = "passed";
  console.log(`✓ Real host: one entry; no legacy statusbar/dock; practice tabs ${initial.practiceTabs} → ${expectedCount}; five clicks and ${reloadCount} reloads passed.`);
} catch (error) {
  result.status = "failed";
  result.error = safeMessage(error);
  if (page) {
    try { await screenshot("host-ui-smoke-failure.png"); } catch { /* preserve the original failure */ }
  }
  console.error(`✗ Real host UI regression failed: ${result.error}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  result.finishedAt = new Date().toISOString();
  writeFileSync(reportPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(`Report: ${reportPath}`);
}
