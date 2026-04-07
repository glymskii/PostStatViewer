import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { accounts, posts, postSnapshots, scrapeRuns } from "@/db/schema";
import { eq, desc, count, avg, max } from "drizzle-orm";

export async function GET() {
  const allAccounts = db.select().from(accounts).all();

  // Enrich with stats
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

    // Get average views from latest snapshots
    const latestSnapshots = db
      .select({
        avgViews: avg(postSnapshots.viewCount),
      })
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

export async function POST(request: NextRequest) {
  const body = await request.json();
  const clientName = body.clientName;
  let username = body.username;

  if (!username || !clientName) {
    return NextResponse.json(
      { error: "username и clientName обязательны" },
      { status: 400 }
    );
  }

  // Extract username from various formats:
  // "https://www.instagram.com/salam_bro/reels/"
  // "https://instagram.com/salam_bro"
  // "@salam_bro"
  // "salam_bro"
  username = username.trim();
  const urlMatch = username.match(/instagram\.com\/([^/?]+)/);
  if (urlMatch) {
    username = urlMatch[1];
  }
  username = username.replace(/^@/, "").replace(/\/$/, "");

  const reelsUrl = `https://www.instagram.com/${username}/reels/`;

  try {
    const account = db
      .insert(accounts)
      .values({ username, clientName, reelsUrl })
      .returning()
      .get();

    return NextResponse.json(account, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE")) {
      return NextResponse.json(
        { error: "Аккаунт уже существует" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { id } = await request.json();

  db.update(accounts)
    .set({ isActive: false })
    .where(eq(accounts.id, id))
    .run();

  return NextResponse.json({ success: true });
}
