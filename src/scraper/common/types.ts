import type { BrowserContext } from "playwright-core";
import type { Platform } from "@/db/schema";

/**
 * One scraped item from any social platform (Instagram reel, Threads post, TikTok video).
 * Field names are deliberately platform-agnostic.
 */
export interface ScrapedItem {
  externalId: string;
  postUrl: string;
  caption: string | null;
  thumbnailUrl: string | null;
  viewCount: number | null;
  likeCount: number | null;
  /** Comment count (Threads: replies). Best-effort — null when the page doesn't expose it. */
  commentCount: number | null;
}

/**
 * Common interface implemented by every platform-specific scraper.
 * The runner picks an implementation based on `account.platform`.
 */
export interface PlatformScraper {
  platform: Platform;

  /**
   * Build the canonical profile URL for a given username on this platform.
   */
  profileUrl(username: string): string;

  /**
   * Try to extract a post's externalId from a user-provided URL.
   * Returns null if the URL doesn't belong to this platform or is malformed.
   */
  parseItemUrl(
    url: string
  ): { externalId: string; canonicalUrl: string } | null;

  /**
   * Scrape the most recent items from a profile (typically last ~12).
   */
  scrapeProfile(
    context: BrowserContext,
    username: string
  ): Promise<ScrapedItem[]>;

  /**
   * Scrape a single item by direct URL (used for manually-added old posts).
   */
  scrapeSingleItem(
    context: BrowserContext,
    url: string
  ): Promise<ScrapedItem>;

  /**
   * Ensure the browser context is authenticated for this platform.
   * Returns true if logged in (or no login required).
   * Implementations may rely on a persisted storageState file.
   */
  ensureLoggedIn(context: BrowserContext): Promise<boolean>;
}
