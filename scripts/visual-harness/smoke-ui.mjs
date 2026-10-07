// ============================================================
// 真机 UI 流走查（docs/17 27/28/36 + 63-03 + 38 的可自动化面）
// 与 smoke-e2e.mjs 互补：e2e 校验存储 schema（被动），
// 本脚本驱动真实 UI 流并断言状态迁移与流水落盘（主动）：
//   36     作答信心 → attempts 事件 confidence 字段
//   63-03  改答轨迹：改答 → 终答落事件
//   27     模考作答 → 刷新 → 恢复卡片 → 恢复后卷序与进度保留
//   28     过期恢复：改写快照 startedAt → 过期标识 + 过期卷面不崩
//   38     AI 离线/stub 通道 → 结果或错误卡优雅降级
// 前置：npx vite build --config scripts/visual-harness/vite.config.ts
// 用法：node scripts/visual-harness/smoke-ui.mjs
// 退出码：0 = 全过；1 = 有失败（Edge 偶发断连时自动整轮重试一次）
// ============================================================
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../output/harness");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
if (!existsSync(join(ROOT, "index.html"))) {
  console.error("✗ 先构建 harness：npx vite build --config scripts/visual-harness/vite.config.ts");
  process.exit(1);
}
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
await new Promise((r) => server.listen(4202, r));
let browser = await chromium.launch({ executablePath: EDGE });

