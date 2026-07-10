import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import {
  accounts,
  posts,
  postSnapshots,
  scrapeRuns,
  PLATFORMS,
  type Platform,
} from "@/db/schema";
import { eq, desc, count, avg } from "drizzle-orm";
import { getScraper } from "@/scraper/common/runner";

export async function GET() {
  const allAccounts = db.select().from(accounts).all();

  const enriched = allAccounts.map((account) => {
    const postCount = db
      .select({ count: count() })
      .from(posts)
      .where(eq(posts.accountId, account.id))
      .get();

    const lastRun = db
      .select()
      .from(scrapeRuns)
      .where(eq(scrapeRuns.accountId, account.id))
      .orderBy(desc(scrapeRuns.startedAt))
      .limit(1)
      .get();

    const latestSnapshots = db
      .select({ avgViews: avg(postSnapshots.viewCount) })
      .from(postSnapshots)
      .innerJoin(posts, eq(postSnapshots.postId, posts.id))
      .where(eq(posts.accountId, account.id))
      .get();

    return {
      ...account,
      postCount: postCount?.count ?? 0,
      lastScrapeAt: lastRun?.startedAt ?? null,
      lastScrapeStatus: lastRun?.status ?? null,
      avgViews: latestSnapshots?.avgViews
        ? Math.round(Number(latestSnapshots.avgViews))
        : 0,
    };
  });

  return NextResponse.json(enriched);
}

function extractUsernameFromInput(input: string, platform: Platform): string {
  let val = input.trim();

  // Strip URL prefix if present.
  const urlPatterns: Record<Platform, RegExp> = {
    instagram: /instagram\.com\/([^/?#]+)/,
    threads: /threads\.(?:com|net)\/@?([^/?#]+)/,
    tiktok: /tiktok\.com\/@?([^/?#]+)/,
  };
  const m = val.match(urlPatterns[platform]);
  if (m) val = m[1];

  // Strip leading @ and trailing slash.
  return val.replace(/^@/, "").replace(/\/$/, "");
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const clientName: string | undefined = body.clientName;
  const platformInput: string | undefined = body.platform;
  const usernameInput: string | undefined = body.username;
  const brand: string | null =
    typeof body.brand === "string" && body.brand.trim()
      ? body.brand.trim()
      : null;

  if (!usernameInput || !clientName || !platformInput) {
    return NextResponse.json(
      { error: "username, clientName и platform обязательны" },
      { status: 400 }
    );
  }
  if (!PLATFORMS.includes(platformInput as Platform)) {
    return NextResponse.json(
      { error: `Неизвестная платформа: ${platformInput}` },
      { status: 400 }
    );
  }
  const platform = platformInput as Platform;

  const username = extractUsernameFromInput(usernameInput, platform);
  if (!username) {
    return NextResponse.json(
      { error: "Не удалось извлечь username" },
      { status: 400 }
    );
  }

  const profileUrl = getScraper(platform).profileUrl(username);

  try {
    const account = db
      .insert(accounts)
      .values({ platform, username, clientName, brand, profileUrl })
      .returning()
      .get();

    return NextResponse.json(account, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE")) {
      return NextResponse.json(
        { error: "Аккаунт уже существует на этой платформе" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/accounts — edit account attribution.
 * Body: { id: number, brand?: string | null, clientName?: string }
 * Presence-checked ("brand" in body) so an explicit null clears the field.
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const id: number | undefined = body.id;
  if (!id) {
    return NextResponse.json({ error: "id обязателен" }, { status: 400 });
  }

  const updates: { brand?: string | null; clientName?: string } = {};
  if ("brand" in body) {
    updates.brand =
      typeof body.brand === "string" && body.brand.trim()
        ? body.brand.trim()
        : null;
  }
  if ("clientName" in body && typeof body.clientName === "string" && body.clientName.trim()) {
    updates.clientName = body.clientName.trim();
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "Нет полей для обновления (brand, clientName)" },
      { status: 400 }
    );
  }

  const updated = db
    .update(accounts)
    .set(updates)
    .where(eq(accounts.id, id))
    .returning()
    .get();
  if (!updated) {
    return NextResponse.json({ error: "Аккаунт не найден" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest) {
  const { id } = await request.json();
  db.update(accounts)
    .set({ isActive: false })
    .where(eq(accounts.id, id))
    .run();
  return NextResponse.json({ success: true });
}
