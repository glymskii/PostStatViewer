import { db } from "@/db/client";
import {
  accounts,
  posts,
  postSnapshots,
  scrapeRuns,
  type Platform,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { createBrowserContext, randomDelay, saveState } from "./stealth";
import type { PlatformScraper, ScrapedItem } from "./types";
import { instagramScraper } from "@/scraper/platforms/instagram";
import { threadsScraper } from "@/scraper/platforms/threads";
import { tiktokScraper } from "@/scraper/platforms/tiktok";

const REGISTRY: Record<Platform, PlatformScraper> = {
  instagram: instagramScraper,
  threads: threadsScraper,
  tiktok: tiktokScraper,
};

export function getScraper(platform: Platform): PlatformScraper {
  return REGISTRY[platform];
}

let isRunning = false;

export function isScrapeRunning(): boolean {
  return isRunning;
}

interface RunResult {
  status: "success" | "failed";
  postsScraped: number;
  error?: string;
}

/**
 * Persist a list of scraped items: upsert posts and append a snapshot to each.
 * Shared between full-profile scrapes and single-item scrapes.
 */
function persistItems(accountId: number, items: ScrapedItem[]): number {
  let savedCount = 0;
  for (const item of items) {
    let post = db
      .select()
      .from(posts)
      .where(
        and(eq(posts.accountId, accountId), eq(posts.externalId, item.externalId))
      )
      .get();

    if (!post) {
      post = db
        .insert(posts)
        .values({
          accountId,
          externalId: item.externalId,
          postUrl: item.postUrl,
          caption: item.caption,
          thumbnailUrl: item.thumbnailUrl,
        })
        .returning()
        .get();
    } else {
      const updates: Record<string, string> = {};
      if (item.thumbnailUrl && !post.thumbnailUrl)
        updates.thumbnailUrl = item.thumbnailUrl;
      if (item.caption && !post.caption) updates.caption = item.caption;
      if (Object.keys(updates).length > 0) {
        db.update(posts).set(updates).where(eq(posts.id, post.id)).run();
      }
    }

    db.insert(postSnapshots)
      .values({
        postId: post.id,
        viewCount: item.viewCount,
        likeCount: item.likeCount,
      })
      .run();

    savedCount++;
  }
  return savedCount;
}

export async function runScrapeForAccount(
  accountId: number
): Promise<RunResult> {
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

  const scraper = getScraper(account.platform);
  if (!scraper) {
    return {
      status: "failed",
      postsScraped: 0,
      error: `No scraper registered for platform: ${account.platform}`,
    };
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

  const context = await createBrowserContext({ platform: account.platform });

  try {
    let loggedIn = false;
    try {
      loggedIn = await scraper.ensureLoggedIn(context);
    } catch (authErr) {
      // Preserve the specific error message from the scraper's login flow.
      const msg = authErr instanceof Error ? authErr.message : String(authErr);
      throw new Error(`[${account.platform} auth] ${msg}`);
    }
    if (!loggedIn) {
      throw new Error(`Failed to authenticate scraper for ${account.platform}`);
    }

    // Preserve existing captions to avoid re-fetching when not present in feed.
    const existingPosts = db
      .select()
      .from(posts)
      .where(eq(posts.accountId, account.id))
      .all();
    const existingCaptions = new Map(
      existingPosts.filter((p) => p.caption).map((p) => [p.externalId, p.caption])
    );

    const items = await scraper.scrapeProfile(context, account.username);
    await saveState(context, account.platform);

    for (const item of items) {
      if (!item.caption && existingCaptions.has(item.externalId)) {
        item.caption = existingCaptions.get(item.externalId) || null;
      }
    }

    const savedCount = persistItems(account.id, items);

    db.update(scrapeRuns)
      .set({
        status: "success",
        postsScraped: savedCount,
        finishedAt: new Date().toISOString(),
      })
      .where(eq(scrapeRuns.id, runResult.id))
      .run();

    console.log(
      `[runner] ${account.platform}/@${account.username}: scraped ${savedCount} items`
    );
    return { status: "success", postsScraped: savedCount };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error(
      `[runner] ${account.platform}/@${account.username} failed:`,
      errorMessage
    );

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

    for (let i = 0; i < activeAccounts.length; i++) {
      await runScrapeForAccount(activeAccounts[i].id);
      if (i < activeAccounts.length - 1) {
        await randomDelay(30000, 60000);
      }
    }
  } finally {
    isRunning = false;
  }
}

/**
 * Scrape one item by direct URL and persist it. Used by /api/posts when
 * the user manually adds an old post to track.
 */
export async function scrapeAndPersistSingleItem(
  accountId: number,
  itemUrl: string
): Promise<{ ok: true; item: ScrapedItem } | { ok: false; error: string }> {
  const account = db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .get();
  if (!account) return { ok: false, error: "Account not found" };

  const scraper = getScraper(account.platform);
  if (!scraper)
    return { ok: false, error: `No scraper for ${account.platform}` };

  const parsed = scraper.parseItemUrl(itemUrl);
  if (!parsed) return { ok: false, error: "URL не распознан для платформы" };

  // Duplicate guard at runner level (UI already checks).
  const existing = db
    .select()
    .from(posts)
    .where(
      and(eq(posts.accountId, account.id), eq(posts.externalId, parsed.externalId))
    )
    .get();
  if (existing) return { ok: false, error: "Этот пост уже отслеживается" };

  const context = await createBrowserContext({ platform: account.platform });
  try {
    const loggedIn = await scraper.ensureLoggedIn(context);
    if (!loggedIn)
      return {
        ok: false,
        error: `Failed to authenticate scraper for ${account.platform}`,
      };

    const item = await scraper.scrapeSingleItem(context, parsed.canonicalUrl);
    await saveState(context, account.platform);
    persistItems(account.id, [item]);
    return { ok: true, item };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  } finally {
    await context.browser()?.close();
  }
}
