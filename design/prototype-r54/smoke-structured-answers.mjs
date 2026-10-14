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
    const body = readFileSync(join(root, path));
    res.writeHead(200, {
      "Content-Type":
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
        }[extname(path)] ?? "application/octet-stream",
    });
    res.end(body);
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

  const practice = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  practice.setDefaultTimeout(7000);
  practice.on("pageerror", (error) => errors.push(error.message));
  await practice.goto(origin);
  await practice.getByRole("button", { name: /开始练习/ }).click();

  for (let i = 0; i < 3; i++) {
    await practice.locator("[data-action='choose']").first().click();
    await practice.getByRole("button", { name: "提交答案", exact: true }).click();
    await practice.locator("[data-action='next']").click();
  }

  const numeric = practice.locator("#session-answer");
  assert.equal(await numeric.getAttribute("inputmode"), "decimal");
  assert.equal(await practice.locator(".answer-unit").innerText(), "单位：厘米");
  assert.match(await practice.locator("#answer-reason").innerText(), /数值.*厘米/);
  await numeric.fill("100.5");
  await practice.getByRole("button", { name: "提交答案", exact: true }).click();
  assert.match(await practice.locator(".answer").innerText(), /回答正确/);
  assert.match(await practice.locator(".structured-answer small").innerText(), /绝对误差 ±0.5/);
  await practice.locator("[data-action='next']").click();

  const practiceBlanks = practice.locator(".answer-blank");
  assert.equal(await practiceBlanks.count(), 2);
  assert.equal(await practiceBlanks.nth(0).getAttribute("aria-label"), "第 1 空作答");
  assert.equal(await practiceBlanks.nth(1).getAttribute("aria-label"), "第 2 空作答");
  const practiceSubmit = practice.getByRole("button", { name: "提交答案", exact: true });
  assert.equal(await practiceSubmit.isDisabled(), true, "空白题没有答案时不能提交");
  await practiceBlanks.nth(0).fill("太阳");
  assert.equal(await practiceSubmit.isDisabled(), false, "有部分答案时允许提交核对");
  await practiceBlanks.nth(0).fill("");
  assert.equal(await practiceSubmit.isDisabled(), true, "清空全部空位后应重新禁用提交");
  await practiceBlanks.nth(0).fill("太阳");
  await practiceBlanks.nth(1).fill("66.5°");
  await practice.locator("[data-action='prev']").click();
  assert.equal(await practice.locator("#session-answer").inputValue(), "100.5");
  await practice.locator("[data-action='next']").click();
  assert.deepEqual(await practiceBlanks.evaluateAll((items) => items.map((item) => item.value)), ["太阳", "66.5°"]);
  await practiceSubmit.click();
  assert.match(await practice.locator(".answer").innerText(), /回答正确/);

  await practice.setViewportSize({ width: 360, height: 844 });
  assert.equal(
    await practice.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "练习多空控件在 360px 宽度不得横向溢出",
  );
  assert.deepEqual(errors, []);
  console.log("✓ 练习：数值单位、多空位置、空值提交锁、切题答案隔离与 360px 响应式通过");

  const mock = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  mock.setDefaultTimeout(7000);
  mock.on("pageerror", (error) => errors.push(error.message));
  await mock.goto(origin);
  await mock.locator("[data-action='open-mock']").click();
  await mock.locator("#mock-count").fill("5");
  await mock.locator("[data-action='start-mock']").click();
  for (let i = 0; i < 3; i++) await mock.locator("[data-action='mock-next']").click();

  const mockNumeric = mock.locator("#session-answer");
  assert.equal(await mockNumeric.getAttribute("inputmode"), "decimal");
  assert.equal(await mock.locator(".answer-unit").innerText(), "单位：厘米");
  await mockNumeric.fill("100");
  await mock.locator("[data-action='mock-next']").click();

  const mockBlanks = mock.locator(".answer-blank");
  assert.equal(await mockBlanks.count(), 2);
  await mockBlanks.nth(0).fill("太阳");
  await mockBlanks.nth(1).fill("66.5°");
  await mock.locator("[data-action='prev']").click();
  assert.equal(await mock.locator("#session-answer").inputValue(), "100");
  await mock.locator("[data-action='mock-next']").click();
  assert.deepEqual(await mockBlanks.evaluateAll((items) => items.map((item) => item.value)), ["太阳", "66.5°"]);
  await mockBlanks.nth(0).fill("");
  await mockBlanks.nth(1).fill("");
  await mock.locator("[data-action='prev']").click();
  assert.equal(
    await mock.locator(".session-progress i").evaluate((item) => item.style.width),
    "20%",
    "全空多空答案不能计入模考已答进度",
  );
  await mock.locator("[data-action='mock-next']").click();
  assert.deepEqual(await mockBlanks.evaluateAll((items) => items.map((item) => item.value)), ["", ""]);
  await mock.setViewportSize({ width: 360, height: 844 });
  assert.equal(
    await mock.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "模考多空控件在 360px 宽度不得横向溢出",
  );
  assert.deepEqual(errors, []);
  console.log("✓ 模考：复用结构化作答控件，答案按题目隔离并适配 360px 宽度");

  const author = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  author.setDefaultTimeout(7000);
  author.on("pageerror", (error) => errors.push(error.message));
  await author.goto(origin);
  await author.locator("#page-picker").selectOption("manual");
  await author.getByRole("button", { name: "填空题", exact: true }).click();
  await author.locator("#draft-q").fill("一米等于多少厘米？");
  await author.locator("#draft-answer").fill("100");
  await author.locator("#draft-spec-unit").fill("厘米");
  await author.locator("#draft-spec-abs").fill("0.5");
  assert.match(await author.locator(".structured-author").innerText(), /数值判分设置/);
  assert.match(await author.locator("#draft-preview").innerText(), /判分单位：厘米 · 绝对容差：0.5/);
  await author.getByRole("button", { name: "单选题", exact: true }).click();
  await author.getByRole("heading", { name: "切换题型并清理答案？" }).waitFor();
  await author.getByRole("button", { name: "继续编辑", exact: true }).click();
  assert.equal(await author.locator("#draft-answer").inputValue(), "100");
  await author.getByRole("button", { name: "单选题", exact: true }).click();
  await author.getByRole("button", { name: "确认切换题型", exact: true }).click();
  assert.equal(await author.locator("#draft-answer").count(), 0);
  assert.equal(await author.locator("#draft-spec-unit").count(), 0);
  assert.deepEqual(errors, []);
  console.log("✓ 手工录题：数值规格控件可用，切题清空前可取消或确认");
} finally {
  await browser?.close();
  await new Promise((close) => server.close(close));
}
