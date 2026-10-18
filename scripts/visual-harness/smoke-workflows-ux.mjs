// 练习台流程 UX 回归：真实 Svelte UI + 有界 IO 桩，不依赖真实 AI/思源服务器。
// 前置：pnpm exec vite build --config scripts/visual-harness/vite.config.ts
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
await new Promise((resolve) => server.listen(4221, "127.0.0.1", resolve));
let browser;
let activePage;
const errors = [];
const pages = [];
const BANK2 = "20261012000000-uxbank2";

async function freshPage() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => errors.push(error.message));
  pages.push(page);
  activePage = page;
  await page.goto("http://127.0.0.1:4221/");
  await page.locator("#app .lv-rail-nav").waitFor();
  await page.waitForFunction(() => window.__app && window.__plugin);
  return page;
}
const label = (page, key) => page.evaluate((k) => window.__plugin.i18n[k], key);
const byKey = async (page, key, exact = true) => page.getByRole("button", { name: await label(page, key), exact });
const rail = (page, name) => page.locator("#app .lv-rail-nav").getByRole("button", { name, exact: true });
async function twoBanks(page) {
  await page.evaluate((bank2) => {
    const app = window.__app;
    const banks = app.listBanks();
    window.__originalBank = banks[0].id;
    window.__originalQuestions = app.listQuestions.bind(app);
    app.listBanks = () => [...banks, { id: bank2, name: "回归第二题库", createdAt: Date.now() }];
    app.listQuestions = (id) => (id === bank2 ? Promise.resolve([]) : window.__originalQuestions(id));
    window.__show("practice");
  }, BANK2);
  await page.locator("#app .block__icons select").waitFor();
}
async function parsePaste(page, text) {
  await page.locator("#app textarea.lv-textarea").fill(text);
  await (await byKey(page, "import.parse")).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("#app button")].some((button) => /先导 5/.test(button.textContent)),
  );
}

