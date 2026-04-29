import { chromium } from "playwright-extra";
import type { BrowserContext } from "playwright-core";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import path from "path";
import fs from "fs";
import type { Platform } from "@/db/schema";

chromium.use(StealthPlugin());

// Browser session lives alongside SQLite in the persistent data dir so a single
// Railway volume mounted at /app/data covers both. Override with BROWSER_DATA_DIR if needed.
const BROWSER_DATA_DIR =
  process.env.BROWSER_DATA_DIR ||
  path.join(process.cwd(), "data", "browser-data");

/**
 * Each platform gets its own cookie jar. Earlier versions shared an
 * `instagram-state.json` between IG and Threads (they both auth via Meta
 * SSO), but that made any IG login breakage cascade to Threads. Now each
 * session is independent — sessions can be (re)uploaded manually via
 * /api/sessions/upload when an auto-login flow breaks.
 */
const STATE_KEY: Record<Platform, string> = {
  instagram: "instagram",
  threads: "threads",
  tiktok: "tiktok",
};

export function statePathFor(platform: Platform): string {
  return path.join(BROWSER_DATA_DIR, `${STATE_KEY[platform]}-state.json`);
}

export function hasStorageState(platform: Platform): boolean {
  return fs.existsSync(statePathFor(platform));
}

/**
 * Playwright storageState format. Only `cookies` matters for our use —
 * `origins` (localStorage / sessionStorage) is left empty.
 */
export interface PlaywrightStorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>;
  origins: unknown[];
}

export function readStorageState(
  platform: Platform
): PlaywrightStorageState | null {
  const p = statePathFor(platform);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as PlaywrightStorageState;
  } catch {
    return null;
  }
}

export function writeStorageState(
  platform: Platform,
  state: PlaywrightStorageState
): void {
  const p = statePathFor(platform);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Cookies for a given platform's primary domain. Used by /api/sessions/status
 * to determine whether a session is still valid (sessionid present + not
 * obviously expired).
 */
export function platformCookieDomain(platform: Platform): string {
  switch (platform) {
    case "instagram":
      return "instagram.com";
    case "threads":
      return "threads.com";
    case "tiktok":
      return "tiktok.com";
  }
}

export function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BrowserContextOptions {
  platform: Platform;
}

export async function createBrowserContext(
  options: BrowserContextOptions
): Promise<BrowserContext> {
  const statePath = statePathFor(options.platform);
  const hasState = fs.existsSync(statePath);

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
    ...(hasState ? { storageState: statePath } : {}),
  });

  return context;
}

export async function saveState(
  context: BrowserContext,
  platform: Platform
): Promise<void> {
  const statePath = statePathFor(platform);
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  await context.storageState({ path: statePath });
}

/**
 * Parse strings like "1.2M", "123K", "1,234", "1234" into a number.
 * Returns null on unrecognized input. Used by every platform scraper.
 */
export function parseCompactNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.trim().toLowerCase().replace(/\s/g, "");
  const multipliers: Record<string, number> = {
    k: 1_000,
    m: 1_000_000,
    b: 1_000_000_000,
  };
  const match = cleaned.match(/^([\d,.]+)\s*([kmb])?$/);
  if (!match) return null;
  const num = parseFloat(match[1].replace(/,/g, ""));
  if (Number.isNaN(num)) return null;
  const suffix = match[2];
  return Math.round(num * (suffix ? multipliers[suffix] : 1));
}
