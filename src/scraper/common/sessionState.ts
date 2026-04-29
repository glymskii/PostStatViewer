import { db } from "@/db/client";
import { settings, type Platform } from "@/db/schema";
import { eq } from "drizzle-orm";

const COOLDOWN_HOURS = 6;
const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000;
const FAIL_THRESHOLD = 3;

function key(name: string, platform: Platform): string {
  return `${name}_${platform}`;
}

function getNumericSetting(k: string): number | null {
  const row = db.select().from(settings).where(eq(settings.key, k)).get();
  if (!row?.value) return null;
  const n = parseInt(row.value, 10);
  return Number.isNaN(n) ? null : n;
}

function setSetting(k: string, value: string): void {
  const existing = db.select().from(settings).where(eq(settings.key, k)).get();
  if (existing) {
    db.update(settings).set({ value }).where(eq(settings.key, k)).run();
  } else {
    db.insert(settings).values({ key: k, value }).run();
  }
}

function deleteSetting(k: string): void {
  db.delete(settings).where(eq(settings.key, k)).run();
}

/** Detect that an error is a NEEDS_MANUAL_SESSION marker bubbled from a scraper. */
export function isStaleSessionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("NEEDS_MANUAL_SESSION");
}

/**
 * Increment the consecutive failure counter for a platform.
 * If it crosses FAIL_THRESHOLD, set a cooldown so the scheduler skips
 * this platform for COOLDOWN_HOURS hours (no point hammering IG when the
 * login flow is broken — wait for human to upload fresh cookies).
 */
export function recordSessionFailure(platform: Platform): void {
  const failKey = key("session_fail_count", platform);
  const current = getNumericSetting(failKey) ?? 0;
  const next = current + 1;
  setSetting(failKey, String(next));
  if (next >= FAIL_THRESHOLD) {
    const until = Date.now() + COOLDOWN_MS;
    setSetting(key("session_cooldown_until", platform), String(until));
    console.log(
      `[sessionState] ${platform}: ${next} consecutive failures, cooldown until ${new Date(until).toISOString()}`
    );
  }
}

/** Reset counters after a successful run. */
export function recordSessionSuccess(platform: Platform): void {
  deleteSetting(key("session_fail_count", platform));
  deleteSetting(key("session_cooldown_until", platform));
}

/** Returns ms timestamp until which we should skip this platform, or null. */
export function cooldownUntil(platform: Platform): number | null {
  const until = getNumericSetting(key("session_cooldown_until", platform));
  if (!until) return null;
  if (until <= Date.now()) {
    // Cooldown elapsed — clear it lazily.
    deleteSetting(key("session_cooldown_until", platform));
    return null;
  }
  return until;
}

export function isOnCooldown(platform: Platform): boolean {
  return cooldownUntil(platform) !== null;
}
