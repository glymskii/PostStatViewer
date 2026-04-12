import type { BrowserContext, Page } from "playwright-core";
// (helpers below take BrowserContext to inspect cookies)
import {
  parseCompactNumber,
  randomDelay,
  saveState,
} from "@/scraper/common/stealth";
import type { PlatformScraper, ScrapedItem } from "@/scraper/common/types";

const PLATFORM = "instagram" as const;

function extractInstagramId(url: string): string | null {
  const match = url.match(/\/(reel|p)\/([^/?]+)/);
  return match ? match[2] : null;
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
  // Cheap check first: presence of a non-empty sessionid cookie. Necessary
  // but not sufficient — IG can keep stale cookies after server-side expiry.
  const context = page.context();
  const cookies = await context.cookies("https://www.instagram.com/");
  const sessionCookie = cookies.find((c) => c.name === "sessionid");
  if (!sessionCookie || !sessionCookie.value) return false;

  // Authoritative check: navigate to a route that requires auth and see if
  // IG redirects to /accounts/login/. /reels/ routes do gate, the homepage
  // doesn't always — so use the saved-collections page which always 302s
  // to /accounts/login/ for unauthenticated users.
  try {
    await page.goto("https://www.instagram.com/accounts/edit/", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await randomDelay(1500, 3000);
    if (page.url().includes("/accounts/login/")) return false;
    // Sanity: a login form on this page also means we got bounced.
    const loginForm = await page.$('input[name="email"]');
    return !loginForm;
  } catch {
    return false;
  }
}

async function loginToInstagram(
  context: BrowserContext,
  username: string,
  password: string,
  totpSecret?: string
): Promise<boolean> {
  const page = await context.newPage();
  try {
    if (await isLoggedIn(page)) {
      console.log("[instagram] Already logged in via saved session");
      await page.close();
      return true;
    }

    console.log("[instagram] Logging in...");
    await page.goto("https://www.instagram.com/accounts/login/", {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await randomDelay(2000, 4000);

    // Dismiss cookie consent — IG shows this in the EU / headless contexts.
    try {
      const cookieButton = await page.$(
        [
          'button:has-text("Allow all cookies")',
          'button:has-text("Allow essential and optional cookies")',
          'button:has-text("Accept all")',
          'button:has-text("Accept All")',
          'button:has-text("Decline optional cookies")',
        ].join(", ")
      );
      if (cookieButton) {
        console.log("[instagram] Dismissing cookie consent dialog");
        await cookieButton.click();
        await randomDelay(1500, 3000);
      }
    } catch {}

    // Wait for the login form — increased timeout, IG sometimes loads slowly.
    try {
      await page.waitForSelector('input[name="email"]', { timeout: 20000 });
    } catch {
      // Diagnostic: dump page state so we can see what's blocking.
      const diag = await page
        .evaluate(() => ({
          url: location.href,
          title: document.title,
          body: (document.body?.innerText || "").slice(0, 600).replace(/\s+/g, " ").trim(),
          inputs: Array.from(document.querySelectorAll("input")).map(
            (i) => `name=${i.name} type=${i.type}`
          ),
        }))
        .catch(() => null);
      console.error(
        `[instagram] Login form not found; page=${JSON.stringify(diag)}`
      );
      throw new Error("Login form input[name='email'] not found");
    }
    // Use fill() instead of click+type — immune to overlay visibility issues.
    await page.fill('input[name="email"]', username);
    await randomDelay(500, 1000);
    await page.fill('input[name="pass"]', password);
    await randomDelay(500, 1500);
    // IG uses input[type="submit"] (not button) since ~2026.
    // Cookie consent overlay makes the element "not visible" to Playwright,
    // even with force:true. Use raw JS click to bypass entirely.
    await page.$eval('[type="submit"]', (el) => (el as HTMLElement).click());
    await randomDelay(5000, 8000);

    // Diagnostic: what does IG show after submit?
    const postSubmit = await page
      .evaluate(() => ({
        url: location.href,
        title: document.title,
        body: (document.body?.innerText || "").slice(0, 800).replace(/\s+/g, " ").trim(),
        inputs: Array.from(document.querySelectorAll("input")).map(
          (i) => `name=${i.name} type=${i.type}`
        ),
      }))
      .catch(() => null);
    console.log(`[instagram] Post-submit state: ${JSON.stringify(postSubmit)}`);

    const twoFactorInput = await page.$('input[name="verificationCode"]');
    if (twoFactorInput && totpSecret) {
      const { generateTOTP } = await import("@/scraper/totp");
      const code = generateTOTP(totpSecret);
      console.log("[instagram] Entering 2FA code...");
      await typeHumanLike(page, 'input[name="verificationCode"]', code);
      await randomDelay(500, 1000);
      const confirmButton = await page.$('button:has-text("Confirm")');
      if (confirmButton) {
        await confirmButton.click();
        await randomDelay(3000, 5000);
      }
    } else if (twoFactorInput) {
      console.error("[instagram] 2FA required but no TOTP secret configured");
      await page.close();
      return false;
    }

    try {
      const saveInfoButton = await page.$(
        'button:has-text("Save Info"), button:has-text("Save info")'
      );
      if (saveInfoButton) {
        await saveInfoButton.click();
        await randomDelay(2000, 3000);
      }
    } catch {}
    try {
      const notNowButton = await page.$(
        'button:has-text("Not Now"), button:has-text("Not now")'
      );
      if (notNowButton) {
        await notNowButton.click();
        await randomDelay(1000, 2000);
      }
    } catch {}

    const loggedIn = await isLoggedIn(page);
    if (loggedIn) {
      console.log("[instagram] Login successful");
      await saveState(context, PLATFORM);
    } else {
      console.error("[instagram] Login failed — could not verify session");
    }
    await page.close();
    return loggedIn;
  } catch (error) {
    console.error("[instagram] Login error:", error);
    await page.close();
    return false;
  }
}

// DOM extractor for a single reel page (used both for full scrape and single-reel add).
const reelPageEvaluate = () => {
  let caption: string | null = null;
  let views: string | null = null;
  let likes: string | null = null;
  let thumbnail: string | null = null;

  const ogDesc = document.querySelector('meta[property="og:description"]');
  const ogContent = ogDesc?.getAttribute("content") || "";

  if (ogContent) {
    const captionMatch = ogContent.match(
      /["\u201c](.+?)["\u201d]|:\s*["\u201c\u201d](.+?)["\u201c\u201d]$/
    );
    if (captionMatch) {
      caption = captionMatch[1] || captionMatch[2];
    } else {
      const colonMatch = ogContent.match(/:\s*(.+)/);
      if (colonMatch)
        caption = colonMatch[1].replace(/["\u201c\u201d\u201e]/g, "").trim();
    }
    const ogLikeMatch = ogContent.match(/([\d,. ]+)\s*likes?/i);
    if (ogLikeMatch) likes = ogLikeMatch[1].replace(/\s/g, "");
  }

  if (!caption) {
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      const content = metaDesc.getAttribute("content") || "";
      const captionMatch = content.match(/["\u201c](.+?)["\u201d]/);
      if (captionMatch) caption = captionMatch[1];
    }
  }
  if (!caption) {
    const h1 = document.querySelector("h1");
    if (h1?.textContent && h1.textContent.length > 5)
      caption = h1.textContent.trim();
  }

  const allSpans = document.querySelectorAll("span");
  for (const el of allSpans) {
    const text = el.textContent?.trim() || "";
    const viewMatch = text.match(
      /^([\d,.]+[KkMmBb]?)\s*(plays?|views?|просмотр\w*)/i
    );
    if (viewMatch && !views) {
      views = viewMatch[1];
      break;
    }
  }
  if (!views) {
    const elements = document.querySelectorAll("[aria-label]");
    for (const el of elements) {
      const label = el.getAttribute("aria-label") || "";
      const viewMatch = label.match(
        /([\d,.]+[KkMmBb]?)\s*(plays?|views?|просмотр)/i
      );
      if (viewMatch) {
        views = viewMatch[1];
        break;
      }
    }
  }
  if (!views) {
    const scripts = document.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    for (const script of scripts) {
      try {
        const json = JSON.parse(script.textContent || "");
        if (json.interactionStatistic) {
          const stats = Array.isArray(json.interactionStatistic)
            ? json.interactionStatistic
            : [json.interactionStatistic];
          for (const stat of stats) {
            if (
              stat["@type"] === "InteractionCounter" &&
              stat.interactionType?.["@type"] === "WatchAction"
            ) {
              views = String(stat.userInteractionCount);
              break;
            }
          }
        }
        if (json.video?.interactionCount) views = String(json.video.interactionCount);
      } catch {}
    }
  }
  if (!likes) {
    for (const el of allSpans) {
      const text = el.textContent?.trim() || "";
      const likeMatch = text.match(/^([\d,.]+[KkMmBb]?)\s*(likes?|лайк\w*)/i);
      if (likeMatch) {
        likes = likeMatch[1];
        break;
      }
    }
  }

  const video = document.querySelector("video");
  if (video?.poster) thumbnail = video.poster;
  else {
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage) thumbnail = ogImage.getAttribute("content");
  }

  return { caption, views, likes, thumbnail };
};

async function scrapeReelsGrid(
  context: BrowserContext,
  reelsUrl: string,
  maxReels = 12
): Promise<ScrapedItem[]> {
  const page = await context.newPage();
  const results: ScrapedItem[] = [];

  try {
    console.log(`[instagram] Navigating to ${reelsUrl}`);
    await page.goto(reelsUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await randomDelay(3000, 5000);

    await page
      .waitForSelector("a[href*='/reel/']", { timeout: 15000 })
      .catch(() => {
        console.log("[instagram] No reel links found initially, trying scroll");
      });

    const seenIds = new Set<string>();
    let noNewContentCount = 0;

    while (results.length < maxReels && noNewContentCount < 3) {
      const reelItems = await page.$$eval("a[href*='/reel/']", (links) => {
        return links.map((link) => {
          const href = link.getAttribute("href") || "";

          let viewText = "";
          let likeText = "";

          const viewSvg = link.querySelector(
            'svg[aria-label="View Count Icon"]'
          );
          if (viewSvg) {
            const container = viewSvg.closest("div.html-div")?.parentElement;
            if (container) {
              const spans = container.querySelectorAll("span.html-span");
              for (const s of spans) {
                const t = s.textContent?.trim() || "";
                if (t && /^[\d,.]+[KkMmBb]?$/.test(t)) {
                  viewText = t;
                  break;
                }
              }
            }
          }

          const listItems = link.querySelectorAll("ul li");
          if (listItems.length > 0) {
            const firstLi = listItems[0];
            const span = firstLi.querySelector("span.html-span");
            if (span) {
              const t = span.textContent?.trim() || "";
              if (/^[\d,.]+[KkMmBb]?$/.test(t)) likeText = t;
            }
          }

          let thumbnailUrl: string | null = null;
          const img = link.querySelector("img");
          if (img) thumbnailUrl = img.getAttribute("src") || null;
          if (!thumbnailUrl) {
            const video = link.querySelector("video");
            if (video) thumbnailUrl = video.getAttribute("poster") || null;
          }
          if (!thumbnailUrl) {
            const parent = link.closest("div");
            if (parent) {
              const parentImg = parent.querySelector("img");
              if (parentImg)
                thumbnailUrl = parentImg.getAttribute("src") || null;
            }
          }
          if (!thumbnailUrl) {
            const divWithBg = link.querySelector(
              "div[style*='background-image']"
            );
            if (divWithBg) {
              const style = divWithBg.getAttribute("style") || "";
              const bgMatch = style.match(/url\(["']?([^"')]+)["']?\)/);
              if (bgMatch) thumbnailUrl = bgMatch[1];
            }
          }

          return { href, viewText, likeText, thumbnailUrl };
        });
      });

      let newFound = 0;
      for (const item of reelItems) {
        if (results.length >= maxReels) break;
        const externalId = extractInstagramId(item.href);
        if (!externalId || seenIds.has(externalId)) continue;
        seenIds.add(externalId);
        newFound++;

        results.push({
          externalId,
          postUrl: `https://www.instagram.com${item.href}`,
          thumbnailUrl: item.thumbnailUrl,
          caption: null,
          viewCount: parseCompactNumber(item.viewText),
          likeCount: parseCompactNumber(item.likeText),
        });
      }

      if (newFound === 0) noNewContentCount++;
      else noNewContentCount = 0;

      if (results.length < maxReels) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await randomDelay(2000, 4000);
      }
    }

    if (results.length === 0) {
      // Diagnostic dump: nothing matched. Capture URL, link inventory, and a
      // body snippet so we can tell if IG redirected, hit a login wall, or
      // changed its DOM.
      const diag = await page
        .evaluate(() => {
          const allLinks = Array.from(document.querySelectorAll("a"))
            .map((a) => a.getAttribute("href") || "")
            .filter(Boolean);
          const sample = allLinks.slice(0, 30);
          const reelish = allLinks.filter((h) =>
            /\/(reel|reels|p)\//.test(h)
          );
          const body = (document.body?.innerText || "")
            .slice(0, 500)
            .replace(/\s+/g, " ")
            .trim();
          return {
            url: location.href,
            title: document.title,
            linkCount: allLinks.length,
            reelishCount: reelish.length,
            sampleLinks: sample,
            reelishSample: reelish.slice(0, 10),
            body,
          };
        })
        .catch(() => null);
      console.log(
        `[instagram][DIAG] zero reels found; page=${JSON.stringify(diag)}`
      );
    }
    console.log(`[instagram] Collected ${results.length} reels from grid`);

    // Visit reel pages only for missing captions.
    const reelsToVisit = results.filter((r) => !r.caption);
    console.log(
      `[instagram] Visiting ${reelsToVisit.length} reel pages for captions`
    );

    for (const reel of reelsToVisit) {
      try {
        await page.goto(reel.postUrl, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        await randomDelay(1500, 3000);

        const pageData = await page.evaluate(reelPageEvaluate);

        if (pageData.caption && !reel.caption) {
          reel.caption = pageData.caption.substring(0, 200);
        }
        // Grid view count is more reliable than the in-page lookup, but use
        // the in-page values as fallback if grid extraction failed.
        if (pageData.views && reel.viewCount === null) {
          reel.viewCount = parseCompactNumber(pageData.views);
        }
        if (pageData.likes && reel.likeCount === null) {
          reel.likeCount = parseCompactNumber(pageData.likes);
        }
        if (pageData.thumbnail && !reel.thumbnailUrl) {
          reel.thumbnailUrl = pageData.thumbnail;
        }
      } catch {
        console.log(`[instagram] Failed to enrich ${reel.externalId}`);
      }
    }

    return results;
  } catch (error) {
    console.error("[instagram] scrapeProfile error:", error);
    return results;
  } finally {
    await page.close();
  }
}

export const instagramScraper: PlatformScraper = {
  platform: PLATFORM,

  profileUrl(username) {
    return `https://www.instagram.com/${username}/reels/`;
  },

  parseItemUrl(url) {
    if (!/instagram\.com/.test(url)) return null;
    const id = extractInstagramId(url);
    if (!id) return null;
    return {
      externalId: id,
      canonicalUrl: `https://www.instagram.com/reel/${id}/`,
    };
  },

  async ensureLoggedIn(context) {
    const username = process.env.INSTAGRAM_USERNAME;
    const password = process.env.INSTAGRAM_PASSWORD;
    const totpSecret = process.env.INSTAGRAM_TOTP_SECRET;
    if (!username || !password) {
      throw new Error("Instagram credentials not configured");
    }
    return loginToInstagram(context, username, password, totpSecret || undefined);
  },

  async scrapeProfile(context, username) {
    return scrapeReelsGrid(context, this.profileUrl(username));
  },

  async scrapeSingleItem(context, url) {
    const id = extractInstagramId(url) || "";
    const page = await context.newPage();
    try {
      console.log(`[instagram] Scraping single reel: ${url}`);
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await randomDelay(2000, 4000);

      const pageData = await page.evaluate(reelPageEvaluate);

      const result: ScrapedItem = {
        externalId: id,
        postUrl: url,
        thumbnailUrl: pageData.thumbnail,
        caption: pageData.caption?.substring(0, 200) || null,
        viewCount: pageData.views ? parseCompactNumber(pageData.views) : null,
        likeCount: pageData.likes ? parseCompactNumber(pageData.likes) : null,
      };

      console.log(
        `[instagram] Single reel ${id}: views=${result.viewCount}, likes=${result.likeCount}`
      );
      return result;
    } finally {
      await page.close();
    }
  },
};
