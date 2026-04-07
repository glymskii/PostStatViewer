import type { BrowserContext, Page } from "playwright-core";
import {
  parseCompactNumber,
  randomDelay,
  saveState,
} from "@/scraper/common/stealth";
import type { PlatformScraper, ScrapedItem } from "@/scraper/common/types";

const PLATFORM = "threads" as const;
const MAX_POSTS = 12;

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

async function typeHumanLike(page: Page, selector: string, text: string) {
  await page.click(selector);
  for (const char of text) {
    await page.keyboard.type(char, {
      delay: Math.floor(Math.random() * 100) + 50,
    });
  }
}

async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto("https://www.threads.net/", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await randomDelay(2000, 4000);
    // Threads shows a "Log in" button on the homepage when unauthenticated.
    // When logged in we typically see the composer / feed with no login prompt.
    const loginButton = await page.$(
      'a[href*="/login"], div[role="button"]:has-text("Log in"), a:has-text("Log in")'
    );
    if (loginButton) return false;
    // Cross-check: presence of search nav or compose button when authenticated.
    const composeOrNav = await page.$(
      'a[href="/search"], svg[aria-label*="Search"], svg[aria-label*="New thread"]'
    );
    return !!composeOrNav;
  } catch {
    return false;
  }
}

async function loginToThreads(
  context: BrowserContext,
  username: string,
  password: string
): Promise<boolean> {
  const page = await context.newPage();
  try {
    if (await isLoggedIn(page)) {
      console.log("[threads] Already logged in via saved session");
      await page.close();
      return true;
    }

    console.log("[threads] Logging in via Instagram credentials...");
    await page.goto("https://www.threads.net/login", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await randomDelay(2000, 4000);

    // Threads login form: username + password fields. Field names vary; try
    // common selectors. Instagram credentials work because Threads is Meta.
    const usernameSelector = await page
      .waitForSelector(
        'input[autocomplete="username"], input[name="username"], input[placeholder*="sername"], input[placeholder*="email"]',
        { timeout: 10000 }
      )
      .catch(() => null);
    const passwordSelector = await page
      .waitForSelector(
        'input[autocomplete="current-password"], input[name="password"], input[type="password"]',
        { timeout: 10000 }
      )
      .catch(() => null);

    if (!usernameSelector || !passwordSelector) {
      console.error("[threads] Login form not found");
      await page.close();
      return false;
    }

    const usernameSel =
      'input[autocomplete="username"], input[name="username"], input[placeholder*="sername"], input[placeholder*="email"]';
    const passwordSel =
      'input[autocomplete="current-password"], input[name="password"], input[type="password"]';

    await typeHumanLike(page, usernameSel, username);
    await randomDelay(500, 1000);
    await typeHumanLike(page, passwordSel, password);
    await randomDelay(500, 1500);

    // Submit: try button[type=submit] or div[role=button] with "Log in" text.
    const submit = await page.$(
      'button[type="submit"], div[role="button"]:has-text("Log in")'
    );
    if (submit) {
      await submit.click();
    } else {
      await page.keyboard.press("Enter");
    }
    await randomDelay(4000, 6000);

    // Dismiss "Save info?" / "Turn on notifications" prompts if any.
    for (const text of ["Not now", "Not Now", "Save info"]) {
      const btn = await page.$(`button:has-text("${text}")`);
      if (btn) {
        await btn.click();
        await randomDelay(1000, 2000);
      }
    }

    const ok = await isLoggedIn(page);
    if (ok) {
      console.log("[threads] Login successful");
      await saveState(context, PLATFORM);
    } else {
      console.error("[threads] Login failed — could not verify session");
    }
    await page.close();
    return ok;
  } catch (err) {
    console.error("[threads] Login error:", err);
    await page.close();
    return false;
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
  const profileUrl = `https://www.threads.net/@${username}`;
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
          postUrl: `https://www.threads.net${item.href}`,
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

    console.log(`[threads] Collected ${results.length} posts from profile`);

    // Visit each post to extract views/likes/caption.
    for (const item of results) {
      try {
        await page.goto(item.postUrl, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        await randomDelay(1500, 3000);

        const data = await page.evaluate(postPageEvaluate);

        if (data.caption) item.caption = data.caption.substring(0, 200);
        if (data.views) item.viewCount = parseCompactNumber(data.views);
        if (data.likes) item.likeCount = parseCompactNumber(data.likes);
        if (data.thumbnail && !item.thumbnailUrl)
          item.thumbnailUrl = data.thumbnail;

        console.log(
          `[threads] ${item.externalId}: views=${item.viewCount}, likes=${item.likeCount}`
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
    return `https://www.threads.net/@${username}`;
  },

  parseItemUrl(url) {
    if (!/threads\.net/.test(url)) return null;
    const id = extractThreadsId(url);
    if (!id) return null;
    // Canonical form (without username) — works on Threads as a redirect.
    const userMatch = url.match(/threads\.net\/@([^/]+)\/post\//);
    const canonical = userMatch
      ? `https://www.threads.net/@${userMatch[1]}/post/${id}`
      : `https://www.threads.net/post/${id}`;
    return { externalId: id, canonicalUrl: canonical };
  },

  async ensureLoggedIn(context) {
    const username = process.env.INSTAGRAM_USERNAME;
    const password = process.env.INSTAGRAM_PASSWORD;
    if (!username || !password) {
      throw new Error("Instagram credentials not configured (Threads reuses them)");
    }
    return loginToThreads(context, username, password);
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
