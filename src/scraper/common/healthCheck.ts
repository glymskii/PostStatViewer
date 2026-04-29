import cron, { type ScheduledTask } from "node-cron";
import { db } from "@/db/client";
import { accounts, scrapeRuns } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { notifyTelegram } from "./notify";

const STALE_THRESHOLD_HOURS = 36;
const STALE_THRESHOLD_MS = STALE_THRESHOLD_HOURS * 60 * 60 * 1000;

let task: ScheduledTask | null = null;

/**
 * Independent hourly cron that surfaces accounts which haven't had a
 * successful scrape in `STALE_THRESHOLD_HOURS`. Exists as a backstop in
 * case the main scheduler isn't ticking at all (already happened: 13-day
 * silent outage in April 2026 because no alerts existed).
 *
 * This cron does not perform any scraping itself — it only reads the DB
 * and dispatches Telegram alerts (which are deduped to once per 6h via
 * notify.ts). Cheap, safe to run on every Next.js process.
 */
export function startHealthCheck(): void {
  if (task) return;
  console.log("[healthCheck] Starting hourly stale-data watchdog");
  task = cron.schedule("0 * * * *", () => {
    runHealthCheck().catch((err) => {
      console.error("[healthCheck] tick failed:", err);
    });
  });

  // Also run once on startup so a deploy after an outage gets immediate
  // signal — but defer 30s to let migrations/scheduler settle first.
  setTimeout(() => {
    runHealthCheck().catch((err) =>
      console.error("[healthCheck] initial tick failed:", err)
    );
  }, 30_000);
}

export function stopHealthCheck(): void {
  if (task) {
    task.stop();
    task = null;
  }
}

export async function runHealthCheck(): Promise<void> {
  const activeAccounts = db
    .select()
    .from(accounts)
    .where(eq(accounts.isActive, true))
    .all();

  const now = Date.now();

  for (const acc of activeAccounts) {
    const lastSuccess = db
      .select()
      .from(scrapeRuns)
      .where(
        and(eq(scrapeRuns.accountId, acc.id), eq(scrapeRuns.status, "success"))
      )
      .orderBy(desc(scrapeRuns.startedAt))
      .limit(1)
      .get();

    let staleHours: number;
    if (!lastSuccess?.startedAt) {
      staleHours = Infinity;
    } else {
      const lastMs = new Date(lastSuccess.startedAt).getTime();
      staleHours = (now - lastMs) / (60 * 60 * 1000);
    }

    if (staleHours * (60 * 60 * 1000) >= STALE_THRESHOLD_MS) {
      const human =
        staleHours === Infinity
          ? "never"
          : `${Math.round(staleHours)}h ago`;
      await notifyTelegram({
        severity: "stale_data",
        platform: acc.platform,
        account: acc.username,
        message: `No successful scrape since ${human}. Check /settings.`,
        // Per-account dedup window of 12h: don't spam if it's been broken
        // for days, but still surface again the next morning.
        dedupKey: `last_alert_stale_${acc.platform}_${acc.username}`,
        dedupWindowMs: 12 * 60 * 60 * 1000,
      });
    }
  }
}
