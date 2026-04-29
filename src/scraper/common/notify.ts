import { db } from "@/db/client";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { Platform } from "@/db/schema";

export type AlertSeverity =
  | "session_stale"
  | "scrape_failed"
  | "stale_data"
  | "test";

interface NotifyPayload {
  severity: AlertSeverity;
  platform?: Platform;
  account?: string;
  message: string;
  /**
   * Dedup key. Same severity+platform+account is rate-limited to once per
   * `dedupWindowMs`. Pass a custom key to override default grouping.
   */
  dedupKey?: string;
  /** ms; default 6 hours */
  dedupWindowMs?: number;
}

const DEFAULT_DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000;

function getSetting(key: string): string | null {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

function setSetting(key: string, value: string): void {
  const existing = db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  if (existing) {
    db.update(settings).set({ value }).where(eq(settings.key, key)).run();
  } else {
    db.insert(settings).values({ key, value }).run();
  }
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export function getTelegramConfig(): TelegramConfig | null {
  const botToken = getSetting("telegram_bot_token");
  const chatId = getSetting("telegram_chat_id");
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

const SEVERITY_PREFIX: Record<AlertSeverity, string> = {
  session_stale: "🔒 Session expired",
  scrape_failed: "⚠️ Scrape failed",
  stale_data: "⏰ No fresh data",
  test: "✅ Test",
};

export function formatAlertText(payload: NotifyPayload): string {
  const parts: string[] = [SEVERITY_PREFIX[payload.severity]];
  if (payload.platform) parts.push(`[${payload.platform}]`);
  if (payload.account) parts.push(`@${payload.account}`);
  parts.push("—", payload.message);
  return parts.join(" ");
}

/**
 * Send via Telegram Bot API. Failures are logged, never thrown — alerts
 * must never break the calling flow.
 */
export async function sendTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = getTelegramConfig();
  if (!cfg) {
    console.log("[notify] Telegram not configured, skipping alert:", text);
    return { ok: false, error: "telegram_not_configured" };
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${cfg.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: cfg.chatId,
          text,
          disable_web_page_preview: true,
        }),
      }
    );
    if (!res.ok) {
      const body = await res.text();
      console.error("[notify] Telegram API error:", res.status, body);
      return { ok: false, error: `telegram_api_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[notify] Telegram send failed:", msg);
    return { ok: false, error: msg };
  }
}

/**
 * Top-level alert entry point with built-in dedup.
 */
export async function notifyTelegram(payload: NotifyPayload): Promise<void> {
  const dedupKey =
    payload.dedupKey ||
    `last_alert_${payload.severity}_${payload.platform || "global"}_${
      payload.account || ""
    }`;
  const window = payload.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS;

  const lastAtRaw = getSetting(dedupKey);
  if (lastAtRaw) {
    const lastAt = parseInt(lastAtRaw, 10);
    if (!Number.isNaN(lastAt) && Date.now() - lastAt < window) {
      console.log(
        `[notify] Suppressed (dedup) ${payload.severity} ${payload.platform || ""} ${payload.account || ""}`
      );
      return;
    }
  }

  const text = formatAlertText(payload);
  const result = await sendTelegram(text);
  if (result.ok) {
    setSetting(dedupKey, String(Date.now()));
  }
}
