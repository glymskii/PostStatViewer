import type { PlatformScraper } from "@/scraper/common/types";

/**
 * TikTok scraper — STUB for v2.1.
 * Full implementation is scheduled for v2.2 once Threads is validated.
 * The stub still implements profileUrl and parseItemUrl so accounts can be
 * created in the UI; only scraping operations throw NotImplementedError.
 */

const PLATFORM = "tiktok" as const;

function extractTikTokId(url: string): string | null {
  // Patterns:
  //   https://www.tiktok.com/@user/video/1234567890
  //   https://vm.tiktok.com/XXXX/  (short link, can't resolve without HTTP fetch)
  const m = url.match(/\/video\/(\d+)/);
  if (m) return m[1];
  return null;
}

function notImplemented(): never {
  throw new Error(
    "TikTok scraper is not yet implemented (planned for v2.2). " +
      "Account record can be created, but scraping will fail until then."
  );
}

export const tiktokScraper: PlatformScraper = {
  platform: PLATFORM,

  profileUrl(username) {
    return `https://www.tiktok.com/@${username}`;
  },

  parseItemUrl(url) {
    if (!/tiktok\.com/.test(url)) return null;
    const id = extractTikTokId(url);
    if (!id) return null;
    const userMatch = url.match(/tiktok\.com\/@([^/]+)\//);
    const canonical = userMatch
      ? `https://www.tiktok.com/@${userMatch[1]}/video/${id}`
      : `https://www.tiktok.com/video/${id}`;
    return { externalId: id, canonicalUrl: canonical };
  },

  async ensureLoggedIn() {
    notImplemented();
  },

  async scrapeProfile() {
    notImplemented();
  },

  async scrapeSingleItem() {
    notImplemented();
  },
};
