import { db } from "@/db/client";
import { accounts, posts, postSnapshots, scrapeRuns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createBrowserContext, saveState, randomDelay } from "./stealth";
import { loginToInstagram } from "./auth";
import { scrapeReels, type ScrapedReel } from "./instagram";

let isRunning = false;

export function isScrapeRunning(): boolean {
  return isRunning;
}

export async function runScrapeForAccount(accountId: number): Promise<{
  status: string;
  postsScraped: number;
  error?: string;
}> {
  const account = db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .get();

  if (!account) {
    return { status: "failed", postsScraped: 0, error: "Account not found" };
  }

  if (!account.isActive) {
    return { status: "failed", postsScraped: 0, error: "Account is inactive" };
  }

  const startedAt = new Date().toISOString();
  const runResult = db
    .insert(scrapeRuns)
    .values({
      accountId: account.id,
      status: "in_progress",
      startedAt,
    })
    .returning()
    .get();

  const context = await createBrowserContext();

  try {
    // Login
    const username = process.env.INSTAGRAM_USERNAME;
    const password = process.env.INSTAGRAM_PASSWORD;
    const totpSecret = process.env.INSTAGRAM_TOTP_SECRET;

    if (!username || !password) {
      throw new Error("Instagram credentials not configured in .env.local");
    }

    const loggedIn = await loginToInstagram(
      context,
      username,
      password,
      totpSecret || undefined
    );

    if (!loggedIn) {
      throw new Error("Failed to login to Instagram");
    }

    // Get existing captions so we don't re-fetch them
    const existingPosts = db
      .select()
      .from(posts)
      .where(eq(posts.accountId, account.id))
      .all();
    const existingCaptions = new Map(
      existingPosts
        .filter((p) => p.caption)
        .map((p) => [p.instagramId, p.caption])
    );

    // Scrape reels
    const scrapedReels = await scrapeReels(context, account.reelsUrl);
    await saveState(context);

    // Fill in known captions to avoid re-fetching
    for (const reel of scrapedReels) {
      if (!reel.caption && existingCaptions.has(reel.instagramId)) {
        reel.caption = existingCaptions.get(reel.instagramId) || null;
      }
    }

    // Save to database
    let savedCount = 0;
    for (const reel of scrapedReels) {
      // Upsert post
      let post = db
        .select()
        .from(posts)
        .where(eq(posts.instagramId, reel.instagramId))
        .get();

      if (!post) {
        post = db
          .insert(posts)
          .values({
            accountId: account.id,
            instagramId: reel.instagramId,
            postUrl: reel.postUrl,
            caption: reel.caption,
            thumbnailUrl: reel.thumbnailUrl,
          })
          .returning()
          .get();
      } else {
        const updates: Record<string, string> = {};
        if (reel.thumbnailUrl && !post.thumbnailUrl)
          updates.thumbnailUrl = reel.thumbnailUrl;
        if (reel.caption && !post.caption) updates.caption = reel.caption;
        if (Object.keys(updates).length > 0) {
          db.update(posts)
            .set(updates)
            .where(eq(posts.id, post.id))
            .run();
        }
      }

      // Insert snapshot
      db.insert(postSnapshots)
        .values({
          postId: post.id,
          viewCount: reel.viewCount,
          likeCount: reel.likeCount,
        })
        .run();

      savedCount++;
    }

    // Update scrape run
    db.update(scrapeRuns)
      .set({
        status: "success",
        postsScraped: savedCount,
        finishedAt: new Date().toISOString(),
      })
      .where(eq(scrapeRuns.id, runResult.id))
      .run();

    console.log(
      `[runner] Successfully scraped ${savedCount} reels for @${account.username}`
    );
    return { status: "success", postsScraped: savedCount };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error(`[runner] Error scraping @${account.username}:`, errorMessage);

    db.update(scrapeRuns)
      .set({
        status: "failed",
        errorMessage,
        finishedAt: new Date().toISOString(),
      })
      .where(eq(scrapeRuns.id, runResult.id))
      .run();

    return { status: "failed", postsScraped: 0, error: errorMessage };
  } finally {
    await context.browser()?.close();
  }
}

export async function runScrapeForAllAccounts(): Promise<void> {
  if (isRunning) {
    console.log("[runner] Scrape already in progress, skipping");
    return;
  }

  isRunning = true;

  try {
    const activeAccounts = db
      .select()
      .from(accounts)
      .where(eq(accounts.isActive, true))
      .all();

    console.log(
      `[runner] Starting scrape for ${activeAccounts.length} account(s)`
    );

    for (const account of activeAccounts) {
      await runScrapeForAccount(account.id);
      // Delay between accounts to avoid detection
      if (activeAccounts.indexOf(account) < activeAccounts.length - 1) {
        await randomDelay(30000, 60000);
      }
    }
  } finally {
    isRunning = false;
  }
}
