import { NextRequest, NextResponse } from "next/server";
import { PLATFORMS, type Platform } from "@/db/schema";
import {
  platformCookieDomain,
  writeStorageState,
  type PlaywrightStorageState,
} from "@/scraper/common/stealth";

type SameSite = "Strict" | "Lax" | "None";

/**
 * Cookie-Editor / EditThisCookie export shape (subset). They use
 * `expirationDate` (seconds since epoch, may be undefined for session
 * cookies) and `sameSite` lower-case ("lax" | "strict" | "none" | "no_restriction").
 */
interface UploadedCookie {
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
  expirationDate?: number;
  expires?: number; // some exporters use `expires`
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  hostOnly?: boolean;
  session?: boolean;
}

function normalizeSameSite(s: string | undefined): SameSite {
  if (!s) return "Lax";
  const lower = s.toLowerCase();
  if (lower === "strict") return "Strict";
  if (lower === "none" || lower === "no_restriction") return "None";
  return "Lax";
}

function toPlaywrightCookies(
  raw: UploadedCookie[]
): PlaywrightStorageState["cookies"] {
  return raw
    .filter((c) => c.name && typeof c.value === "string" && c.domain)
    .map((c) => {
      const expires =
        typeof c.expirationDate === "number"
          ? Math.floor(c.expirationDate)
          : typeof c.expires === "number"
          ? Math.floor(c.expires)
          : -1; // -1 = session cookie in Playwright
      return {
        name: c.name as string,
        value: c.value as string,
        domain: c.domain as string,
        path: c.path || "/",
        expires,
        httpOnly: Boolean(c.httpOnly),
        secure: Boolean(c.secure),
        sameSite: normalizeSameSite(c.sameSite),
      };
    });
}

/**
 * POST /api/sessions/upload
 * Body: { platform: Platform, cookies: UploadedCookie[] }
 *
 * Validates that a `sessionid` cookie for the platform's primary domain is
 * present, then writes a Playwright storageState JSON to disk so the next
 * scrape uses these cookies instead of attempting auto-login.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { platform, cookies } = (body || {}) as {
    platform?: string;
    cookies?: UploadedCookie[];
  };

  if (!platform || !PLATFORMS.includes(platform as Platform)) {
    return NextResponse.json(
      { error: `platform must be one of: ${PLATFORMS.join(", ")}` },
      { status: 400 }
    );
  }
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return NextResponse.json(
      { error: "cookies must be a non-empty array" },
      { status: 400 }
    );
  }

  const playwrightCookies = toPlaywrightCookies(cookies);
  if (playwrightCookies.length === 0) {
    return NextResponse.json(
      { error: "No valid cookies after parsing" },
      { status: 400 }
    );
  }

  const domain = platformCookieDomain(platform as Platform);
  const sessionCookie = playwrightCookies.find(
    (c) =>
      c.name === "sessionid" && c.domain.includes(domain) && c.value.length > 0
  );
  if (!sessionCookie) {
    return NextResponse.json(
      {
        error: `No "sessionid" cookie found for ${domain}. Make sure you exported cookies from the right site (and that you are logged in).`,
      },
      { status: 400 }
    );
  }

  const state: PlaywrightStorageState = {
    cookies: playwrightCookies,
    origins: [],
  };

  try {
    writeStorageState(platform as Platform, state);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to write storage state: ${msg}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    platform,
    cookieCount: playwrightCookies.length,
    sessionidExpires:
      sessionCookie.expires > 0
        ? new Date(sessionCookie.expires * 1000).toISOString()
        : null,
  });
}
