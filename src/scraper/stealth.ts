import { chromium } from "playwright-extra";
import type { BrowserContext } from "playwright-core";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import path from "path";
import fs from "fs";

chromium.use(StealthPlugin());

const STATE_PATH = path.join(process.cwd(), "browser-data", "state.json");

function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createBrowserContext(): Promise<BrowserContext> {
  const hasState = fs.existsSync(STATE_PATH);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "Asia/Almaty",
    ...(hasState ? { storageState: STATE_PATH } : {}),
  });

  return context;
}

async function saveState(context: BrowserContext): Promise<void> {
  const dir = path.dirname(STATE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  await context.storageState({ path: STATE_PATH });
}

export { createBrowserContext, saveState, randomDelay, STATE_PATH };
