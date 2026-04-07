import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { posts, postSnapshots } from "@/db/schema";
import { eq } from "drizzle-orm";

function extractReelId(input: string): string | null {
  const match = input.match(/\/(reel|p)\/([^/?]+)/);
  return match ? match[2] : null;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { accountId, reelUrl } = body;

  if (!accountId || !reelUrl) {
    return NextResponse.json(
      { error: "accountId и reelUrl обязательны" },
      { status: 400 }
    );
  }

  const instagramId = extractReelId(reelUrl);
  if (!instagramId) {
    return NextResponse.json(
      { error: "Неверная ссылка на рилс. Пример: https://www.instagram.com/reel/ABC123/" },
      { status: 400 }
    );
  }

  // Check duplicates
  const existing = db
    .select()
    .from(posts)
    .where(eq(posts.instagramId, instagramId))
    .get();

  if (existing) {
    return NextResponse.json(
      { error: "Этот рилс уже отслеживается" },
      { status: 409 }
    );
  }

  // Normalize URL
  const normalizedUrl = `https://www.instagram.com/reel/${instagramId}/`;

  // Create post record (without scraping - caption/thumbnail/views will be filled on next scrape)
  const post = db
    .insert(posts)
    .values({
      accountId: parseInt(accountId),
      instagramId,
      postUrl: normalizedUrl,
      caption: null,
      thumbnailUrl: null,
    })
    .returning()
    .get();

  // Try to scrape data for this single reel in the background
  try {
    const { scrapeSingleReel } = await import("@/scraper/instagram");
    const { createBrowserContext, saveState } = await import(
      "@/scraper/stealth"
    );
    const { loginToInstagram } = await import("@/scraper/auth");

    const username = process.env.INSTAGRAM_USERNAME;
    const password = process.env.INSTAGRAM_PASSWORD;
    const totpSecret = process.env.INSTAGRAM_TOTP_SECRET;

    if (username && password) {
      const context = await createBrowserContext();
      try {
        const loggedIn = await loginToInstagram(
          context,
          username,
          password,
          totpSecret || undefined
        );

        if (loggedIn) {
          const reelData = await scrapeSingleReel(context, normalizedUrl);
          await saveState(context);

          // Update post with scraped data
          const updates: Record<string, string | null> = {};
          if (reelData.caption) updates.caption = reelData.caption;
          if (reelData.thumbnailUrl) updates.thumbnailUrl = reelData.thumbnailUrl;
          if (Object.keys(updates).length > 0) {
            db.update(posts)
              .set(updates)
              .where(eq(posts.id, post.id))
              .run();
          }

          // Create first snapshot
          db.insert(postSnapshots)
            .values({
              postId: post.id,
              viewCount: reelData.viewCount,
              likeCount: reelData.likeCount,
            })
            .run();
        }
      } finally {
        await context.browser()?.close();
      }
    }
  } catch (err) {
    console.error("[api/reels] Failed to scrape single reel:", err);
    // Post was still created, just without initial data
  }

  // Re-fetch with any updates
  const updatedPost = db
    .select()
    .from(posts)
    .where(eq(posts.id, post.id))
    .get();

  return NextResponse.json(updatedPost, { status: 201 });
}
