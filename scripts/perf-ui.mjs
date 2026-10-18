// Chrome harness performance sample. This is intentionally a measurement tool,
// not a pass/fail gate: it records the current evidence before performance work.
/* global window, document */
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { gzipSync } from "node:zlib";
import { launchHarnessBrowser } from "./visual-harness/browser.mjs";

const runs = Number(process.env.PERF_RUNS ?? 5);
if (!Number.isInteger(runs) || runs < 1 || runs > 50) throw new Error("PERF_RUNS 必须是 1 到 50 之间的整数");
const root = resolve(import.meta.dirname, "../output/harness");
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
]);
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const file = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (file !== root && !file.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, { "content-type": contentTypes.get(extname(file)) ?? "application/octet-stream" }).end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
const baseUrl = process.env.PERF_HARNESS_URL ?? `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/`;
const url = process.env.PERF_LAZY_TABS === "1" ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}lazy=1` : baseUrl;
const browser = await launchHarnessBrowser({ headless: true });
const samples = [];
try {
  for (let i = 0; i < runs; i += 1) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => {
      window.__lvPerf = { longTasks: [], cls: 0 };
      try {
        new PerformanceObserver((list) => window.__lvPerf.longTasks.push(...list.getEntries().map((entry) => entry.duration))).observe({ type: "longtask", buffered: true });
        new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__lvPerf.cls += entry.value; }).observe({ type: "layout-shift", buffered: true });
      } catch { /* unsupported in older Chromium */ }
    });
    const start = Date.now();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator(".lv-shell").waitFor({ state: "visible", timeout: 15000 });
    const shellVisibleMs = Date.now() - start;
    const nav = await page.evaluate(() => performance.getEntriesByType("navigation")[0]?.toJSON());
    const metrics = await page.evaluate(() => ({
      nodes: document.querySelectorAll("*").length,
      cls: window.__lvPerf.cls,
      longTaskMs: Math.max(0, ...window.__lvPerf.longTasks),
    }));
    const tabMs = [];
    for (const tab of ["mock", "report", "practice", "mock", "report", "practice"]) {
      const tabStart = Date.now();
      await page.locator(`#bar [data-tab="${tab}"]`).click();
      await page.waitForFunction((name) => document.querySelector(`#bar .on`)?.dataset.tab === name, tab);
      tabMs.push({ tab, ms: Date.now() - tabStart });
    }
    samples.push({ shellVisibleMs, tabMs, nodes: metrics.nodes, cls: metrics.cls, longTaskMs: metrics.longTaskMs, domContentLoadedMs: nav?.domContentLoadedEventEnd ?? null });
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}
const percentile = (values, p) => values.slice().sort((a, b) => a - b)[Math.max(0, Math.ceil(p * values.length) - 1)];
const summary = (values) => ({ p50: percentile(values, 0.5), p95: percentile(values, 0.95) });
const assetDir = resolve(root, "assets");
const assets = await readdir(assetDir);
const jsFiles = assets.filter((file) => file.endsWith(".js"));
const cssFiles = assets.filter((file) => file.endsWith(".css"));
const measureAssets = async (files) => {
  const rows = await Promise.all(files.map(async (file) => {
    const path = resolve(assetDir, file);
    const [body, info] = await Promise.all([readFile(path), stat(path)]);
    return { raw: info.size, gzip: gzipSync(body, { level: 9 }).length };
  }));
  return rows.reduce((total, row) => ({ raw: total.raw + row.raw, gzip: total.gzip + row.gzip }), { raw: 0, gzip: 0 });
};
const report = {
  runs,
  samples,
  assets: { js: await measureAssets(jsFiles), css: await measureAssets(cssFiles) },
  summary: {
    shellVisibleMs: summary(samples.map((s) => s.shellVisibleMs)),
    firstMockMs: summary(samples.map((s) => s.tabMs[0].ms)),
    firstReportMs: summary(samples.map((s) => s.tabMs[1].ms)),
    warmPracticeMs: summary(samples.map((s) => s.tabMs[2].ms)),
    nodes: summary(samples.map((s) => s.nodes)),
    cls: summary(samples.map((s) => s.cls)),
    longTaskMs: summary(samples.map((s) => s.longTaskMs)),
    domContentLoadedMs: summary(samples.map((s) => s.domContentLoadedMs ?? 0)),
  },
};
console.log(JSON.stringify(process.env.PERF_COMPACT === "1"
  ? { runs, url, assets: report.assets, summary: report.summary }
  : report, null, 2));