try {
  browser = await launchHarnessBrowser();

  // R54 five-task navigation: narrow task bar and cross-tab destinations.
  {
    const page = await freshPage();
    await page.locator("#app .lv-entry-hero").waitFor();
    // A host control outside the plugin keeps its native keyboard focus
    // indicator instead of inheriting the plugin's global ring/reset.
    const hostControl = page.locator("#theme");
    await hostControl.focus();
    await page.keyboard.press("Shift");
    const hostFocus = await hostControl.evaluate((button) => ({
      visible: button.matches(":focus-visible"),
      outline: getComputedStyle(button).outlineStyle,
      shadow: getComputedStyle(button).boxShadow,
    }));
    assert.equal(hostFocus.visible, true);
    assert.notEqual(hostFocus.outline, "none", "Plugin CSS must not remove the host focus outline");
    assert.equal(hostFocus.shadow, "none", "Plugin CSS must not add its focus ring to host controls");
    await page.setViewportSize({ width: 390, height: 844 });
    const taskNav = page.getByRole("navigation", { name: "主要功能" });
    await taskNav.waitFor({ state: "visible" });
    const task = (name) => taskNav.getByRole("button", { name, exact: true });
    await task("题库").click();
    await page.locator("#app .lv-qrow-head").first().waitFor();
    assert.equal(await task("题库").getAttribute("aria-current"), "page");
    // Peek detail is a modal surface: focus enters it, the page background is
    // hidden from assistive technology, Tab stays inside, and close restores
    // the row that opened it.
    const firstQuestion = page.locator("#app .lv-qrow-head").first();
    await firstQuestion.click();
    const peek = page.locator("#app .lv-peek-drawer[role=dialog]");
    await peek.waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const drawer = document.querySelector("#app .lv-peek-drawer[role=dialog]");
      return drawer instanceof HTMLElement && drawer.contains(document.activeElement);
    });
    const peekA11y = await page.evaluate(() => {
      const drawer = document.querySelector("#app .lv-peek-drawer[role=dialog]");
      const background = [...document.querySelectorAll("#app [inert][aria-hidden='true']")]
        .filter((node) => node !== drawer && !(node instanceof HTMLElement && node.contains(drawer)));
      return {
        focusInDrawer: drawer instanceof HTMLElement && drawer.contains(document.activeElement),
        backgroundCount: background.length,
      };
    });
    assert.equal(peekA11y.focusInDrawer, true, "Peek drawer should receive focus when opened");
    assert.ok(peekA11y.backgroundCount > 0, "Peek drawer should inert and hide its background from the accessibility tree");
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Tab");
      assert.equal(
        await peek.evaluate((drawer) => drawer.contains(document.activeElement)),
        true,
        `Peek Tab cycle escaped the dialog on step ${i + 1}`,
      );
    }
    await page.keyboard.press("Escape");
    await peek.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.activeElement?.classList.contains("lv-qrow-head"));
    assert.equal(await firstQuestion.evaluate((button) => button === document.activeElement), true, "Closing Peek should restore focus to its trigger");
    const closeSize = await page.locator("#app .lv-peek-close").count();
    assert.equal(closeSize, 0, "Peek close control should be removed with the drawer");
    await firstQuestion.click();
    await peek.waitFor({ state: "visible" });
    const closeBox = await page.locator("#app .lv-peek-close").evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    assert.ok(closeBox.width >= 44 && closeBox.height >= 44, `Peek close target is too small at 390px: ${JSON.stringify(closeBox)}`);
    await page.keyboard.press("Escape");
    await peek.waitFor({ state: "detached" });
    await task("出题").click();
    await page.locator("#app [data-manual-form]").waitFor();
    assert.equal(await task("出题").getAttribute("aria-current"), "page");
    const studio = page.getByRole("navigation", { name: "出题工作台", exact: true });
    await studio.waitFor();
    assert.equal(await studio.getByRole("button").count(), 4);
    assert.equal(await studio.getByRole("tab").count(), 0);
    assert.equal(await studio.locator("button[aria-current='page']").count(), 1);
    const studioSizes = await studio.getByRole("button").evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { text: button.textContent.trim(), width: rect.width, height: rect.height };
    }));
    assert.ok(studioSizes.every((size) => size.width >= 44 && size.height >= 44), `Studio navigation targets are too small: ${JSON.stringify(studioSizes)}`);
    const manualNav = studio.getByRole("button", { name: await label(page, "tab.manual") ?? "手工录题", exact: true });
    await manualNav.focus();
    await page.keyboard.press("Shift");
    assert.equal(await manualNav.evaluate((button) => button.matches(":focus-visible") && getComputedStyle(button).outlineStyle !== "none"), true);
    await page.keyboard.press("Tab");
    const materialsNav = studio.getByRole("button", { name: await label(page, "tab.materials") ?? "学习资料", exact: true });
    assert.equal(await materialsNav.evaluate((button) => button === document.activeElement), true);
    await page.keyboard.press("Enter");
    assert.equal(await materialsNav.getAttribute("aria-current"), "page");
    assert.equal(await studio.locator("button[aria-current='page']").count(), 1);
    await manualNav.click();
    await page.locator("#app [data-manual-form]").waitFor();
    console.log("✓ 宿主焦点样式独立，出题工作台使用普通按钮导航、44px 目标与 Tab/Enter 键盘交互");
    await task("今日").click();
    await page.locator("#app .lv-entry-hero").waitFor();
    assert.equal(await task("今日").getAttribute("aria-current"), "page");
    await task("模考").click();
    await page.locator("#app .lv-screen-head").waitFor();
    const mockNav = page.getByRole("navigation", { name: "主要功能" });
    assert.equal(await mockNav.getByRole("button", { name: "模考", exact: true }).getAttribute("aria-current"), "page");
    await mockNav.getByRole("button", { name: "复盘", exact: true }).click();
    await page.locator("#app .lv-screen-head").waitFor();
    const reportNav = page.getByRole("navigation", { name: "主要功能" });
    assert.equal(await reportNav.getByRole("button", { name: "复盘", exact: true }).getAttribute("aria-current"), "page");
    await reportNav.getByRole("button", { name: "出题", exact: true }).click();
    await page.locator("#app [data-manual-form]").waitFor();
    const width = await page.evaluate(() => ({ inner: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(width.scroll <= width.inner, `390px task navigation overflow: ${JSON.stringify(width)}`);
    await page.screenshot({
      path: resolve(import.meta.dirname, "../../output/workflows-mobile-390.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const paneWidth of [900, 760]) {
      const compact = await page.locator("#app .lv-exam-tab").evaluate((root, width) => {
        root.style.flex = "none";
        root.style.width = `${width}px`;
        root.style.height = "820px";
        root.style.margin = "0 0 0 250px";
        return {
          rail: root.querySelector(".lv-rail").getBoundingClientRect().width,
          mobileNav: getComputedStyle(root.querySelector(".lv-mobile-tasknav")).display,
          menuButton: getComputedStyle(root.querySelector(".lv-menu-btn")).display,
        };
      }, paneWidth);
      assert.equal(compact.rail, 74, `${paneWidth}px pane should use the R54 compact rail: ${JSON.stringify(compact)}`);
      assert.equal(compact.mobileNav, "none", `${paneWidth}px pane should keep task links in the rail: ${JSON.stringify(compact)}`);
      assert.equal(compact.menuButton, "none", `${paneWidth}px pane should not show the mobile drawer trigger: ${JSON.stringify(compact)}`);
    }
    await page.locator("#app .lv-rail-nav").getByRole("button", { name: "题库", exact: true }).click();
    await page.locator("#app .lv-qrow-head").first().waitFor();
    await page.locator("#app .lv-rail-nav").getByRole("button", { name: "出题", exact: true }).click();
    await page.locator("#app [data-manual-form]").waitFor();
    const phoneEdge = await page.locator("#app .lv-exam-tab").evaluate((root) => {
      root.style.width = "759px";
      return {
        rail: getComputedStyle(root.querySelector(".lv-rail")).display,
        mobileNav: getComputedStyle(root.querySelector(".lv-mobile-tasknav")).display,
      };
    });
    assert.equal(phoneEdge.rail, "none", `759px pane should hide the full rail: ${JSON.stringify(phoneEdge)}`);
    assert.equal(phoneEdge.mobileNav, "grid", `759px pane should reveal bottom task navigation: ${JSON.stringify(phoneEdge)}`);
    const geometry = await page.locator("#app .lv-exam-tab").evaluate((root) => {
      root.style.flex = "none";
      root.style.width = "520px";
      root.style.height = "820px";
      root.style.margin = "0 0 0 560px";
      const pane = root.getBoundingClientRect();
      const nav = root.querySelector(".lv-mobile-tasknav").getBoundingClientRect();
      return { pane: { left: pane.left, right: pane.right }, nav: { left: nav.left, right: nav.right, bottom: nav.bottom }, paneBottom: pane.bottom };
    });
    assert.ok(Math.abs(geometry.nav.left - geometry.pane.left) <= 1, `task navigation left escapes plugin pane: ${JSON.stringify(geometry)}`);
    assert.ok(Math.abs(geometry.nav.right - geometry.pane.right) <= 1, `task navigation right escapes plugin pane: ${JSON.stringify(geometry)}`);
    assert.ok(Math.abs(geometry.nav.bottom - geometry.paneBottom) <= 1, `task navigation is not pinned to plugin pane bottom: ${JSON.stringify(geometry)}`);
    await page.getByRole("button", { name: "打开导航", exact: true }).click();
    await page.locator("#app .lv-nav-backdrop").waitFor({ state: "visible" });
    const drawerGeometry = await page.locator("#app .lv-exam-tab").evaluate((root) => {
      const pane = root.getBoundingClientRect();
      const drawer = root.querySelector(".lv-rail.open").getBoundingClientRect();
      const backdrop = root.querySelector(".lv-nav-backdrop").getBoundingClientRect();
      return { pane: { left: pane.left, right: pane.right }, drawer: { left: drawer.left, right: drawer.right }, backdrop: { left: backdrop.left, right: backdrop.right } };
    });
    assert.ok(Math.abs(drawerGeometry.drawer.left - drawerGeometry.pane.left) <= 1, `navigation drawer left escapes plugin pane: ${JSON.stringify(drawerGeometry)}`);
    assert.ok(drawerGeometry.drawer.right <= drawerGeometry.pane.right + 1, `navigation drawer right escapes plugin pane: ${JSON.stringify(drawerGeometry)}`);
    assert.ok(Math.abs(drawerGeometry.backdrop.left - drawerGeometry.pane.left) <= 1 && Math.abs(drawerGeometry.backdrop.right - drawerGeometry.pane.right) <= 1, `navigation backdrop escapes plugin pane: ${JSON.stringify(drawerGeometry)}`);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    console.log("✓ R54 五项任务导航在 390px 可触发、跨页面目标正确，并受宽窗口内的窄插件面板约束");
  }

  // File pickers expose native buttons: keyboard activation opens the same
  // browser file chooser as pointer activation, then CSV reaches preview.
  {
    const page = await freshPage();
    await rail(page, "出题").click();
    const studio = page.getByRole("navigation", { name: "出题工作台", exact: true });
    await studio.getByRole("button", { name: await label(page, "tab.import") ?? "批量导入", exact: true }).click();
    const importPicker = await byKey(page, "import.pickExcel");
    await importPicker.focus();
    assert.equal(await importPicker.evaluate((button) => button.tagName === "BUTTON" && button.tabIndex === 0 && button === document.activeElement), true);
    const [importChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.keyboard.press("Enter"),
    ]);
    await importChooser.setFiles({
      name: "键盘文件选择.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("题型,题干,选项A,选项B,答案,解析\n单选,键盘导入回归：请选择一,一,二,A,第一项是一。"),
    });
    await page.getByRole("button", { name: `${await label(page, "import.commit")} (1)`, exact: true }).waitFor();
    await studio.getByRole("button", { name: await label(page, "tab.materials") ?? "学习资料", exact: true }).click();
    const materialPicker = await byKey(page, "materials.pickFile");
    await materialPicker.focus();
    assert.equal(await materialPicker.evaluate((button) => button.tagName === "BUTTON" && button.tabIndex === 0 && button === document.activeElement), true);
    const [materialChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.keyboard.press("Space"),
    ]);
    await materialChooser.setFiles([]);
    console.log("✓ 导入与资料文件入口均可用键盘打开选择器，CSV 文件选择后进入有效预览");
  }

  // 更新式重导：只有更新行也应能提交；提交中锁定题库选择，按原题库快照更新。
  {
    const page = await freshPage();
    await twoBanks(page);
    const data = await page.evaluate(async () => {
      const qs = await window.__app.listQuestions(window.__originalBank);
      window.__expectedTargetIds = qs.map((q) => q.id);
      window.__updateCalls = [];
      window.__app.commitImport = (bank, report) => {
        window.__commitBank = bank;
        window.__commitOkCount = report.ok.length;
        return new Promise((resolve) => {
          window.__resolveCommit = () =>
            resolve({ written: 0, readback: { confirmed: [], missing: [], verified: true } });
        });
      };
      window.__app.applyAnswerUpdates = async (updates, targets) => {
        window.__updateCalls.push({ answers: updates.map((u) => u.q.answer), targetIds: targets.map((q) => q.id) });
        return { ok: updates.length, failed: 0, missing: 0 };
      };
      const q = qs.find((q) => q.type === "single");
      return [
        "题型\t题干\t选项A\t选项B\t选项C\t选项D\t答案\t解析",
        [q.type, q.stem, ...q.options, "A", "更新回归：保持题面，更新答案与解析。"].join("\t"),
      ].join("\n");
    });
    await rail(page, "导入题库").click();
    await page
      .locator("#app select[title]")
      .filter({ has: page.locator('option[value="update"]') })
      .selectOption("update");
    await parsePaste(page, data);
    const commit = page
      .getByRole("button")
      .filter({ hasText: /确认.*新增.*0.*更新.*1|新增.*0.*更新.*1/ })
      .first();
    await commit.waitFor();
    assert.equal(await commit.isDisabled(), false, "只有更新行的提交按钮不应禁用");
    await commit.click();
    await page.waitForFunction(() => !!window.__resolveCommit);
    const bankSelect = page.locator("#app .block__icons select");
    assert.equal(await bankSelect.isDisabled(), true, "提交中必须禁用题库切换");
    assert.equal(
      await page.locator("#app .block__icons button").filter({ hasText: "✕" }).isDisabled(),
      true,
      "提交中移出题库入口也必须禁用",
    );
    // 模拟宿主/外部脚本触发的更改，检验异步后半段使用原始题目快照。
    await bankSelect.evaluate((el, id) => {
      el.value = id;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, BANK2);
    await page.evaluate(() => window.__resolveCommit());
    await page.waitForFunction(() => window.__updateCalls.length === 1);
    const receipt = await page.evaluate(() => ({
      bank: window.__commitBank,
      original: window.__originalBank,
      count: window.__commitOkCount,
      targets: window.__updateCalls[0].targetIds,
      expected: window.__expectedTargetIds,
    }));
    assert.equal(receipt.bank, receipt.original);
    assert.equal(receipt.count, 0);
    assert.deepEqual([...new Set(receipt.targets)], receipt.expected);
    console.log("✓ 更新式重导 0 新增仍可提交，提交中切库禁用，更新使用原题库快照");
  }

  // 两次试导覆盖 5 + 3 行，不重复写第一批；最终完成只确认已经读回的 8 行。
  {
    const page = await freshPage();
    await page.evaluate(() => {
      window.__trialCalls = [];
      window.__app.commitImport = async (bank, report) => {
        const ids = report.ok.map((q) => q.id);
        window.__trialCalls.push({ bank, ids });
        return { written: ids.length, readback: { confirmed: ids, missing: [], verified: true } };
      };
    });
    await rail(page, "导入题库").click();
    await parsePaste(
      page,
      Array.from({ length: 8 }, (_, i) => `回归试导第 ${i + 1} 题的结果是？\nA. 一\nB. 二\nANSWER: A`).join("\n\n"),
    );
    const trial = await byKey(page, "import.trial5");
    await trial.click();
    await page.waitForFunction(() => window.__trialCalls.length === 1);
    await trial.click();
    await page.waitForFunction(() => window.__trialCalls.length === 2);
    assert.equal(await trial.isDisabled(), true);
    const ids = await page.evaluate(() => window.__trialCalls.map((call) => call.ids));
    assert.deepEqual(
      ids.map((group) => group.length),
      [5, 3],
    );
    assert.equal(new Set(ids.flat()).size, 8);
    await (await byKey(page, "import.finishTrial")).click();
    assert.equal(await page.evaluate(() => window.__trialCalls.length), 2);
    await page.locator("#app .lv-success").waitFor();
    console.log("✓ 连续试导 5 + 3 行没有重复确认，完成试导不再次写入");
  }

  // 录题保留字母位置：B 留空、C 为正确答案，必须显式拦截而非删除 B 导致答案错位。
  {
    const page = await freshPage();
    await page.evaluate(() => {
      window.__manualWrites = [];
      window.__app.writeManualQuestion = async (bank, q) => {
        window.__manualWrites.push({ bank, q });
      };
    });
    await rail(page, "手工录题").click();
    const manualStem = page.getByRole("textbox", { name: await label(page, "manual.stem"), exact: true });
    await manualStem.fill("切换题型前的草稿。");
    const multipleType = page.getByRole("button", { name: await label(page, "qtype.multiple"), exact: true });
    await multipleType.click();
    await page.getByRole("heading", { name: await label(page, "manual.switchTypeTitle"), exact: true }).waitFor();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await multipleType.evaluate((el) => el.classList.contains("acc")), false);
    await multipleType.click();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    assert.equal(await multipleType.evaluate((el) => el.classList.contains("acc")), true);
    const singleType = page.getByRole("button", { name: await label(page, "qtype.single"), exact: true });
    await singleType.click();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    assert.equal(await singleType.evaluate((el) => el.classList.contains("acc")), true);
    await manualStem.fill("回归录题：请选数字三。");
    await page.getByRole("button", { name: /添加选项/ }).click();
    const options = page
      .locator("#app .lv-field")
      .filter({ hasText: await label(page, "manual.options") })
      .locator("input");
    await options.nth(0).fill("一");
    await options.nth(2).fill("三");
    await page.getByRole("button", { name: `${await label(page, "manual.setCorrect")} C`, exact: true }).click();
    await (await byKey(page, "manual.save")).click();
    await page.getByText("存在空选项", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__manualWrites.length), 0);
    assert.equal(await options.nth(1).inputValue(), "");
    assert.equal(await options.nth(2).inputValue(), "三");
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute("data-manual-field")),
      "option-1",
      "validation should focus the exact invalid option",
    );
    assert.equal(await options.nth(1).getAttribute("aria-invalid"), "true");
    await options.nth(1).fill("二");
    await (await byKey(page, "manual.save")).click();
    await page.waitForFunction(() => window.__manualWrites.length === 1);
    const question = await page.evaluate(() => window.__manualWrites[0].q);
    assert.deepEqual(question.options, ["一", "二", "三"]);
    assert.equal(question.answer, "C");
    console.log("✓ 录题空选项显式拦截且保留输入，补齐后正确答案仍为 C");
  }

  // 错题处置失败不可静默；确认后失败保留条目，修复故障后可重试。
  {
    const page = await freshPage();
    await page
      .locator("#app .lv-rail-nav")
      .getByRole("button", { name: /错题本/ })
      .click();
    await page.evaluate(() => {
      window.__wrongStatusCalls = 0;
      window.__originalSetWrongStatus = window.__app.setWrongStatus.bind(window.__app);
      window.__app.setWrongStatus = async (qid, status) => {
        window.__wrongStatusCalls++;
        if (window.__wrongStatusCalls === 1) throw new Error("模拟写入失败");
        await window.__originalSetWrongStatus(qid, status);
      };
    });
    const mastered = page.getByRole("button", { name: "已掌握", exact: true }).first();
    const wrongCountBefore = await page.locator("#app .lv-wrong-row").count();
    assert.ok(wrongCountBefore >= 2);
    await mastered.click();
    await page.getByRole("heading", { name: "将这道错题标记为已掌握？" }).waitFor();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await page.waitForFunction(() => window.__wrongStatusCalls === 1);
    await page.getByText(/标记失败，错题仍保留在队列中/).waitFor();
    assert.equal(await page.locator("#app .lv-wrong-row").count(), wrongCountBefore);
    await mastered.click();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await page.waitForFunction(() => window.__wrongStatusCalls === 2);
    await page.getByText(/已彻底掌握|已标记掌握/).waitFor();
    assert.equal(await page.locator("#app .lv-wrong-row").count(), wrongCountBefore - 1);
    console.log("✓ 错题处置有确认、写入失败提示和可重试入口");
  }

  // 放弃模考应先说明不可恢复后果；取消保留快照，确认后才清除。
  {
    const page = await freshPage();
    await page.evaluate(async () => {
      await window.__app.saveMockRun({
        v: 1,
        runId: "ux-discard-run",
        bp: { name: "回归模考", durationS: 3600 },
        qids: ["seed-q01"],
        sectionOf: { "seed-q01": "默认" },
        scoreOf: { "seed-q01": 1 },
        indefinite: [],
        startedAt: Date.now(),
        savedAt: Date.now(),
        answers: [],
        flags: [],
        cursor: 0,
        sectionStart: { 默认: 0 },
        screenSwitches: 0,
      });
      window.__show("mock");
    });
    await page.getByRole("button", { name: "放弃本次", exact: true }).waitFor();
    await page.getByRole("button", { name: "放弃本次", exact: true }).click();
    await page.getByRole("heading", { name: "放弃这场模考？" }).waitFor();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal((await page.evaluate(() => window.__app.loadMockRun())).runId, "ux-discard-run");
    await page.getByRole("button", { name: "放弃本次", exact: true }).click();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await page.waitForFunction(async () => (await window.__app.loadMockRun()) === null);
    assert.equal(await page.getByRole("button", { name: "放弃本次", exact: true }).count(), 0);
    console.log("✓ 放弃模考明确不可恢复后果，取消保留快照，确认后才删除");
  }

  // 不同资料草稿隔离；写入期间禁止切换资料/编辑旧笔记；失败不清空输入。
  {
    const page = await freshPage();
    await page.evaluate(() => {
      const now = Date.now();
      window.__materials = ["A", "B"].map((n) => ({
        id: `ux-material-${n}`,
        revision: 1,
        title: `回归资料${n}`,
        kind: "pdf",
        locations: [{ kind: "link", path: `https://example.test/${n}.pdf`, addedAt: now }],
        createdAt: now,
        updatedAt: now,
      }));
      window.__notes = [
        {
          id: "ux-note-a",
          materialId: "ux-material-A",
          revision: 1,
          locator: { page: 2 },
          text: "资料A已有笔记",
          tags: [],
          createdAt: now,
          updatedAt: now,
        },
      ];
      window.__app.listMaterials = () => window.__materials;
      window.__app.listMaterialNotes = (id) => window.__notes.filter((note) => note.materialId === id);
      window.__qrefs = [];
      window.__app.listQuestionRefs = (id) => window.__qrefs.filter((ref) => ref.materialId === id);
      window.__qrefs.push({ qid: "seed-q01", materialId: "ux-material-A", revision: 1, locator: null, createdAt: now });
      window.__noteRequests = 0;
      window.__app.addMaterialNote = (payload) => {
        window.__noteRequests++;
        window.__notePayload = structuredClone(payload);
        return new Promise((resolve, reject) => {
          window.__rejectNote = () => reject(new Error("回归模拟保存失败"));
          window.__resolveNote = () => {
            window.__notes.push({ ...payload, id: "ux-note-new", createdAt: now, updatedAt: now });
            resolve();
          };
        });
      };
      window.__deleteNoteRequests = 0;
      window.__app.deleteMaterialNote = async (id) => {
        window.__deleteNoteRequests++;
        if (window.__deleteNoteRequests === 1) throw new Error("回归模拟删除失败");
        window.__notes = window.__notes.filter((note) => note.id !== id);
      };
    });
    await rail(page, "学习资料").click();
    const materialItem = (n) => page.locator("#app .lv-material-item").filter({ hasText: `回归资料${n}` });
    const detail = () => page.locator("#app .lv-material-detail");
    const notesButton = () => detail().getByRole("button", { name: /^笔记/ });
    const noteEditor = () => detail().locator("textarea");
    await materialItem("A").click();
    assert.equal((await materialItem("A").locator(".lv-material-count").innerText()).trim(), "1");
    assert.match(await notesButton().innerText(), /（\s*1\s*）/);
    assert.match(await detail().innerText(), /关联\s*1\s*题/, "资料详情应显示当前题目关联数");
    await notesButton().click();
    await noteEditor().fill("资料A尚未保存的草稿");
    await materialItem("B").click();
    await notesButton().click();
    assert.equal(await noteEditor().inputValue(), "");
    await noteEditor().fill("资料B独立的草稿");
    await materialItem("A").click();
    await notesButton().click();
    assert.equal(await noteEditor().inputValue(), "资料A尚未保存的草稿");
    await detail()
      .getByRole("button", { name: await label(page, "materials.noteAddBtn"), exact: true })
      .click();
    await page.waitForFunction(() => !!window.__rejectNote);
    assert.equal(await materialItem("B").isDisabled(), true, "保存中必须禁用资料切换");
    assert.equal(
      await detail()
        .getByRole("button", { name: await label(page, "materials.noteEdit"), exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(await noteEditor().isDisabled(), true, "保存中必须锁定当前笔记内容");
    await page.evaluate(() => window.__rejectNote());
    await page.getByText("回归模拟保存失败", { exact: true }).waitFor();
    assert.equal(await noteEditor().inputValue(), "资料A尚未保存的草稿");
    assert.equal((await materialItem("A").locator(".lv-material-count").innerText()).trim(), "1", "保存失败不可提前增加计数");
    assert.match(await notesButton().innerText(), /（\s*1\s*）/);
    await page.setViewportSize({ width: 760, height: 1000 });
    await page.getByText("回归模拟保存失败", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(import.meta.dirname, "../../output/workflows-note-failure-narrow.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await detail()
      .getByRole("button", { name: await label(page, "materials.noteAddBtn"), exact: true })
      .click();
    await page.waitForFunction(() => window.__noteRequests === 2);
    await page.evaluate(() => window.__resolveNote());
    await page.waitForFunction(() => window.__notes.length === 2);
    await noteEditor().waitFor();
    await page.waitForFunction(() => {
      const selected = document.querySelector("#app .lv-material-item.selected .lv-material-count");
      return selected?.textContent.trim() === "2";
    });
    assert.equal(await noteEditor().inputValue(), "");
    assert.equal((await materialItem("A").locator(".lv-material-count").innerText()).trim(), "2", "保存成功应即时更新资料列表计数");
    assert.match(await notesButton().innerText(), /（\s*2\s*）/, "保存成功应即时更新笔记按钮计数");
    assert.equal(await page.evaluate(() => window.__notePayload.materialId), "ux-material-A");
    const newNote = () => detail().locator(".lv-material-note").filter({ hasText: "资料A尚未保存的草稿" });
    const deleteNewNote = async () => newNote().getByRole("button", { name: await label(page, "materials.removeTitle"), exact: true }).click();
    await deleteNewNote();
    await page.getByRole("heading", { name: await label(page, "materials.noteDelTitle"), exact: true }).waitFor();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__deleteNoteRequests), 0, "取消确认不可执行删除");
    await deleteNewNote();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await page.getByText("回归模拟删除失败", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__deleteNoteRequests), 1);
    assert.equal(await newNote().count(), 1, "删除失败必须保留笔记正文");
    assert.equal((await materialItem("A").locator(".lv-material-count").innerText()).trim(), "2", "删除失败不可减少列表计数");
    assert.match(await notesButton().innerText(), /（\s*2\s*）/, "删除失败不可减少按钮计数");
    await deleteNewNote();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await newNote().waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => window.__deleteNoteRequests), 2);
    assert.equal((await materialItem("A").locator(".lv-material-count").innerText()).trim(), "1", "删除成功应即时减少列表计数");
    assert.match(await notesButton().innerText(), /（\s*1\s*）/, "删除成功应即时减少按钮计数");
    await materialItem("B").click();
    await notesButton().click();
    assert.equal(await noteEditor().inputValue(), "资料B独立的草稿");
    assert.equal((await materialItem("B").locator(".lv-material-count").innerText()).trim(), "0", "另一资料的计数保持独立");
    assert.match(await notesButton().innerText(), /（\s*0\s*）/);
    console.log("✓ 资料草稿按资料隔离，保存/删除成功即时刷新两处计数，取消或失败保留正文与计数");
  }

  // 原始请求素材/题库/要求是队列快照；页面后续变化不能污染候选和重试。
  {
    const page = await freshPage();
    await twoBanks(page);
    await page.evaluate(async () => {
      await window.__app.deps.storage.save("ai/review-queue", { queue: [], rejected: [], duplicates: 0 });
      const getSetting = window.__plugin.settingUtils.get;
      window.__plugin.settingUtils.get = (key) => (key === "aiCustomHint" ? "设置要求：避免口诀题" : getSetting(key));
      localStorage.setItem("lv-exam-ai-consent", JSON.stringify({ endpoint: "(内置)" }));
      window.__aiRequests = [];
      window.__app.deps.client.aiChat = (message) => {
        window.__aiRequests.push(message);
        if (window.__aiRequests.length === 1)
          return new Promise((resolve) => {
            window.__resolveGeneration = resolve;
          });
        return Promise.resolve(
          JSON.stringify([
            {
              type: "judge",
              stem: "重试题：水在标准大气压下的沸点是100摄氏度。",
              options: [],
              answer: "对",
              analysis: "因为材料明确给出了标准大气压这一前提，所以本题采用常见的水沸点结论，不能省略压力条件。",
            },
          ]),
        );
      };
      window.__show("practice");
    });
    await rail(page, "AI 出题").click();
    const source = page.getByRole("textbox", { name: await label(page, "ai.source"), exact: true });
    await source.fill("原始材料A：标准大气压下，水的沸点是100摄氏度。");
    await page
      .getByPlaceholder(await label(page, "ai.customHintHint"), { exact: true })
      .fill("页面要求：用常见生活场景");
    await (await byKey(page, "ai.quality.economy")).click();
    await (await byKey(page, "ai.generate")).click();
    await page.waitForFunction(() => !!window.__resolveGeneration);
    const firstRequest = await page.evaluate(() => window.__aiRequests[0]);
    assert.match(firstRequest, /设置要求：避免口诀题/);
    assert.match(firstRequest, /页面要求：用常见生活场景/);
    const bankSelect = page.locator("#app .block__icons select");
    assert.equal(await bankSelect.isDisabled(), true);
    assert.equal(
      await page.locator("#app .block__icons button").filter({ hasText: "✕" }).isDisabled(),
      true,
      "AI生成中移出题库入口也必须禁用",
    );
    // 强制分发 input/change，模拟异步期间其他宿主入口改变上下文，验证请求快照而非静态禁用。
    await source.evaluate((el) => {
      el.value = "新的材料B：这不是出题时的材料。";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await bankSelect.evaluate((el, id) => {
      el.value = id;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, BANK2);
    await page.evaluate(() =>
      window.__resolveGeneration(
        JSON.stringify([
          {
            type: "judge",
            stem: "水在标准大气压下的沸点是100摄氏度。",
            options: [],
            answer: "对",
            analysis: "因为标准大气压是本题给定的条件，所以水的沸点采用100摄氏度；不同气压下不能直接套用该结论。",
          },
          { type: "judge", stem: "待修题", answer: "不确定", analysis: "短" },
        ]),
      ),
    );
    await page.waitForFunction(
      async () => (await window.__app.deps.storage.load("ai/review-queue"))?.queue?.length === 1,
    );
    const queue = await page.evaluate(() => window.__app.deps.storage.load("ai/review-queue"));
    assert.equal(queue.bankId, await page.evaluate(() => window.__originalBank));
    assert.match(queue.material, /^原始材料A/);
    assert.equal(queue.options.customHint, "设置要求：避免口诀题\n页面要求：用常见生活场景");
    assert.equal(queue.rejected.length, 1);
    await page.getByText(await label(page, "ai.queueWrongBank"), { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: /全部入库/ }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: /重试失败项/ }).isDisabled(), true);
    assert.equal(await (await byKey(page, "ai.regen")).isDisabled(), true);
    await (await byKey(page, "ai.regen")).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(import.meta.dirname, "../../output/workflows-ai-wrong-bank.png"),
      fullPage: true,
      animations: "disabled",
    });
    const originalBank = await page.evaluate(() => window.__originalBank);
    await bankSelect.selectOption(originalBank);
    const retry = page.getByRole("button", { name: /重试失败项/ });
    await retry.click();
    await page.waitForFunction(() => window.__aiRequests.length === 2);
    const repairRequest = await page.evaluate(() => window.__aiRequests[1]);
    assert.match(repairRequest, /原始材料A/);
    assert.doesNotMatch(repairRequest, /新的材料B/);
    await page.waitForFunction(
      async () => (await window.__app.deps.storage.load("ai/review-queue"))?.queue?.length === 2,
    );
    console.log("✓ AI 额外要求进入请求，原题库/素材/配置快照不被页面变化污染，错库按钮禁用，失败项重试仍用原素材");
  }

  // 用量和队列存储失败分别反馈；已生成候选仍留在页面，用户可继续处理。
  {
    const page = await freshPage();
    const messages = [];
    page.on("console", (message) => messages.push(message.text()));
    await page.evaluate(async () => {
      const storage = window.__app.deps.storage;
      await storage.save("ai/review-queue", { queue: [], rejected: [], duplicates: 0 });
      const save = storage.save.bind(storage);
      window.__queueSaveAttempts = 0;
      storage.save = async (key, value) => {
        if (key === "ai/review-queue") {
          window.__queueSaveAttempts++;
          throw new Error("回归队列存储失败");
        }
        return save(key, value);
      };
      window.__usageSaveAttempts = 0;
      window.__app.recordAiUsage = async () => {
        window.__usageSaveAttempts++;
        throw new Error("回归用量保存失败");
      };
      localStorage.setItem("lv-exam-ai-consent", JSON.stringify({ endpoint: "(内置)" }));
      window.__app.deps.client.aiChat = async () =>
        JSON.stringify([
          {
            type: "judge",
            stem: "存储失败回归：标准大气压下水的沸点是100摄氏度。",
            options: [],
            answer: "对",
            analysis: "材料明确给出了标准大气压这一前提，因此本题采用100摄氏度的结论，气压变化时需要重新判断。",
          },
        ]);
      window.__show("practice");
    });
    await rail(page, "AI 出题").click();
    await page
      .getByRole("textbox", { name: await label(page, "ai.source"), exact: true })
      .fill("标准大气压下水的沸点是100摄氏度。");
    await (await byKey(page, "ai.quality.economy")).click();
    await (await byKey(page, "ai.generate")).click();
    await page.getByText("存储失败回归：标准大气压下水的沸点是100摄氏度。", { exact: true }).waitFor();
    await page.getByText(await label(page, "ai.queueSaveFailed"), { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__usageSaveAttempts), 1);
    assert.equal(await page.evaluate(() => window.__queueSaveAttempts >= 2), true);
    assert.equal(
      messages.some((message) => message.includes("本次 AI 用量未能保存，生成结果仍会保留")),
      true,
    );
    assert.equal(await page.getByRole("button", { name: /全部入库/ }).isDisabled(), false);
    console.log("✓ AI用量和待审队列保存失败均明确提示，生成候选保留在页面且可继续审核");
  }

  // 收藏写入失败时保留旧状态并明确反馈，重试成功后才更新题面。
  {
    const page = await freshPage();
    await page.evaluate(async () => {
      const bank = window.__app.listBanks()[0];
      const q = (await window.__app.listQuestions(bank.id)).find((question) => question.type === "single");
      window.__plugin.pendingPractice = [q];
      window.__plugin.pendingPracticeBankId = bank.id;
      window.__originalToggleFav = window.__app.toggleFav.bind(window.__app);
      window.__favCalls = 0;
      window.__app.toggleFav = async (question) => {
        window.__favCalls++;
        if (window.__favCalls === 1) throw new Error("模拟属性写入失败");
        return window.__originalToggleFav(question);
      };
      window.__show("practice");
    });
    const favorite = page.getByRole("button", { name: "收藏本题", exact: true });
    await favorite.click();
    await page.getByRole("alert").filter({ hasText: "收藏操作失败，状态未更改" }).waitFor();
    assert.equal(await favorite.getAttribute("aria-pressed"), "false");
    await favorite.click();
    await page.waitForFunction(() => window.__favCalls === 2);
    await page.waitForFunction(
      () => document.querySelector('[aria-label="收藏本题"]')?.getAttribute("aria-pressed") === "true",
    );
    // A successful write must update the same UI state that a second click
    // reads; this catches an in-place q.fav mutation being inverted again by
    // the list update path.
    await favorite.click();
    await page.waitForFunction(() => window.__favCalls === 3);
    await page.waitForFunction(
      () => document.querySelector('[aria-label="收藏本题"]')?.getAttribute("aria-pressed") === "false",
    );
    await page.getByRole("status").filter({ hasText: "已取消收藏" }).waitFor();
    console.log("✓ 收藏写入失败有明确提示且保留旧状态，重试成功后可稳定切换并显示对应反馈");
  }

  // 文件落在插件区域才接管：CSV 自动进入导入预览，保留题型与选项。
  {
    const page = await freshPage();
    await page.evaluate(() => {
      window.__dropCsv = "题型,题干,选项A,选项B,答案,解析\n单选,拖拽回归：请选择一,一,二,A,第一项是一。";
      window.__dropWrites = [];
      window.__app.commitImport = async (bank, report) => {
        window.__dropWrites.push({ bank, questions: JSON.parse(JSON.stringify(report.ok)) });
        const ids = report.ok.map((q) => q.id);
        return { written: ids.length, readback: { confirmed: ids, missing: [], verified: true } };
      };
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([window.__dropCsv], "回归拖拽.csv", { type: "text/csv" }));
      document.body.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    });
    assert.equal(await page.locator("#app textarea.lv-textarea").count(), 0, "宿主其他区域的拖拽不应改变插件页面");
    await page.locator("#app .lv-exam-tab").evaluate((el) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([window.__dropCsv], "回归拖拽.csv", { type: "text/csv" }));
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    });
    const commit = page.getByRole("button", { name: `${await label(page, "import.commit")} (1)`, exact: true });
    await commit.waitFor();
    await commit.click();
    await page.waitForFunction(() => window.__dropWrites.length === 1);
    const question = await page.evaluate(() => window.__dropWrites[0].questions[0]);
    assert.equal(question.type, "single");
    assert.deepEqual(question.options, ["一", "二"]);
    assert.equal(question.answer, "A");
    console.log("✓ 拖拽 CSV 自动进入可用预览并保留题型/选项，宿主其他区域拖拽不劫持");
  }

  // 练习快捷键属于当前插件：宿主输入框/弹窗和 IME 不改变答案，回到练习后仍可用。
  {
    const page = await freshPage();
    await page.evaluate(async () => {
      const bank = window.__app.listBanks()[0];
      const q = (await window.__app.listQuestions(bank.id)).find((question) => question.type === "single");
      window.__attemptsBeforeKeys = window.__app.attempts.all().length;
      window.__plugin.pendingPractice = [q];
      window.__plugin.pendingPracticeBankId = bank.id;
      window.__show("practice");
    });
    const options = page.locator("#app .lv-question .lv-opt");
    await options.nth(1).click();
    const selected = page.locator("#app .lv-question .lv-opt.sel .key");
    assert.equal(await selected.textContent(), "B");
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "ux-host-input";
      document.body.append(input);
      input.focus();
    });
    await page.keyboard.press("A");
    await page.keyboard.press("Enter");
    assert.equal(await selected.textContent(), "B");
    assert.equal(await page.locator("#app .lv-feedback").count(), 0);
    await page.evaluate(() => {
      const dialog = document.createElement("div");
      dialog.id = "ux-host-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.innerHTML = "<button>宿主弹窗确认</button>";
      document.body.append(dialog);
    });
    await options.nth(1).focus();
    await page.keyboard.press("A");
    await page.keyboard.press("Enter");
    assert.equal(await selected.textContent(), "B");
    assert.equal(await page.locator("#app .lv-feedback").count(), 0);
    await page.evaluate(() => {
      document.querySelector("#ux-host-dialog").remove();
      document.querySelector("#ux-host-input").remove();
    });
    await options.nth(1).evaluate((el) => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "A", bubbles: true, isComposing: true }));
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, keyCode: 229 }));
    });
    assert.equal(await selected.textContent(), "B");
    assert.equal(await page.locator("#app .lv-feedback").count(), 0);
    assert.equal(await page.evaluate(() => window.__app.attempts.all().length === window.__attemptsBeforeKeys), true);
    await options.nth(1).focus();
    await page.keyboard.press("A");
    assert.equal(await selected.textContent(), "A");
    // Enter 在按钮上遵循按钮语义，练习提交快捷键由非输入/非按钮的题面区域触发。
    await page.locator("#app .lv-stem").evaluate((el) => {
      el.tabIndex = -1;
      el.focus();
    });
    await page.keyboard.press("Enter");
    await page.locator("#app .lv-feedback").waitFor();
    assert.equal(
      await page.evaluate(() => window.__app.attempts.all().length === window.__attemptsBeforeKeys + 1),
      true,
    );
    console.log("✓ 宿主输入框/弹窗、IME 按键不修改或提交答案，练习范围内快捷键正常");
  }

  assert.deepEqual(errors, []);
  console.log("✓ 全部流程无未捕获页面异常");
} catch (error) {
  console.error("页面异常:", errors);
  if (activePage) console.error((await activePage.locator("#app").innerText()).slice(-2000));
  throw error;
} finally {
  await Promise.allSettled(pages.map((page) => page.close()));
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