/** 单轮完整走查：新开 context（干净库），返回 { results, pageErrors } */
async function runSuite() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // 首次导航清库（种子兜底生效）；刷新保留（sessionStorage 标记防重复清）
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem("lv-cleared")) {
      localStorage.removeItem("lv-harness-storage");
      sessionStorage.setItem("lv-cleared", "1");
    }
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 120)));
  await page.goto("http://127.0.0.1:4202/");
  await page.waitForTimeout(900);

  const results = [];
  const record = (name, ok, note = "") => {
    results.push(ok);
    console.log(`${ok ? "✓" : "✗ FAIL"}  ${name}${note ? "  — " + note : ""}`);
  };
  const T = (txt, timeout = 4000) => page.locator(`#app button:has-text("${txt}")`).first().click({ timeout });
  const lastEvent = () =>
    page.evaluate(() => {
      const all = window.__app.attempts.all();
      return all[all.length - 1] ?? null;
    });
  // 作答兜底：数值框/多空框/选项/简答，能填哪个填哪个
  const answerSomehow = async (value) => {
    const num = page.locator("#app .lv-answer-num");
    if (await num.count()) {
      await num.first().fill(value, { timeout: 2000 });
      return true;
    }
    const blank = page.locator("#app .lv-answer-blank");
    if (await blank.count()) {
      await blank.first().fill(value, { timeout: 2000 });
      return true;
    }
    const opt = page.locator("#app button.lv-opt");
    if (await opt.count()) {
      await opt.first().click({ timeout: 2000 });
      return true;
    }
    const ta = page.locator("#app textarea.lv-textarea");
    if (await ta.count()) {
      await ta.first().fill(value, { timeout: 2000 });
      return true;
    }
    return false;
  };

  // ---------- 流程 36：作答信心 → attempts 事件 ----------
  try {
    await T("错题重练"); // 确定性入口：首题恒为数值题（.lv-answer-num 可填）
    await page.waitForTimeout(1000);
    await page.locator('#app button.lv-chip:has-text("确定")').first().click({ timeout: 3000 });
    await answerSomehow("999");
    await T("提交");
    await page.waitForTimeout(600);
    const ev = await lastEvent();
    record(
      "36 作答信心→流水",
      !!ev && ev.confidence === "sure" && ev.kind === "practice",
      ev ? `confidence=${ev.confidence} verdict=${ev.verdict}` : "无事件",
    );
    await T("下一题");
    await page.waitForTimeout(500);
  } catch (e) {
    record("36 作答信心→流水", false, String(e).slice(0, 90));
  }

  // ---------- 流程 63-03：改答轨迹（改答 → 原因追问 → 终答落事件） ----------
  try {
    const v2 = "222";
    await answerSomehow("111");
    await page.waitForTimeout(300);
    await answerSomehow(v2);
    await page.waitForTimeout(500);
    const reasonShown = await page.locator('#app :text("为什么改答")').count();
    const reasonBtn = page.locator('#app button:has-text("误触")');
    if (await reasonBtn.count()) await reasonBtn.first().click({ timeout: 2000 });
    await T("提交");
    await page.waitForTimeout(600);
    const ev = await lastEvent();
    record(
      "63-03 改答轨迹→终答",
      !!ev && String(ev.myAnswer ?? "").includes(v2),
      ev ? `追问=${reasonShown > 0} myAnswer=${JSON.stringify(ev.myAnswer).slice(0, 30)}` : "无事件",
    );
    await T("下一题");
    await page.waitForTimeout(500);
  } catch (e) {
    record("63-03 改答轨迹→终答", false, String(e).slice(0, 90));
  }

  // ---------- 流程 27：模考作答 → 刷新 → 恢复 ----------
  try {
    await page.evaluate(() => window.__show("mock"));
    await page.waitForTimeout(600);
    await T("开始模考");
    await page.waitForTimeout(1200);
    const before =
      (await page.locator("#app .lv-chip.num").allTextContents()).find((t) => /^\d+\/\d+$/.test(t.trim())) ?? "";
    await answerSomehow("A");
    await page.waitForTimeout(3600); // persistRun 3s 节流 + 落盘余量
    await page.reload();
    await page.waitForTimeout(1200);
    // 刷新后默认在练习台：切到模考场，MockTab 初始化时载入 run 快照并显示恢复卡
    await page.evaluate(() => window.__show("mock"));
    await page.waitForTimeout(1800);
    await page.locator('#app button:has-text("恢复考试")').first().click({ timeout: 6000 });
    await page.waitForTimeout(900);
    const after =
      (await page.locator("#app .lv-chip.num").allTextContents()).find((t) => /^\d+\/\d+$/.test(t.trim())) ?? "";
    record(
      "27 模考刷新恢复",
      progress(before) === progress(after) && !!progress(after),
      `刷新前后进度 ${before || "?"} → ${after || "?"}`,
    );
  } catch (e) {
    record("27 模考刷新恢复", false, String(e).slice(0, 90));
  }

  // ---------- 流程 40-06：纯键盘作答（A 选择 / → 导航；27 恢复后的卷面） ----------
  try {
    // 恢复后的游标由快照和题库顺序决定，当前题可能是选项题，也可能是填空/简答题。
    // 只在存在选项时断言字母选择；否则验证文本题控件存在并继续验证箭头导航。
    const optionCount = await page.locator("#app .lv-question .lv-opt").count();
    let keyboardNote = "";
    let keyboardSelectionOk = true;
    if (optionCount > 0) {
      const expectedKey = optionCount >= 2 ? "B" : "A";
      await page.keyboard.press(expectedKey.toLowerCase()); // A-J 选择：使用当前题存在的选项
      await page.waitForTimeout(400);
      const selKey = await page.locator("#app .lv-question .lv-opt.sel .key").first().textContent();
      keyboardSelectionOk = String(selKey).trim() === expectedKey;
      keyboardNote = `选项题键盘选中=${String(selKey).trim()}`;
    } else {
      const answerCount = await page.locator("#app .lv-question .lv-answer-num, #app .lv-question .lv-answer-blank, #app .lv-question textarea.lv-textarea").count();
      if (!answerCount) throw new Error(`恢复后的当前题没有可作答控件（options=${optionCount}）`);
      // 让 window keydown 的 target 离开输入框，验证文本题同样支持箭头切题。
      await page.locator("#app .lv-question").click({ position: { x: 20, y: 20 } });
      keyboardNote = `文本题控件=${answerCount}`;
    }
    await page.keyboard.press("ArrowRight"); // → 下一题
    await page.waitForTimeout(500);
    const prog =
      (await page.locator("#app .lv-chip.num").allTextContents()).find((t) => /^\d+\/\d+$/.test(t.trim())) ?? "";
    record(
      "40-06 键盘作答",
      keyboardSelectionOk && progress(prog) === "2/8",
      `${keyboardNote} · → 后进度=${progress(prog) || "?"}`,
    );
  } catch (e) {
    record("40-06 键盘作答", false, String(e).slice(0, 90));
  }

  // ---------- 流程 28：过期恢复（改写持久化快照的 startedAt） ----------
  try {
    await page.reload();
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__show("mock"));
    await page.waitForTimeout(1800);
    const shifted = await page.evaluate(() => {
      const LS = "lv-harness-storage";
      const store = JSON.parse(localStorage.getItem(LS) ?? "{}");
      const run = store["mock/run"];
      if (!run || !run.startedAt) return false;
      run.startedAt = Date.now() - 61 * 60_000;
      store["mock/run"] = run;
      localStorage.setItem(LS, JSON.stringify(store));
      return true;
    });
    if (!shifted) throw new Error("mock/run 快照不在持久化存储");
    await page.reload();
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__show("mock"));
    await page.waitForTimeout(1800);
    const expiredChip = await page.locator("#app .lv-chip--red").count();
    const zeroLeft = await page.locator('#app :text("0 min")').count();
    record("28 过期恢复标识", expiredChip > 0 || zeroLeft > 0, `红色过期 chip=${expiredChip} · 0 min 提示=${zeroLeft}`);
    await page.locator('#app button:has-text("恢复考试")').first().click({ timeout: 5000 });
    await page.waitForTimeout(900);
    const alive = await page.locator("#app .lv-question, #app .lv-stem, #app .lv-chip").count();
    record("28 过期恢复不崩", alive > 0, `过期卷面元素=${alive}`);
  } catch (e) {
    record("28 过期恢复", false, String(e).slice(0, 90));
  }

  // ---------- 流程 38：AI stub 通道 → 结果卡优雅呈现 ----------
  try {
    await page.evaluate(() => window.__show("report"));
    await page.waitForTimeout(1200);
    await page.locator('#app button:has-text("AI 解读")').first().click({ timeout: 4000 });
    await page.waitForTimeout(3000);
    const graceful = await page.evaluate(() => ({
      errorCard: document.querySelectorAll("#app .lv-error").length,
      explainCard: [...document.querySelectorAll("#app .lv-card")].some((c) => c.textContent.includes("解读")),
    }));
    record(
      "38 AI 通道优雅降级",
      graceful.errorCard > 0 || graceful.explainCard,
      `错误卡=${graceful.errorCard} · 结果卡=${graceful.explainCard}`,
    );
  } catch (e) {
    record("38 AI 通道优雅降级", false, String(e).slice(0, 90));
  }

  await ctx.close();
  return { results, pageErrors };
}

const progress = (t) => (t || "").trim();

let { results, pageErrors } = await runSuite();
if (results.some((r) => !r) || pageErrors.length) {
  console.log("\n… 存在失败/异常：Edge 偶发断连常见——重启浏览器整轮重试一次");
  try {
    await browser.close();
  } catch {
    /* 已死 */
  }
  browser = await chromium.launch({ executablePath: EDGE });
  const retry = await runSuite();
  results = retry.results;
  pageErrors = retry.pageErrors;
}

await browser.close();
server.close();
if (pageErrors.length) {
  console.log("\n✗ 未捕获异常（pageerror）：");
  pageErrors.forEach((e) => console.log("   " + e));
  results.push(false);
}
const fail = results.filter((r) => !r).length;
console.log(`\n========== UI 流走查：${results.length - fail}/${results.length} 通过 ==========`);
process.exit(fail ? 1 : 0);
