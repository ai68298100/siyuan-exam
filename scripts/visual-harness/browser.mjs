import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const candidates = [
  process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  chromium.executablePath(),
].filter((path) => typeof path === "string" && path.length > 0);

export function launchHarnessBrowser(options = {}) {
  const executablePath = candidates.find((path) => existsSync(path));
  if (!executablePath) {
    throw new Error("未找到 Chromium 浏览器；请设置 PLAYWRIGHT_EXECUTABLE_PATH 指向 Chrome 或 Edge。");
  }
  return chromium.launch({ ...options, executablePath });
}
