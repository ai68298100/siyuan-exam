// R54 原型状态演练：页面专属状态映射、错误恢复、禁用反馈与窄屏溢出。
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { launchHarnessBrowser } from "./browser.mjs";

const root = resolve(import.meta.dirname, "../../design/prototype-r54");
const server = createServer((req, res) => {
  const requested = req.url.split("?")[0];
  const path = requested === "/" ? "/index.html" : requested;
  try {
    const body = readFileSync(join(root, path));
    res.writeHead(200, {
      "Content-Type":
        { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" }[
          extname(path)
        ] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolveListen) => server.listen(4204, "127.0.0.1", resolveListen));
let browser;
const errors = [];
try {
  browser = await launchHarnessBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(7000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4204/?test=1");
  const state = async (value) => page.locator("#state-picker").selectOption(value);

  assert.equal(await page.locator(".first-run-step").count(), 3);
  assert.equal(await page.locator("ol.first-run-steps > li.first-run-step").count(), 3, "onboarding steps should have ordered-list semantics");
  assert.match(await page.locator(".first-run").innerText(), /首条作答记录后会自动消失/);
  await page.screenshot({ path: resolve(import.meta.dirname, "../../output/r54-prototype-first-run.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "first-run guide should fit the prototype mobile viewport");
  await page.screenshot({ path: resolve(import.meta.dirname, "../../output/r54-prototype-first-run-mobile.png"), fullPage: true, animations: "disabled" });
  for (const height of [844, 640]) {
    for (const target of ["report", "skip"]) {
      const mobilePage = await browser.newPage({ viewport: { width: 390, height } });
      await mobilePage.goto("http://127.0.0.1:4204/?test=1");
      const action = target === "report"
        ? { locator: mobilePage.locator(".first-run-step").nth(2).getByRole("button", { name: "打开报告" }), label: "第 3 步入口" }
        : { locator: mobilePage.getByRole("button", { name: "跳过引导" }), label: "跳过引导" };
      await action.locator.focus();
      const geometry = await action.locator.evaluate((button) => {
        const main = document.querySelector("#screen").getBoundingClientRect();
        const nav = document.querySelector("#mobile-nav").getBoundingClientRect();
        const rect = button.getBoundingClientRect();
        return {
          focused: button === document.activeElement,
          scrollTop: document.querySelector("#screen").scrollTop,
          buttonTop: rect.top,
          buttonBottom: rect.bottom,
          mainTop: main.top,
          mainBottom: main.bottom,
          navTop: nav.top,
          navBottom: nav.bottom,
          navVisible: getComputedStyle(document.querySelector("#mobile-nav")).display !== "none",
        };
      });
      assert.equal(geometry.focused, true, `${action.label} should receive keyboard focus at 390x${height}`);
      assert.equal(geometry.navVisible, true, `mobile task navigation should remain visible at 390x${height}`);
      assert.ok(geometry.scrollTop > 0, `${action.label} should be reachable by scrolling the content at 390x${height}: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.buttonTop >= geometry.mainTop, `${action.label} should not be clipped above the content viewport at 390x${height}: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.buttonBottom <= geometry.mainBottom + 1, `${action.label} should not be clipped by the bottom navigation at 390x${height}: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.buttonBottom <= geometry.navTop + 1, `${action.label} should not be covered by the bottom navigation at 390x${height}: ${JSON.stringify(geometry)}`);
      await action.locator.click();
      if (target === "report") {
        await mobilePage.getByRole("heading", { name: "看清下一步，练习才有方向。" }).waitFor();
      } else {
        assert.equal(await mobilePage.locator(".first-run").count(), 0);
        assert.equal(await mobilePage.locator("#screen").evaluate((el) => el === document.activeElement), true, "dismissing the guide should move focus to the remaining page content");
      }
      await mobilePage.close();
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const skipPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await skipPage.goto("http://127.0.0.1:4204/?test=1");
  await skipPage.getByRole("button", { name: "跳过引导" }).click();
  assert.equal(await skipPage.locator(".first-run").count(), 0);
  await skipPage.close();
  console.log("✓ 首次进入引导显示三步；390x844/640 下第 3 步与跳过入口可滚动、聚焦、点击且不被底栏遮挡；跳过后焦点落在主内容；首答后自动隐藏");

  await state("practice-loading");
  assert.equal(await page.locator("#screen [aria-busy='true']").count(), 1);
  assert.match(await page.locator("#screen").innerText(), /正在读取当前题库/);
  await state("practice-empty");
  assert.match(await page.locator("#screen").innerText(), /还没有可练习题/);
  await page.getByRole("button", { name: "体验示例题库" }).click();
  assert.equal(await page.locator("#screen .study-face").count(), 1);
  console.log("✓ 练习题库加载与空态入口可达并能开始示例练习");

  await state("practice-load-error");
  await page.getByRole("button", { name: "重试读取" }).click();
  assert.equal(await page.locator("#screen [aria-busy='true']").count(), 1);
  assert.equal(await page.locator("#screen [data-action='retry-practice-load']").isDisabled(), true);
  await page.getByText("演示题库读取成功。").waitFor();
  console.log("✓ 练习读取失败可重试，重试中反馈加载态并锁定重复点击");

  await state("ready");
  await page.locator("#page-picker").selectOption("today");
  assert.equal(await page.locator(".week-card").isVisible(), true);
  assert.equal(await page.locator(".week-day").count(), 7);
  await state("today-no-attempts");
  assert.match(await page.locator(".week-card").innerText(), /近七天还没有作答记录/);
  assert.equal(await page.locator(".week-day").count(), 7);
  await state("ready");
  assert.match(await page.locator(".week-card").innerText(), /合成样例|合成示例/);
  await page.screenshot({ path: resolve(import.meta.dirname, "../../output/r54-prototype-today-week.png"), fullPage: true, animations: "disabled" });
  for (const width of [960, 900, 759, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.locator(".week-card").isVisible(), true, `week rhythm should remain visible at ${width}px`);
    assert.equal(await page.locator(".week-day").count(), 7, `week rhythm should keep seven days at ${width}px`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `today ${width}px overflow`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(import.meta.dirname, "../../output/r54-prototype-today-week-mobile.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log("✓ 今日周节奏示例/空记录两态和 960/900/759/390px 堆叠布局一致");

  await state("materials-empty");
  assert.match(await page.locator("#screen").innerText(), /还没有学习资料/);
  assert.equal(await page.locator("#screen [data-page='materials']").count(), 0);
  console.log("✓ 资料空态自动进入资料页并提供导入入口");

  await state("materials-no-match");
  assert.match(await page.locator("#screen").innerText(), /没有匹配的资料/);
  await page.getByRole("button", { name: "清除搜索" }).click();
  assert.equal(await page.locator(".material-list button").count(), 2);
  console.log("✓ 资料无匹配可恢复到列表");

  await state("materials-saving");
  assert.equal(await page.locator("#material-note").isDisabled(), true);
  assert.equal(await page.locator(".material-list button").first().isDisabled(), true);
  await state("materials-error");
  await page.locator("#material-note").fill("保留失败草稿");
  await page.getByRole("button", { name: "保存笔记预览" }).click();
  await page.getByRole("button", { name: "重试保存" }).waitFor();
  assert.equal(await page.locator("#material-note").inputValue(), "保留失败草稿");
  await page.getByRole("button", { name: "重试保存" }).click();
  await page.getByText("保存笔记预览", { exact: true }).waitFor();
  assert.equal(await page.locator("#material-note").inputValue(), "保留失败草稿");
  console.log("✓ 资料保存加载锁定、失败保留输入、重试反馈正确");

  await state("mock-invalid");
  assert.match(await page.locator("#mock-validation").innerText(), /题量不足/);
  assert.equal(await page.locator('[data-action="start-mock"]').isDisabled(), true);
  console.log("✓ 模考自动判分题量不足时禁用开考");

  await state("mock-loading");
  assert.equal(await page.locator("#screen [aria-busy='true']").count(), 1);
  assert.equal(await page.locator("#screen [data-action='start-mock']").count(), 0);
  await state("mock-load-error");
  const mockRetry = page.getByRole("button", { name: "重试读取" });
  if ((await mockRetry.count()) !== 1) {
    throw new Error(`模考读取失败态未显示唯一重试按钮 state=${await page.locator("#state-picker").inputValue()} scene=${await page.evaluate(() => location.hash)}：${await page.locator("#screen").innerText()}`);
  }
  await mockRetry.evaluate((button) => button.click());
  await page.locator("#mock-count").waitFor();
  await state("mock-empty-bank");
  assert.match(await page.locator("#screen").innerText(), /还没有可用于模考的题目/);
  await page.getByRole("button", { name: "体验示例题库模考" }).click();
  assert.equal(await page.locator("#screen .study-face").count(), 1);
  await state("mock-blueprint-invalid");
  assert.match(await page.locator("#screen").innerText(), /题型配额不足/);
  await page.getByRole("button", { name: "退出错误态预览" }).click();
  assert.match(await page.locator("#screen").innerText(), /本次配卷/);
  console.log("✓ 模考加载、失败重试、空题库、蓝图配额不足均有可观察反馈和恢复入口");

  await state("mock-submit-error");
  assert.match(await page.locator("#screen").innerText(), /成绩暂未保存/);
  assert.equal(await page.locator("#session-answer").count(), 0);
  await page.locator('[data-action="retry-mock-submit"]').evaluate((button) => button.click());
  await page.getByRole("button", { name: "确认重试" }).click();
  await page.getByRole("heading", { name: "这一小步，已经完成。" }).waitFor();
  console.log("✓ 模考失败保留场次，重试后明确进入结果");

  await state("report-loading");
  assert.equal(await page.locator(".report-state[aria-busy='true']").count(), 1);
  await state("report-error");
  assert.equal(await page.locator(".report-state[role='alert']").count(), 1);
  await page.getByRole("button", { name: "重试读取" }).click();
  assert.equal(await page.locator(".report-state").count(), 0);
  await state("scope-loading");
  assert.equal(await page.locator(".report-state[aria-busy='true']").count(), 1);
  await state("scope-error");
  assert.equal(await page.getByRole("button", { name: "重试读取范围" }).count(), 1);
  await page.getByRole("button", { name: "重试读取范围" }).click();
  console.log("✓ 复盘整页读取与题库范围加载/错误状态可恢复");

  await state("report-no-attempts");
  assert.match(await page.locator(".report-state").innerText(), /当前范围还没有作答/);
  await state("report-no-evidence");
  assert.match(await page.locator(".report-state").innerText(), /还没有学习记录/);
  await state("report-no-bank");
  assert.match(await page.locator(".report-state").innerText(), /还没有题库/);
  console.log("✓ 复盘空题库、零作答、零证据提供分离的说明与行动");

  await state("ready");
  await page.locator("#page-picker").selectOption("report");
  const reportScope = await page.locator("#screen .page-head").innerText();
  assert.match(reportScope, /作答统计按日期范围覆盖全部题库/);
  assert.match(reportScope, /考点掌握与薄弱项按当前题库累计历史/);
  assert.match(reportScope, /热力图、连胜与消灭错题按全局状态统计/);
  await page.getByRole("button", { name: "说明数据口径" }).click();
  assert.match(await page.locator("#dialog").innerText(), /作答统计 · 日期范围[\s\S]*按上方选择的日期统计，覆盖全部题库/);
  await page.getByRole("button", { name: "关闭弹层" }).click();
  await page.getByRole("button", { name: "预览今日战报范围" }).click();
  assert.match(await page.locator("#dialog").innerText(), /当前示例题库今天的作答记录/);
  assert.match(await page.locator("#dialog").innerText(), /只预览口径，不创建或修改笔记/);
  await page.getByRole("button", { name: "关闭弹层" }).click();
  await page.getByRole("button", { name: "记录与证据", exact: true }).click();
  assert.match(await page.locator("#screen").innerText(), /数据与存储检查[\s\S]*全部结果均为内存样例/);
  await page.getByRole("button", { name: "查看占用" }).click();
  assert.equal(await page.locator(".report-operation-state[aria-busy='true']").count(), 1, "storage should visibly enter loading");
  assert.equal(await page.locator('[data-action="report-storage-toggle"]').isDisabled(), true, "storage toggle should lock duplicate loads");
  await page.getByText("演练存储占用已读取").waitFor();
  assert.match(await page.locator(".report-storage-rows").innerText(), /questions[\s\S]*attempts/);
  await state("report-storage-empty");
  assert.match(await page.locator(".report-operation-empty").innerText(), /没有可显示的存储记录[\s\S]*与读取失败不同/);
  assert.equal(await page.getByRole("button", { name: "重新读取" }).count(), 1);
  await state("report-storage-error");
  assert.equal(await page.getByRole("alert").filter({ hasText: "存储占用读取失败" }).count(), 1);
  await page.getByRole("button", { name: "重试读取" }).click();
  assert.equal(await page.locator(".report-operation-state[aria-busy='true']").count(), 1);
  assert.equal(await page.locator('[data-action="report-storage-retry"]').count(), 0, "retry should be unavailable while loading");
  assert.equal(await page.locator('[data-action="report-storage-toggle"]').isDisabled(), true);
  await page.getByText("演练存储占用已读取").waitFor();

  await state("report-audit-partial");
  assert.match(await page.locator(".report-operation-partial").innerText(), /部分完成，结果不完整[\s\S]*读取失败/);
  assert.match(await page.locator(".report-operation-partial").innerText(), /132 条流水/);
  await page.getByRole("button", { name: "重试体检" }).click();
  assert.equal(await page.locator(".report-operation-state[aria-busy='true']").count(), 1);
  assert.equal(await page.locator('[data-action="report-audit-retry"]').count(), 0, "audit retry should be unavailable while loading");
  assert.equal(await page.locator('[data-action="report-audit-run"]').isDisabled(), true);
  await page.getByText("演练体检完成：没有发现示例问题").waitFor();
  await state("report-audit-error");
  assert.match(await page.getByRole("alert").filter({ hasText: "数据体检失败" }).innerText(), /读取超时/);
  await page.getByRole("button", { name: "重试体检" }).click();
  await page.locator(".report-operation-state").filter({ hasText: "示例数据看起来正常" }).waitFor();
  assert.match(await page.locator(".report-operation-state").innerText(), /示例数据看起来正常/);
  await state("report-audit-loading");
  assert.equal(await page.locator(".report-operation-state[aria-busy='true']").count(), 1);
  await page.locator("#page-picker").selectOption("today");
  await page.waitForTimeout(700);
  await page.locator("#page-picker").selectOption("report");
  await page.getByRole("button", { name: "记录与证据", exact: true }).click();
  assert.equal(await page.locator(".report-operation-state[aria-busy='true']").count(), 0, "leaving during an audit must cancel the pending result");
  assert.equal(await page.locator('[data-action="report-audit-run"]').count(), 1, "returning to the report should allow a fresh audit");
  console.log("✓ 复盘范围口径、存储加载/成功/空/失败重试、体检部分成功/失败重试及忙碌锁均可观察");

  const autoCount = await page.evaluate(() => window.__r54Test.eligibleMockCount);
  await page.evaluate(() => window.__r54Test.addMaterialQuestion());
  await page.locator("#page-picker").selectOption("mocksetup");
  assert.match(await page.locator("#mock-eligibility").innerText(), new RegExp(`当前可用于模考 ${autoCount} 道`));
  assert.equal(await page.locator("#mock-count").getAttribute("max"), String(autoCount));
  await page.getByRole("button", { name: "生成试卷并开始" }).click();
  assert.equal(await page.locator(".study-face h2").filter({ hasText: "资料题不应进入自动判分模考" }).count(), 0);
  console.log("✓ 资料题不计入模考可用量，也不会混入自动判分试卷");

  await page.locator("#width-toggle").click();
  const navTrigger = page.locator("#nav-trigger");
  assert.equal(await navTrigger.isVisible(), true);
  assert.equal(await navTrigger.getAttribute("aria-expanded"), "false");
  await navTrigger.click();
  assert.equal(await navTrigger.getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator("#sidebar[role='dialog'][aria-modal='true']").count(), 1);
  assert.equal(await page.locator("#workspace[inert][aria-hidden='true']").count(), 1);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  assert.equal(
    await page.locator("#sidebar .nav-drawer-close").evaluate((el) => el === document.activeElement),
    true,
    `drawer focus did not wrap to close button; active=${await page.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`)}`,
  );
  await page.keyboard.press("Escape");
  assert.equal(await navTrigger.getAttribute("aria-expanded"), "false");
  assert.equal(await navTrigger.evaluate((el) => el === document.activeElement), true);
  await navTrigger.click();
  await page.locator("#nav-backdrop").click({ position: { x: 350, y: 300 } });
  assert.equal(await navTrigger.getAttribute("aria-expanded"), "false");
  await navTrigger.click();
  await page.locator("#sidebar [data-page='bank']").click();
  await page.getByRole("heading", { name: "让每道题，都有来处。" }).waitFor();
  assert.equal(await navTrigger.getAttribute("aria-expanded"), "false");
  await navTrigger.click();
  await page.locator("#width-toggle").click();
  await page.locator("#sidebar.open").waitFor({ state: "hidden" });
  assert.equal(await navTrigger.getAttribute("aria-expanded"), "false");
  assert.equal(
    await page.locator("#screen").evaluate((el) => el === document.activeElement),
    true,
    "auto-closed drawer should move focus to visible page content instead of the hidden trigger",
  );
  console.log("✓ R54 窄屏抽屉支持状态读屏、焦点循环、Esc、遮罩关闭、导航后收起和放宽视口焦点落点");

  const responsiveWidths = [
    359, 360, 390, 407, 408, 807, 808, 850, 851, 948, 949, 960, 961, 1023, 1024, 1167, 1168, 1510,
  ];
  for (const width of responsiveWidths) {
    await page.setViewportSize({ width, height: 844 });
    for (const scene of [
      "practice-empty",
      "materials-error",
      "mock-empty-bank",
      "mock-load-error",
      "mock-blueprint-invalid",
      "report-error",
      "report-no-evidence",
      "report-storage-loading",
      "report-storage-empty",
      "report-storage-error",
      "report-audit-loading",
      "report-audit-partial",
      "report-audit-error",
    ]) {
      await state(scene);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        `${scene} ${width}px overflow`,
      );
    }
  }
  console.log(`✓ 页面专属空/错误状态在 ${responsiveWidths.length} 个原型断点边缘无横向溢出`);
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  server.close();
}
