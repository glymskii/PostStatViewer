import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accounts, scrapeRuns, PLATFORMS, type Platform } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import {
  hasStorageState,
  readStorageState,
  platformCookieDomain,
} from "@/scraper/common/stealth";

type SessionState = "ok" | "expired" | "missing";

interface PlatformStatus {
  state: SessionState;
  hasFile: boolean;
  hasSessionId: boolean;
  cookieExpiresAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
}

/**
 * GET /api/sessions/status
 * Returns per-platform session health derived from:
 *   1. presence of storage-state file on disk
 *   2. presence of `sessionid` cookie inside it
 *   3. cookie expiry (if any cookie has a future expires)
 *   4. recent scrape_runs records for that platform's accounts
 */
export async function GET() {
  const result: Record<Platform, PlatformStatus> = {} as Record<
    Platform,
    PlatformStatus
  >;

  for (const platform of PLATFORMS) {
    const hasFile = hasStorageState(platform);
    let hasSessionId = false;
    let cookieExpiresAt: string | null = null;

    if (hasFile) {
      const state = readStorageState(platform);
      if (state) {
        const domain = platformCookieDomain(platform);
        const sessionCookie = state.cookies.find(
          (c) =>
            c.name === "sessionid" &&
            c.domain.includes(domain) &&
            c.value.length > 0
        );
        if (sessionCookie) {
          hasSessionId = true;
          if (sessionCookie.expires && sessionCookie.expires > 0) {
            cookieExpiresAt = new Date(
              sessionCookie.expires * 1000
            ).toISOString();
          }
        }
      }
    }

    // Look at the most recent scrape_run for any account on this platform
    // to corroborate session validity.
    const platformAccounts = db
      .select()
      .from(accounts)
      .where(eq(accounts.platform, platform))
      .all();
    let lastSuccessAt: string | null = null;
    let lastFailureAt: string | null = null;
    let lastError: string | null = null;

    for (const acc of platformAccounts) {
      const lastSuccess = db
        .select()
        .from(scrapeRuns)
        .where(
          and(eq(scrapeRuns.accountId, acc.id), eq(scrapeRuns.status, "success"))
        )
        .orderBy(desc(scrapeRuns.startedAt))
        .limit(1)
        .get();
      if (
        lastSuccess?.startedAt &&
        (!lastSuccessAt || lastSuccess.startedAt > lastSuccessAt)
      ) {
        lastSuccessAt = lastSuccess.startedAt;
      }

      const lastFailure = db
        .select()
        .from(scrapeRuns)
        .where(
          and(eq(scrapeRuns.accountId, acc.id), eq(scrapeRuns.status, "failed"))
        )
        .orderBy(desc(scrapeRuns.startedAt))
        .limit(1)
        .get();
      if (
        lastFailure?.startedAt &&
        (!lastFailureAt || lastFailure.startedAt > lastFailureAt)
      ) {
        lastFailureAt = lastFailure.startedAt;
        lastError = lastFailure.errorMessage;
      }
    }

    let state: SessionState;
    if (!hasFile || !hasSessionId) {
      state = "missing";
    } else if (
      lastFailureAt &&
      lastError?.includes("NEEDS_MANUAL_SESSION") &&
      (!lastSuccessAt || lastFailureAt > lastSuccessAt)
    ) {
      state = "expired";
    } else if (
      cookieExpiresAt &&
      new Date(cookieExpiresAt).getTime() < Date.now()
    ) {
      state = "expired";
    } else {
      state = "ok";
    }

    result[platform] = {
      state,
      hasFile,
      hasSessionId,
      cookieExpiresAt,
      lastSuccessAt,
      lastFailureAt,
      lastError,
    };
  }

  return NextResponse.json(result);
}
