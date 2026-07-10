import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { accounts, posts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getScraper, scrapeAndPersistSingleItem } from "@/scraper/common/runner";

/**
 * POST /api/posts
 * Body: { accountId: number, postUrl: string }
 *
 * Adds an individual post by direct URL to be tracked. The platform is taken
 * from the account; the URL must match it. The scraper opens the post page,
 * extracts metrics, and inserts the first snapshot.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const accountId: number | undefined = body.accountId;
  // Accept both `postUrl` (v2) and legacy `reelUrl` (v1) field names.
  const url: string | undefined = body.postUrl || body.reelUrl;

  if (!accountId || !url) {
    return NextResponse.json(
      { error: "accountId и postUrl обязательны" },
      { status: 400 }
    );
  }

  const account = db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .get();
  if (!account) {
    return NextResponse.json({ error: "Аккаунт не найден" }, { status: 404 });
  }

  const scraper = getScraper(account.platform);
  const parsed = scraper.parseItemUrl(url);
  if (!parsed) {
    return NextResponse.json(
      {
        error: `Ссылка не распознана для платформы ${account.platform}. Проверьте формат.`,
      },
      { status: 400 }
    );
  }

  // Quick duplicate guard before launching the browser.
  const existing = db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.accountId, account.id),
        eq(posts.externalId, parsed.externalId)
      )
    )
    .get();
  if (existing) {
    return NextResponse.json(
      { error: "Этот пост уже отслеживается" },
      { status: 409 }
    );
  }

  const result = await scrapeAndPersistSingleItem(account.id, url);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const created = db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.accountId, account.id),
        eq(posts.externalId, parsed.externalId)
      )
    )
    .get();

  return NextResponse.json(created, { status: 201 });
}

/**
 * PATCH /api/posts — set team attribution for a post.
 * Body: { postId: number, team: string | null }
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const postId: number | undefined = body.postId;
  if (!postId || !("team" in body)) {
    return NextResponse.json(
      { error: "postId и team обязательны" },
      { status: 400 }
    );
  }

  const team: string | null =
    typeof body.team === "string" && body.team.trim() ? body.team.trim() : null;

  const updated = db
    .update(posts)
    .set({ team })
    .where(eq(posts.id, postId))
    .returning()
    .get();
  if (!updated) {
    return NextResponse.json({ error: "Пост не найден" }, { status: 404 });
  }
  return NextResponse.json(updated);
}
