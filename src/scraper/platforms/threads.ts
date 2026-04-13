import type { BrowserContext } from "playwright-core";
import {
  parseCompactNumber,
  randomDelay,
  saveState,
} from "@/scraper/common/stealth";
import type { PlatformScraper, ScrapedItem } from "@/scraper/common/types";
import { instagramScraper } from "@/scraper/platforms/instagram";

const PLATFORM = "threads" as const;
const MAX_POSTS = 12;

// Threads moved its public domain from threads.net → threads.com in 2025;
// threads.net still works as a 301 redirect but cookies and the login UI
// are served from threads.com.
const THREADS_HOST = "https://www.threads.com";

/**
 * Threads post URLs:
 *   https://www.threads.net/@username/post/CXXXxxx
 *   https://www.threads.net/@username/post/CXXXxxx/
 *   https://www.threads.net/t/CXXXxxx     (legacy)
 *   https://www.threads.net/post/CXXXxxx  (rare)
 */
function extractThreadsId(url: string): string | null {
  const m1 = url.match(/\/(?:@[^/]+\/)?post\/([^/?#]+)/);
  if (m1) return m1[1];
  const m2 = url.match(/\/t\/([^/?#]+)/);
  if (m2) return m2[1];
  return null;
}

/**
 * Check if the browser context has a valid threads.com session cookie.
 * Cookie-based check is more reliable than DOM inspection — Threads' markup
 * is opaque and login CTAs can appear in modals even for authenticated users.
 */
async function hasThreadsSession(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies([
    "https://www.threads.com/",
    "https://www.threads.net/",
  ]);
  return cookies.some(
    (c) =>
      c.name === "sessionid" &&
      (c.domain.includes("threads.com") || c.domain.includes("threads.net"))
  );
}

/**
 * Perform the Meta SSO handoff from Instagram → Threads. Assumes the context
 * already carries a valid instagram.com session (the Instagram scraper logs
 * in first and shares the storage state via stealth.ts STATE_KEY). Visits
 * threads.com/login, clicks "Continue with Instagram" / "Continue as
 * @{username}", and waits for threads.com cookies to be set.
 */
async function threadsSsoHandoff(
  context: BrowserContext,
  igUsername: string
): Promise<void> {
  if (await hasThreadsSession(context)) {
    console.log("[threads] Already has threads.com session cookies");
    return;
  }

  const page = await context.newPage();
  try {
    console.log("[threads] Performing Meta SSO handoff from Instagram...");
    await page.goto(`${THREADS_HOST}/login`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await randomDelay(2000, 4000);

    // Threads login page shows one of:
    //   "Continue with Instagram"  (universal SSO entry point)
    //   "Continue as @{username}"  (when an active IG session cookie is detected)
    // Try the username-specific selectors first, then fall back to the generic
    // "Continue with Instagram" button. Never click bare "Continue" — that's
    // the credential form submit.
    const ssoSelectors = [
      `div[role="button"]:has-text("Continue as ${igUsername}")`,
      `div[role="button"]:has-text("Continue as @${igUsername}")`,
      `a:has-text("Continue as ${igUsername}")`,
      `a:has-text("Continue as @${igUsername}")`,
      `button:has-text("Continue as ${igUsername}")`,
      `button:has-text("Continue as @${igUsername}")`,
      'div[role="button"]:has-text("Continue with Instagram")',
      'a:has-text("Continue with Instagram")',
      'button:has-text("Continue with Instagram")',
    ];

    let clickedSelector: string | null = null;
    for (const selector of ssoSelectors) {
      const btn = await page.$(selector);
      if (btn) {
        console.log(`[threads] Clicking SSO button: ${selector}`);
        await Promise.all([
          page
            .waitForURL((url) => !url.pathname.includes("/login"), {
              timeout: 20000,
            })
            .catch(() => null),
          btn.click(),
        ]);
        clickedSelector = selector;
        break;
      }
    }

    if (!clickedSelector) {
      const snippet = (
        await page.$eval("body", (el) => el.innerText.slice(0, 800))
      )
        .replace(/\s+/g, " ")
        .trim();
      const url = page.url();
      throw new Error(
        `Threads SSO button not found at ${url}. Tried "Continue as ${igUsername}" and "Continue with Instagram". Page: ${snippet}`
      );
    }

    await randomDelay(3000, 5000);

    // Dismiss optional post-SSO prompts ("Save login info?", "Turn on notifications").
    for (const text of ["Not now", "Not Now", "Save info", "Save Info"]) {
      const btn = await page.$(`button:has-text("${text}")`);
      if (btn) {
        await btn.click();
        await randomDelay(1000, 2000);
      }
    }

    if (!(await hasThreadsSession(context))) {
      const snippet = (
        await page
          .$eval("body", (el) => el.innerText.slice(0, 800))
          .catch(() => "<no body>")
      )
        .replace(/\s+/g, " ")
        .trim();
      const url = page.url();
      throw new Error(
        `Threads SSO clicked (${clickedSelector}) but no sessionid cookie set. URL=${url} Page=${snippet}`
      );
    }
    console.log("[threads] SSO handoff successful");
  } finally {
    await page.close();
  }
}

// DOM extractor for a single Threads post page.
const postPageEvaluate = () => {
  let caption: string | null = null;
  let views: string | null = null;
  let likes: string | null = null;
  let thumbnail: string | null = null;

  // --- og:description: format like "username on Threads: \"Caption text\"" or "X likes - username on Threads"
  const ogDesc = document.querySelector('meta[property="og:description"]');
  const ogContent = ogDesc?.getAttribute("content") || "";
  if (ogContent) {
    const captionMatch = ogContent.match(/["\u201c](.+?)["\u201d]/);
    if (captionMatch) caption = captionMatch[1];
    const likeMatch = ogContent.match(/([\d,. ]+)\s*likes?/i);
    if (likeMatch) likes = likeMatch[1].replace(/\s/g, "");
  }

  // --- meta description fallback
  if (!caption) {
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      const content = metaDesc.getAttribute("content") || "";
      const captionMatch = content.match(/["\u201c](.+?)["\u201d]/);
      if (captionMatch) caption = captionMatch[1];
    }
  }

  // --- JSON-LD (Threads exposes interactionStatistic similarly to Instagram)
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const json = JSON.parse(script.textContent || "");
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        // Caption fallback from articleBody
        if (!caption && typeof item.articleBody === "string") {
          caption = item.articleBody;
        }
        if (!caption && typeof item.text === "string") {
          caption = item.text;
        }
        if (item.interactionStatistic) {
          const stats = Array.isArray(item.interactionStatistic)
            ? item.interactionStatistic
            : [item.interactionStatistic];
          for (const stat of stats) {
            const type = stat.interactionType?.["@type"] || stat.interactionType;
            const count = stat.userInteractionCount;
            if (count == null) continue;
            if (
              typeof type === "string" &&
              (type.includes("Watch") || type.includes("View"))
            ) {
              views = String(count);
            } else if (typeof type === "string" && type.includes("Like")) {
              likes = String(count);
            }
          }
        }
      }
    } catch {}
  }

  // --- span scan for views/likes/replies
  const allSpans = document.querySelectorAll("span");
  for (const el of allSpans) {
    const text = el.textContent?.trim() || "";
    if (!views) {
      const m = text.match(/^([\d,.]+[KkMmBb]?)\s*(views?|просмотр\w*)/i);
      if (m) views = m[1];
    }
    if (!likes) {
      const m = text.match(/^([\d,.]+[KkMmBb]?)\s*(likes?|лайк\w*)/i);
      if (m) likes = m[1];
    }
    if (views && likes) break;
  }

  // --- aria-label scan
  if (!views || !likes) {
    const labeled = document.querySelectorAll("[aria-label]");
    for (const el of labeled) {
      const label = el.getAttribute("aria-label") || "";
      if (!views) {
        const m = label.match(/([\d,.]+[KkMmBb]?)\s*(views?|просмотр\w*)/i);
        if (m) views = m[1];
      }
      if (!likes) {
        const m = label.match(/([\d,.]+[KkMmBb]?)\s*(likes?|лайк\w*)/i);
        if (m) likes = m[1];
      }
      if (views && likes) break;
    }
  }

  // --- innerText fallback (Threads SPA doesn't populate meta tags reliably)
  // body.innerText format: "Thread {N} views {username} {date} {POST TEXT} Translate ..."
  if (!caption) {
    const body = (document.body?.innerText || "").trim();
    // Strip the header: "Thread\n{N} views\n{username}\n{date}\n"
    // Then take everything before "Translate" / "View activity" / "Reply"
    const headerEnd = body.search(
      /\n(?:\d{2}\/\d{2}\/\d{2,4}|\d+[hm]|\d+d|\d+w|yesterday|just now)/i
    );
    if (headerEnd > 0) {
      // Find the line after the date
      const afterDate = body.indexOf("\n", headerEnd + 1);
      if (afterDate > 0) {
        let postText = body.slice(afterDate + 1);
        // Cut off trailing UI elements
        for (const cutoff of ["\nTranslate", "\nView activity", "\nReply", "\nLike", "\nShare"]) {
          const idx = postText.indexOf(cutoff);
          if (idx > 0) postText = postText.slice(0, idx);
        }
        postText = postText.trim();
        if (postText.length >= 5) {
          caption = postText;
        }
      }
    }
  }

  // --- thumbnail
  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage) thumbnail = ogImage.getAttribute("content");
  if (!thumbnail) {
    const video = document.querySelector("video");
    if (video?.poster) thumbnail = video.poster;
  }
  if (!thumbnail) {
    const img = document.querySelector("article img, main img");
    if (img) thumbnail = img.getAttribute("src");
  }

  return { caption, views, likes, thumbnail };
};

async function scrapeProfile(
  context: BrowserContext,
  username: string
): Promise<ScrapedItem[]> {
  const profileUrl = `${THREADS_HOST}/@${username}`;
  const page = await context.newPage();
  const results: ScrapedItem[] = [];

  try {
    console.log(`[threads] Navigating to ${profileUrl}`);
    await page.goto(profileUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await randomDelay(3000, 5000);

    // Wait for any post link to appear.
    await page
      .waitForSelector("a[href*='/post/']", { timeout: 15000 })
      .catch(() => {
        console.log("[threads] No post links found initially");
      });

    const seen = new Set<string>();
    let noNewCount = 0;

    while (results.length < MAX_POSTS && noNewCount < 3) {
      // Collect all original-post links from the current viewport.
      // Skip reply threads — original posts on a profile use /@username/post/{id} pattern.
      const items = await page.$$eval(
        "a[href*='/post/']",
        (links, expectedUser) => {
          return links
            .map((link) => {
              const href = link.getAttribute("href") || "";
              // Match only this user's own posts to filter out reposts/quotes/replies-to-others.
              const ownPost = href.match(
                new RegExp(`^/@${expectedUser}/post/([^/?#]+)`)
              );
              if (!ownPost) return null;

              const article = link.closest("article, div[role='article']");
              const root: Element = article || link;

              // Snippet of text content for caption fallback.
              let captionText: string | null = null;
              const textSpans = root.querySelectorAll("span, div");
              for (const el of textSpans) {
                const t = el.textContent?.trim() || "";
                if (t.length > 20 && t.length < 500) {
                  captionText = t;
                  break;
                }
              }

              // First image inside the article serves as thumbnail.
              let thumb: string | null = null;
              const img = root.querySelector("img[srcset], img");
              if (img) thumb = img.getAttribute("src") || null;
              if (!thumb) {
                const video = root.querySelector("video");
                if (video) thumb = video.getAttribute("poster") || null;
              }

              return {
                externalId: ownPost[1],
                href,
                captionText,
                thumb,
              };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);
        },
        username
      );

      let newFound = 0;
      for (const item of items) {
        if (results.length >= MAX_POSTS) break;
        if (seen.has(item.externalId)) continue;
        seen.add(item.externalId);
        newFound++;

        results.push({
          externalId: item.externalId,
          postUrl: `${THREADS_HOST}${item.href}`,
          caption: item.captionText?.substring(0, 200) || null,
          thumbnailUrl: item.thumb,
          // View/like counts on profile feed are unreliable in Threads;
          // we always re-visit the post page to get accurate metrics.
          viewCount: null,
          likeCount: null,
        });
      }

      if (newFound === 0) noNewCount++;
      else noNewCount = 0;

      if (results.length < MAX_POSTS) {
        await page.evaluate(() => window.scrollBy(0, 1200));
        await randomDelay(2000, 4000);
      }
    }

    if (results.length === 0) {
      const diag = await page
        .evaluate(() => {
          const allLinks = Array.from(document.querySelectorAll("a"))
            .map((a) => a.getAttribute("href") || "")
            .filter(Boolean);
          const postLinks = allLinks.filter((h) => /\/post\//.test(h));
          return {
            url: location.href,
            title: document.title,
            linkCount: allLinks.length,
            postLinkCount: postLinks.length,
            sampleLinks: allLinks.slice(0, 30),
            postLinkSample: postLinks.slice(0, 10),
            body: (document.body?.innerText || "")
              .slice(0, 600)
              .replace(/\s+/g, " ")
              .trim(),
          };
        })
        .catch(() => null);
      console.log(
        `[threads][DIAG] zero posts found; page=${JSON.stringify(diag)}`
      );
    }
    console.log(`[threads] Collected ${results.length} posts from profile`);

    // Visit each post to extract views/likes/caption.
    for (const item of results) {
      try {
        await page.goto(item.postUrl, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        await randomDelay(1500, 3000);

        // Wait for Threads SPA to render post content.
        await page
          .waitForSelector('div[dir="auto"], article, [data-pressable-container]', {
            timeout: 10000,
          })
          .catch(() => null);
        await randomDelay(1000, 2000);

        const data = await page.evaluate(postPageEvaluate);

        // If still no caption, dump a snippet for debugging.
        if (!data.caption) {
          const bodySnippet = await page
            .evaluate(() =>
              (document.body?.innerText || "").slice(0, 400).replace(/\s+/g, " ").trim()
            )
            .catch(() => "");
          console.log(
            `[threads][DIAG] no caption for ${item.externalId}: body=${bodySnippet}`
          );
        }

        if (data.caption) item.caption = data.caption.substring(0, 200);
        if (data.views) item.viewCount = parseCompactNumber(data.views);
        if (data.likes) item.likeCount = parseCompactNumber(data.likes);
        if (data.thumbnail && !item.thumbnailUrl)
          item.thumbnailUrl = data.thumbnail;

        console.log(
          `[threads] ${item.externalId}: views=${item.viewCount}, likes=${item.likeCount}, caption=${item.caption ? item.caption.slice(0, 40) + "..." : "null"}`
        );
      } catch {
        console.log(`[threads] Failed to enrich ${item.externalId}`);
      }
    }

    return results;
  } catch (err) {
    console.error("[threads] scrapeProfile error:", err);
    return results;
  } finally {
    await page.close();
  }
}

export const threadsScraper: PlatformScraper = {
  platform: PLATFORM,

  profileUrl(username) {
    return `${THREADS_HOST}/@${username}`;
  },

  parseItemUrl(url) {
    // Accept both threads.com (current) and threads.net (legacy redirect).
    if (!/threads\.(com|net)/.test(url)) return null;
    const id = extractThreadsId(url);
    if (!id) return null;
    // Canonical form using threads.com.
    const userMatch = url.match(/threads\.(?:com|net)\/@([^/]+)\/post\//);
    const canonical = userMatch
      ? `${THREADS_HOST}/@${userMatch[1]}/post/${id}`
      : `${THREADS_HOST}/post/${id}`;
    return { externalId: id, canonicalUrl: canonical };
  },

  async ensureLoggedIn(context) {
    const igUsername = process.env.INSTAGRAM_USERNAME;
    if (!igUsername) {
      throw new Error(
        "INSTAGRAM_USERNAME not configured (Threads reuses Meta SSO)"
      );
    }

    // Step 1: ensure Instagram is logged in. Uses the shared storage state
    // (see STATE_KEY in stealth.ts) so the cookie jar carries over.
    const igLoggedIn = await instagramScraper.ensureLoggedIn(context);
    if (!igLoggedIn) {
      throw new Error(
        "Threads requires a valid Instagram session but IG login failed"
      );
    }

    // Step 2: perform the threads.net SSO handoff so threads.net cookies
    // are set. Idempotent — skipped if already logged in.
    await threadsSsoHandoff(context, igUsername);
    await saveState(context, PLATFORM);
    return true;
  },

  async scrapeProfile(context, username) {
    return scrapeProfile(context, username);
  },

  async scrapeSingleItem(context, url) {
    const id = extractThreadsId(url) || "";
    const page = await context.newPage();
    try {
      console.log(`[threads] Scraping single post: ${url}`);
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await randomDelay(2000, 4000);

      const data = await page.evaluate(postPageEvaluate);

      const result: ScrapedItem = {
        externalId: id,
        postUrl: url,
        caption: data.caption?.substring(0, 200) || null,
        thumbnailUrl: data.thumbnail,
        viewCount: data.views ? parseCompactNumber(data.views) : null,
        likeCount: data.likes ? parseCompactNumber(data.likes) : null,
      };
      console.log(
        `[threads] Single post ${id}: views=${result.viewCount}, likes=${result.likeCount}`
      );
      return result;
    } finally {
      await page.close();
    }
  },
};
