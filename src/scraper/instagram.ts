import type { BrowserContext } from "playwright-core";
import { randomDelay } from "./stealth";

export interface ScrapedReel {
  instagramId: string;
  postUrl: string;
  thumbnailUrl: string | null;
  caption: string | null;
  viewCount: number | null;
  likeCount: number | null;
}

function parseViewCount(text: string): number | null {
  if (!text) return null;
  const cleaned = text.trim().toLowerCase();

  // Handle formats: "1.2M", "123K", "1,234", "1234"
  const multipliers: Record<string, number> = {
    k: 1_000,
    m: 1_000_000,
    b: 1_000_000_000,
  };

  const match = cleaned.match(/^([\d,.]+)\s*([kmb])?$/);
  if (!match) return null;

  const num = parseFloat(match[1].replace(/,/g, ""));
  const suffix = match[2];
  return Math.round(num * (suffix ? multipliers[suffix] : 1));
}

function extractInstagramId(url: string): string {
  // Extract reel ID from URL like /reel/ABC123/ or /p/ABC123/
  const match = url.match(/\/(reel|p)\/([^/?]+)/);
  return match ? match[2] : url;
}

export async function scrapeReels(
  context: BrowserContext,
  reelsUrl: string,
  maxReels = 50
): Promise<ScrapedReel[]> {
  const page = await context.newPage();
  const results: ScrapedReel[] = [];

  try {
    console.log(`[scraper] Navigating to ${reelsUrl}`);
    await page.goto(reelsUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await randomDelay(3000, 5000);

    // Wait for the reels grid to load
    await page.waitForSelector("a[href*='/reel/']", { timeout: 15000 }).catch(() => {
      console.log("[scraper] No reel links found initially, trying to scroll...");
    });

    const seenIds = new Set<string>();
    let noNewContentCount = 0;

    while (results.length < maxReels && noNewContentCount < 3) {
      // Extract reel items from the grid
      const reelItems = await page.$$eval(
        "a[href*='/reel/']",
        (links) => {
          return links.map((link) => {
            const href = link.getAttribute("href") || "";

            let viewText = "";
            let likeText = "";

            // Instagram grid structure:
            // - Bottom overlay: SVG aria-label="View Count Icon" + span = view count
            // - Hover overlay: <ul><li> items = likes, comments

            // Extract VIEW count: find SVG with aria-label="View Count Icon"
            const viewSvg = link.querySelector('svg[aria-label="View Count Icon"]');
            if (viewSvg) {
              // View count span is a sibling of the SVG's parent div
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

            // Extract LIKE count: first <li> number in the hover overlay
            const listItems = link.querySelectorAll("ul li");
            if (listItems.length > 0) {
              const firstLi = listItems[0];
              const span = firstLi.querySelector("span.html-span");
              if (span) {
                const t = span.textContent?.trim() || "";
                if (/^[\d,.]+[KkMmBb]?$/.test(t)) {
                  likeText = t;
                }
              }
            }

            // Get thumbnail - try multiple strategies
            let thumbnailUrl: string | null = null;
            // 1. Direct img inside the link
            const img = link.querySelector("img");
            if (img) {
              thumbnailUrl = img.getAttribute("src") || null;
            }
            // 2. Video poster attribute
            if (!thumbnailUrl) {
              const video = link.querySelector("video");
              if (video) {
                thumbnailUrl = video.getAttribute("poster") || null;
              }
            }
            // 3. Look in parent container for img
            if (!thumbnailUrl) {
              const parent = link.closest("div");
              if (parent) {
                const parentImg = parent.querySelector("img");
                if (parentImg) {
                  thumbnailUrl = parentImg.getAttribute("src") || null;
                }
              }
            }
            // 4. Background image from style
            if (!thumbnailUrl) {
              const divWithBg = link.querySelector("div[style*='background-image']");
              if (divWithBg) {
                const style = divWithBg.getAttribute("style") || "";
                const bgMatch = style.match(/url\(["']?([^"')]+)["']?\)/);
                if (bgMatch) {
                  thumbnailUrl = bgMatch[1];
                }
              }
            }

            return { href, viewText, likeText, thumbnailUrl };
          });
        }
      );

      let newFound = 0;
      for (const item of reelItems) {
        if (results.length >= maxReels) break;

        const instagramId = extractInstagramId(item.href);
        if (seenIds.has(instagramId)) continue;
        seenIds.add(instagramId);
        newFound++;

        results.push({
          instagramId,
          postUrl: `https://www.instagram.com${item.href}`,
          thumbnailUrl: item.thumbnailUrl,
          caption: null,
          viewCount: parseViewCount(item.viewText),
          likeCount: parseViewCount(item.likeText),
        });
      }

      if (newFound === 0) {
        noNewContentCount++;
      } else {
        noNewContentCount = 0;
      }

      if (results.length < maxReels) {
        // Scroll down to load more
        await page.evaluate(() => window.scrollBy(0, 800));
        await randomDelay(2000, 4000);
      }
    }

    console.log(`[scraper] Collected ${results.length} reels from grid`);

    // Visit reel pages only for missing captions/thumbnails
    // Views and likes are reliably extracted from the grid
    const reelsToVisit = results.filter(
      (r) => !r.caption
    );
    console.log(
      `[scraper] Visiting ${reelsToVisit.length} reel pages for stats...`
    );

    for (const reel of reelsToVisit) {
      try {
        await page.goto(reel.postUrl, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        await randomDelay(1500, 3000);

        // Extract all data from the reel page in one evaluate call
        const pageData = await page.evaluate(() => {
          let caption: string | null = null;
          let views: string | null = null;
          let likes: string | null = null;
          let thumbnail: string | null = null;

          // --- CAPTION from og:description ---
          const ogDesc = document.querySelector(
            'meta[property="og:description"]'
          );
          const ogContent = ogDesc?.getAttribute("content") || "";

          if (ogContent) {
            // Format: "123 likes, 5 comments - Username on Instagram: "Caption text""
            const captionMatch = ogContent.match(
              /["\u201c](.+?)["\u201d]|:\s*["\u201c\u201d](.+?)["\u201c\u201d]$/
            );
            if (captionMatch) {
              caption = captionMatch[1] || captionMatch[2];
            } else {
              const colonMatch = ogContent.match(/:\s*(.+)/);
              if (colonMatch)
                caption = colonMatch[1]
                  .replace(/["\u201c\u201d\u201e]/g, "")
                  .trim();
            }

            // Extract likes from og:description (most reliable source for likes)
            const ogLikeMatch = ogContent.match(
              /([\d,. ]+)\s*likes?/i
            );
            if (ogLikeMatch) {
              likes = ogLikeMatch[1].replace(/\s/g, "");
            }
          }

          // Fallback caption from meta description
          if (!caption) {
            const metaDesc = document.querySelector(
              'meta[name="description"]'
            );
            if (metaDesc) {
              const content = metaDesc.getAttribute("content") || "";
              const captionMatch = content.match(
                /["\u201c](.+?)["\u201d]/
              );
              if (captionMatch) caption = captionMatch[1];
            }
          }

          // Fallback caption from h1
          if (!caption) {
            const h1 = document.querySelector("h1");
            if (h1?.textContent && h1.textContent.length > 5) {
              caption = h1.textContent.trim();
            }
          }

          // --- VIEWS: search for play/view count ---
          // Strategy 1: Look for spans with "X plays" or "X views" text
          const allSpans = document.querySelectorAll("span");
          for (const el of allSpans) {
            const text = el.textContent?.trim() || "";
            // Match "1,234 plays" / "1.2M views" / etc
            const viewMatch = text.match(
              /^([\d,.]+[KkMmBb]?)\s*(plays?|views?|просмотр\w*)/i
            );
            if (viewMatch && !views) {
              views = viewMatch[1];
              break;
            }
          }

          // Strategy 2: Look for aria-label with play/view count on sections/spans
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

          // Strategy 3: Find the view count near a play SVG icon
          if (!views) {
            const svgs = document.querySelectorAll("svg");
            for (const svg of svgs) {
              const ariaLabel = (
                svg.getAttribute("aria-label") || ""
              ).toLowerCase();
              // Check for play-related aria labels
              if (
                ariaLabel.includes("play") ||
                ariaLabel.includes("view") ||
                ariaLabel.includes("просмотр")
              ) {
                // Look in parent and siblings for numbers
                const parent = svg.closest("div, span, section");
                if (parent) {
                  const spans = parent.querySelectorAll("span");
                  for (const s of spans) {
                    const t = s.textContent?.trim() || "";
                    if (/^[\d,.]+[KkMmBb]?$/.test(t) && t.length > 0) {
                      views = t;
                      break;
                    }
                  }
                }
              }
              if (views) break;
            }
          }

          // Strategy 4: Look for the video view count in the page's JSON-LD
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
                if (json.video?.interactionCount) {
                  views = String(json.video.interactionCount);
                }
              } catch {}
            }
          }

          // --- LIKES: search for like count if not found in og ---
          if (!likes) {
            for (const el of allSpans) {
              const text = el.textContent?.trim() || "";
              const likeMatch = text.match(
                /^([\d,.]+[KkMmBb]?)\s*(likes?|лайк\w*)/i
              );
              if (likeMatch) {
                likes = likeMatch[1];
                break;
              }
            }
          }

          // --- THUMBNAIL ---
          const video = document.querySelector("video");
          if (video?.poster) {
            thumbnail = video.poster;
          } else {
            const ogImage = document.querySelector(
              'meta[property="og:image"]'
            );
            if (ogImage) thumbnail = ogImage.getAttribute("content");
          }

          return { caption, views, likes, thumbnail };
        });

        // Apply extracted data
        if (pageData.caption && !reel.caption) {
          reel.caption = pageData.caption.substring(0, 200);
        }
        if (pageData.views) {
          reel.viewCount = parseViewCount(pageData.views);
        }
        if (pageData.likes) {
          reel.likeCount = parseViewCount(pageData.likes);
        }
        if (pageData.thumbnail && !reel.thumbnailUrl) {
          reel.thumbnailUrl = pageData.thumbnail;
        }

        console.log(
          `[scraper] ${reel.instagramId}: views=${reel.viewCount}, likes=${reel.likeCount}`
        );
      } catch {
        console.log(
          `[scraper] Failed to get data for ${reel.instagramId}`
        );
      }
    }

    return results;
  } catch (error) {
    console.error("[scraper] Error scraping reels:", error);
    return results;
  } finally {
    await page.close();
  }
}

// Reusable page evaluate function for extracting reel data
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
    if (viewMatch && !views) { views = viewMatch[1]; break; }
  }
  if (!views) {
    const elements = document.querySelectorAll("[aria-label]");
    for (const el of elements) {
      const label = el.getAttribute("aria-label") || "";
      const viewMatch = label.match(/([\d,.]+[KkMmBb]?)\s*(plays?|views?|просмотр)/i);
      if (viewMatch) { views = viewMatch[1]; break; }
    }
  }
  if (!views) {
    const svgs = document.querySelectorAll("svg");
    for (const svg of svgs) {
      const ariaLabel = (svg.getAttribute("aria-label") || "").toLowerCase();
      if (ariaLabel.includes("play") || ariaLabel.includes("view") || ariaLabel.includes("просмотр")) {
        const parent = svg.closest("div, span, section");
        if (parent) {
          const spans = parent.querySelectorAll("span");
          for (const s of spans) {
            const t = s.textContent?.trim() || "";
            if (/^[\d,.]+[KkMmBb]?$/.test(t) && t.length > 0) { views = t; break; }
          }
        }
      }
      if (views) break;
    }
  }
  if (!views) {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const json = JSON.parse(script.textContent || "");
        if (json.interactionStatistic) {
          const stats = Array.isArray(json.interactionStatistic) ? json.interactionStatistic : [json.interactionStatistic];
          for (const stat of stats) {
            if (stat["@type"] === "InteractionCounter" && stat.interactionType?.["@type"] === "WatchAction") {
              views = String(stat.userInteractionCount); break;
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
      if (likeMatch) { likes = likeMatch[1]; break; }
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

/**
 * Scrape a single reel by its direct URL.
 * Used when user manually adds an old reel for tracking.
 */
export async function scrapeSingleReel(
  context: BrowserContext,
  reelUrl: string
): Promise<ScrapedReel> {
  const instagramId = extractInstagramId(reelUrl);
  const page = await context.newPage();

  try {
    console.log(`[scraper] Scraping single reel: ${reelUrl}`);
    await page.goto(reelUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await randomDelay(2000, 4000);

    const pageData = await page.evaluate(reelPageEvaluate);

    const result: ScrapedReel = {
      instagramId,
      postUrl: reelUrl,
      thumbnailUrl: pageData.thumbnail,
      caption: pageData.caption?.substring(0, 200) || null,
      viewCount: pageData.views ? parseViewCount(pageData.views) : null,
      likeCount: pageData.likes ? parseViewCount(pageData.likes) : null,
    };

    console.log(
      `[scraper] Single reel ${instagramId}: views=${result.viewCount}, likes=${result.likeCount}`
    );

    return result;
  } finally {
    await page.close();
  }
}
