// 本轮用户截图问题回归：无库导航、示例库、题型控件、逐题草稿和报告侧栏。
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { launchHarnessBrowser } from "./browser.mjs";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../../output/harness");
const server = createServer((req, res) => {
  const path = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    const body = readFileSync(join(root, path));
    res.writeHead(200, {
      "Content-Type":
        { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[extname(path)] ??
        "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(4203, "127.0.0.1", resolve));
let browser;
let page;
const errors = [];
try {
  browser = await launchHarnessBrowser();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(8000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:4203/?scenario=empty");
  const click = (text) => page.getByRole("button", { name: text, exact: true }).first().click();
  await page.locator("#bar [data-tab=mock]").click();
  await page.getByRole("button", { name: "去练习台建库或导题", exact: true }).click();
  await page.getByRole("button", { name: "创建示例题库（12 题）", exact: true }).waitFor();
  console.log("✓ 无库模考入口返回练习台");
  await click("创建示例题库（12 题）");
  await page.getByText("示例题库已就绪，共 12 题", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__app.attempts.all().length), 0);
  assert.equal(await page.evaluate(() => window.__app.listBanks().length), 1);
  const weekCard = page.locator(".lv-entry-week");
  await weekCard.waitFor();
  assert.equal(await weekCard.locator(".lv-week-day").count(), 7);
  assert.match(await weekCard.innerText(), /近七天还没有作答记录/);
  await page.screenshot({
    path: resolve(import.meta.dirname, "../../output/r54-real-practice-week-empty.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: resolve(import.meta.dirname, "../../output/r54-real-first-run-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log("✓ 一键创建12题，无预置作答记录");
  console.log("✓ 今日页近七天节奏卡有七个自然日，并明确显示真实空记录状态");

  await page.evaluate(async () => {
    const bank = window.__app.listBanks()[0];
    const qs = await window.__app.listQuestions(bank.id);
    const pick = (prefix) => qs.find((q) => q.stem.startsWith(prefix));
    window.__plugin.pendingPractice = [
      pick("【单选示例】将"),
      pick("【填空示例】"),
      pick("【简答示例】"),
      pick("【判断示例】计算"),
      pick("【多选示例】一道"),
      pick("【数值填空示例】"),
      pick("【多空填空示例】"),
    ];
    window.__plugin.pendingPracticeBankId = bank.id;
    window.__show("practice");
  });
  const submit = () => click("提交");
  const next = () =>
    page
      .locator(".lv-question button")
      .filter({ hasText: /^下一题/ })
      .click();
  const opts = page.locator(".lv-question .lv-opt");
  await opts.first().waitFor();
  assert.equal(await opts.count(), 4);
  assert.equal(await page.locator(".lv-question textarea").count(), 0);
  assert.equal(await page.locator(".lv-stem").innerText(), "【单选示例】将 3.14159 四舍五入，保留两位小数，结果是？");
  await page.screenshot({
    path: resolve(import.meta.dirname, "../../output/sample-question-ui.png"),
    fullPage: true,
    animations: "disabled",
  });
  await opts.first().click();
  await submit();
  await next();
  console.log("✓ 单选选项完整，题干未泄露解析");

  await page.locator(".lv-question textarea").fill("基期值");
  await page.locator(".lv-question textarea").fill("");
  assert.equal(await page.getByRole("button", { name: "提交", exact: true }).isDisabled(), true);
  await page.locator(".lv-question textarea").fill("基期值");
  await submit();
  await next();
  assert.equal(await page.locator(".lv-question textarea").inputValue(), "");
  assert.equal(await page.getByRole("button", { name: "提交", exact: true }).isDisabled(), true);
  await page.locator(".lv-question textarea").fill("主动回忆并定位错因");
  await submit();
  await page.getByText("参考答案", { exact: true }).waitFor();
  await next();
  console.log("✓ 切题草稿清空，简答显示参考答案与自评说明");

  assert.equal(await opts.count(), 2);
  await opts.first().click();
  await submit();
  assert.match(await page.locator(".lv-feedback").innerText(), /回答正确/);
  await next();
  await page.keyboard.press("A");
  await page.keyboard.press("B");
  await page.keyboard.press("D");
  assert.equal(await page.locator(".lv-opt.sel").count(), 3);
  await submit();
  assert.match(await page.locator(".lv-feedback").innerText(), /回答正确/);
  await next();
  console.log("✓ 判断对错判分、多选键盘切换正确");

  await page.locator(".lv-answer-num").fill("5");
  await submit();
  await next();
  const blanks = page.locator(".lv-answer-blank");
  assert.equal(await blanks.count(), 2);
  await page.screenshot({
    path: resolve(import.meta.dirname, "../../output/sample-blanks-ui.png"),
    fullPage: true,
    animations: "disabled",
  });
  await blanks.nth(0).fill("80");
  await blanks.nth(0).fill("");
  assert.equal(await page.getByRole("button", { name: "提交", exact: true }).isDisabled(), true);
  await blanks.nth(0).fill("80");
  await blanks.nth(1).fill("100");
  await submit();
  await next();
  await page.getByText("本组完成", { exact: true }).waitFor();
  console.log("✓ 数值和多空填空正确读回、输入与判分");
  await page.evaluate(() => window.__show("practice"));
  await page.locator(".lv-entry-week").waitFor();
  assert.equal(await page.locator(".lv-onboard").count(), 0, "first-use guide should auto-dismiss after the first saved answer");
  assert.equal(await page.locator(".lv-entry-week .lv-week-day").count(), 7);
  const weekCountText = await page.locator(".lv-entry-week .lv-chip.num").innerText();
  assert.ok(Number.parseInt(weekCountText, 10) > 0, "week chart should reflect newly saved practice events");
  assert.doesNotMatch(await page.locator(".lv-entry-week").innerText(), /近七天还没有作答记录/);
  console.log("✓ 练习完成后今日周节奏从真实流水更新，不使用固定样例值");
  const weekCountBeforePaper = Number.parseInt(weekCountText, 10);
  await page.locator(".lv-rail-nav").getByRole("button", { name: "题库", exact: true }).click();
  await page.locator(".lv-qrow-head").first().waitFor();
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "纸笔回录", exact: true }).click();
  await page.locator(".lv-card textarea.lv-textarea").last().fill("1=A");
  await page.getByRole("button", { name: "写入 1 条流水", exact: true }).click();
  await page.getByText(/已回录 1 条纸笔作答/).waitFor();
  await page.locator(".lv-rail-nav").getByRole("button", { name: "今日", exact: true }).click();
  await page.locator(".lv-entry-week").waitFor();
  const weekCountAfterPaper = Number.parseInt(await page.locator(".lv-entry-week .lv-chip.num").innerText(), 10);
  assert.equal(weekCountAfterPaper, weekCountBeforePaper + 1, "paper recall should invalidate and refresh the derived week total");
  await page.screenshot({
    path: resolve(import.meta.dirname, "../../output/r54-real-practice-week-populated.png"),
    fullPage: true,
    animations: "disabled",
  });
  console.log("✓ 纸笔回录成功后今日周节奏立即刷新");

  const productionWidths = [1280, 1024, 1023, 961, 960, 821, 820, 761, 760, 721, 720, 601, 600, 481, 480, 390];
  const assertNoOverflowAtProductionWidths = async (view) => {
    for (const width of productionWidths) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(40);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
        `${view} ${width}px overflow`,
      );
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  };
  await assertNoOverflowAtProductionWidths("practice");
  console.log(`✓ 练习台在 ${productionWidths.length} 个生产断点边缘无横向溢出`);

  await page.locator("#bar [data-tab=report]").click();
  const reportTabs = page.locator(".lv-report-tabs");
  const resetReportScroll = () =>
    page.evaluate(() => {
      document.scrollingElement?.scrollTo(0, 0);
      document.querySelectorAll(".lv-pad").forEach((node) => {
        node.scrollTop = 0;
      });
    });
  await reportTabs.getByRole("button", { name: "概览", exact: true }).waitFor();
  assert.equal(await page.locator(".lv-kpis").isVisible(), true);
  assert.match(await page.locator(".lv-report-week-scope").innerText(), /按自然周比较本周与上周，不受上方日期范围筛选影响/);
  console.log("✓ 周对比明确说明使用本周/上周自然周口径，不随日期筛选变化");
  const overviewGrid = page.locator(".lv-report-overview-grid.has-both");
  if (await overviewGrid.count()) {
    const cards = overviewGrid.locator(":scope > .lv-card");
    assert.equal(await cards.count(), 2);
    const desktopBoxes = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
    assert.ok(desktopBoxes[1].x > desktopBoxes[0].x, "desktop report action and weekly comparison should be side by side");
    await page.setViewportSize({ width: 960, height: 900 });
    const narrowBoxes = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
    assert.ok(narrowBoxes[1].y > narrowBoxes[0].y, "report overview cards should stack at the compact breakpoint");
    await page.setViewportSize({ width: 1440, height: 1000 });
    console.log("✓ 复盘下一步与周对比在宽屏并排、窄屏堆叠");
  }
  assert.match(await page.locator(".lv-daily-report-scope").innerText(), /当前题库今日作答.*上方日期筛选无关/);
  console.log("✓ 今日战报写入范围不再只依赖悬停提示");
  await reportTabs.getByRole("button", { name: "考点与错题", exact: true }).click();
  assert.equal(
    await reportTabs.getByRole("button", { name: "考点与错题", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await page.locator(".lv-kpis").isVisible(), false);
  assert.ok((await page.locator(".lv-card.lv-section:not(.lv-report-section--hidden)").count()) > 0);
  await page.getByText("考点掌握度（正确率 × 留存衰减）", { exact: true }).waitFor();
  await resetReportScroll();
  await page.screenshot({
    path: resolve(import.meta.dirname, "../../output/r54-real-report-knowledge.png"),
    fullPage: true,
    animations: "disabled",
  });
  await reportTabs.getByRole("button", { name: "记录与证据", exact: true }).click();
  assert.equal(
    await reportTabs.getByRole("button", { name: "记录与证据", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  assert.ok((await page.locator(".lv-card.lv-section:not(.lv-report-section--hidden)").count()) > 0);
  await resetReportScroll();
  await page.screenshot({
    path: resolve(import.meta.dirname, "../../output/r54-real-report-evidence.png"),
    fullPage: true,
    animations: "disabled",
  });
  const storageButton = page.getByRole("button", { name: /存储占用/ });
  await page.evaluate(() => {
    window.__originalStorageUsage = window.__app.storageUsage.bind(window.__app);
    window.__app.storageUsage = async () => { throw new Error("模拟存储读取失败"); };
  });
  await storageButton.click();
  const storageError = page.locator(".lv-error[role=alert]").filter({ hasText: "模拟存储读取失败" });
  await storageError.waitFor();
  await page.evaluate(() => { window.__app.storageUsage = window.__originalStorageUsage; });
  await storageError.getByRole("button", { name: "重试", exact: true }).click();
  await page.locator('.lv-chip[title="banks"]').waitFor();
  console.log("✓ 存储占用失败显示可读错误，重试后恢复数据列表");

  const auditButton = page.getByRole("button", { name: "数据体检（只读）", exact: true });
  await page.evaluate(() => {
    window.__originalListQuestions = window.__app.listQuestions.bind(window.__app);
    window.__app.listQuestions = async () => { throw new Error("模拟题库读取失败"); };
  });
  await auditButton.click();
  const auditPartial = page.locator(".lv-error[role=alert]").filter({ hasText: "本次体检结果不完整" });
  await auditPartial.waitFor();
  await page.evaluate(() => { window.__app.listQuestions = window.__originalListQuestions; });
  await auditPartial.getByRole("button", { name: "重试", exact: true }).click();
  await page.getByText(/流水 \d+ 事件/).waitFor();
  assert.equal(await page.locator(".lv-error[role=alert]").filter({ hasText: "本次体检结果不完整" }).count(), 0);
  console.log("✓ 数据体检将部分题库读取失败标记为不完整，并可重试恢复");

  await storageButton.click();
  await assertNoOverflowAtProductionWidths("report-evidence");
  await reportTabs.getByRole("button", { name: "概览", exact: true }).click();
  await resetReportScroll();
  await page.screenshot({
    path: resolve(import.meta.dirname, "../../output/r54-real-report-overview.png"),
    fullPage: true,
    animations: "disabled",
  });
  await assertNoOverflowAtProductionWidths("report-overview");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    "report section controls must not overflow on mobile",
  );
  await resetReportScroll();
  await page.screenshot({
    path: resolve(import.meta.dirname, "../../output/r54-real-report-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await reportTabs.getByRole("button", { name: "考点与错题", exact: true }).click();
  const weakTopicButton = page.getByRole("button", { name: "查看对应题目", exact: true }).first();
  await weakTopicButton.waitFor();
  const weakTopic = (await weakTopicButton.locator("xpath=..").locator("span").nth(1).innerText()).trim();
  await weakTopicButton.click();
  const browseSearch = page.locator('input[placeholder="搜索题干/选项/解析…"]');
  await browseSearch.waitFor();
  assert.equal(await browseSearch.inputValue(), weakTopic, "report topic drill should open the question bank with its topic search");
  assert.ok((await page.locator(".lv-qrow-head").count()) > 0, "report topic drill should show matching questions before starting practice");
  console.log("✓ 报告薄弱考点先进入当前题库并筛选对应题目");
  await page.locator("#bar [data-tab=report]").click();
  await page.locator(".lv-report-tabs").getByRole("button", { name: "考点与错题", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await reportTabs.getByRole("button", { name: "记录与证据", exact: true }).click();
  await page.locator(".lv-rail-nav").getByRole("button", { name: "模考", exact: true }).click();
  await page.getByRole("button", { name: "开始模考", exact: true }).waitFor();
  await assertNoOverflowAtProductionWidths("mock-config");
  await page.locator(".lv-rail-nav").getByRole("button", { name: "今日", exact: true }).click();
  await page.getByRole("button", { name: "示例题库", exact: true }).waitFor();
  console.log("✓ 复盘页侧栏可通过五项任务导航切换模考与今日练习");

  await page.locator("#bar [data-tab=mock]").click();
  await click("开始模考");
  const examStem = await page.locator(".lv-stem").innerText();
  await page.evaluate(() => {
    const app = window.__app;
    window.__sampleBankId = app.listBanks()[0].id;
    const listBanks = app.listBanks.bind(app);
    app.listBanks = () => [
      ...listBanks(),
      { id: "20260101000000-hhseedbk", name: "联动测试库", createdAt: Date.now() },
    ];
    window.__bankReads = [];
    const listQuestions = app.listQuestions.bind(app);
    app.listQuestions = (id) => {
      window.__bankReads.push(id);
      return listQuestions(id);
    };
    app.writeScoreDoc = async (id) => {
      window.__scoreBankId = id;
    };
    window.__changeBank("20260101000000-hhseedbk");
  });
  assert.equal(await page.locator(".lv-stem").innerText(), examStem);
  assert.equal(await page.locator(".lv-crumb").innerText(), "【示例】基础学习题库");
  assert.deepEqual(await page.evaluate(() => window.__bankReads), []);
  await click("交卷");
  await page.locator("#confirmDialogConfirmBtn").click();
  await page.getByRole("button", { name: "再考一套", exact: true }).waitFor();
  await page.evaluate(() => window.__changeBank("20260101000000-hhseedbk"));
  await click("写入题库导出文档");
  await page.waitForFunction(() => window.__scoreBankId === window.__sampleBankId);
  assert.equal(await page.locator(".lv-crumb").innerText(), "【示例】基础学习题库");
  await click("再考一套");
  await page.getByRole("button", { name: "开始模考", exact: true }).waitFor();
  assert.equal(await page.locator(".lv-crumb").innerText(), "联动测试库");
  assert.ok((await page.evaluate(() => window.__bankReads)).includes("20260101000000-hhseedbk"));
  console.log("✓ 模考换库保留旧卷面和成绩写入目标，返回配置后读取新库");
  assert.deepEqual(errors, []);
  console.log("✓ 浏览器无未捕获错误");
} catch (e) {
  console.error("页面异常:", errors);
  if (page) console.error((await page.locator("#app").innerText()).slice(-1800));
  throw e;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
