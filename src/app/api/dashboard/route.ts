import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { accounts, posts, postSnapshots, settings } from "@/db/schema";
import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { DEFAULT_TEAMS, DICT_TEAMS_KEY, parseDict } from "@/lib/dictionaries";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NONE_BRAND = "__none__";

interface SnapshotRow {
  postId: number;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  scrapedAt: string;
}

interface DashboardPost {
  postId: number;
  accountId: number;
  platform: string;
  username: string;
  postUrl: string;
  caption: string | null;
  thumbnailUrl: string | null;
  team: string | null;
  firstSeenAt: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  snapshots: {
    viewCount: number | null;
    likeCount: number | null;
    commentCount: number | null;
    scrapedAt: string;
  }[];
}

interface TeamEntry {
  team: string | null;
  postsCount: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number | null;
  prevViews: number;
  deltaPct: number | null;
  series: number[];
  posts: DashboardPost[];
}

/** "2026-06-30" → "2026-07-01" */
function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetweenInclusive(from: string, to: string): number {
  return (
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000
    ) + 1
  );
}

/**
 * GET /api/dashboard?brand=<name|__none__>&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Per-brand team performance for the brand-tabbed homepage:
 * - Current period posts: accounts.brand = X, first_seen_at ∈ [from, to+1d).
 *   Views/likes/comments = latest snapshot overall (same semantics as
 *   /api/report — for live periods this equals "now").
 * - prevViews: posts of the equal-length window immediately before `from`,
 *   measured AS OF the prev period end (latest snapshot scraped_at < from) so
 *   an old post's later accumulation doesn't inflate the previous period.
 *   Discovery snapshots are written at first_seen_at, so every prev post has
 *   at least one qualifying snapshot.
 * - series: per team, cumulative views of its current-period posts sampled at
 *   the end of each UTC day (carry-forward over scrape gaps). Aligned with
 *   the shared `dates` axis.
 *
 * Returns EVERY team from the dictionary (zero rows included — a team that
 * shipped nothing is the signal the client wants to see), plus a null-team
 * entry last («Без команды» pool for quick assignment).
 *
 * All timestamp comparisons are plain "YYYY-MM-DD" strings against SQLite
 * "YYYY-MM-DD HH:MM:SS" UTC values — lexicographic ordering works; never use
 * toISOString() (its 'T' breaks comparison). UTC days: the nightly scrape at
 * ~22:00 UTC lands on the previous Almaty (UTC+5) calendar day; accepted.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const brandParam = searchParams.get("brand") || "";
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";

  if (!brandParam) {
    return NextResponse.json({ error: "brand обязателен" }, { status: 400 });
  }
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { error: "from и to обязательны в формате YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (from > to) {
    return NextResponse.json(
      { error: "from не может быть позже to" },
      { status: 400 }
    );
  }

  const brand = brandParam === NONE_BRAND ? null : brandParam;
  const toExclusive = nextDay(to);
  const periodDays = daysBetweenInclusive(from, to);
  const prevFrom = addDays(from, -periodDays);
  const prevTo = addDays(from, -1);

  // --- Query 1: all posts of this brand first seen in [prevFrom, to+1d)
  const brandFilter =
    brand === null ? isNull(accounts.brand) : eq(accounts.brand, brand);
  const rows = db
    .select({
      postId: posts.id,
      accountId: accounts.id,
      platform: accounts.platform,
      username: accounts.username,
      postUrl: posts.postUrl,
      caption: posts.caption,
      thumbnailUrl: posts.thumbnailUrl,
      team: posts.team,
      firstSeenAt: posts.firstSeenAt,
    })
    .from(posts)
    .innerJoin(accounts, eq(posts.accountId, accounts.id))
    .where(
      and(
        brandFilter,
        gte(posts.firstSeenAt, prevFrom),
        lt(posts.firstSeenAt, toExclusive)
      )
    )
    .all();

  const currentRows = rows.filter((r) => r.firstSeenAt >= from);
  const prevRows = rows.filter((r) => r.firstSeenAt < from);

  // --- Query 2: all snapshots of those posts, one pass (chunk under SQLite's
  // 999-variable limit).
  const allIds = rows.map((r) => r.postId);
  const snapshotRows: SnapshotRow[] = [];
  for (let i = 0; i < allIds.length; i += 500) {
    const chunk = allIds.slice(i, i + 500);
    if (chunk.length === 0) break;
    snapshotRows.push(
      ...db
        .select({
          postId: postSnapshots.postId,
          viewCount: postSnapshots.viewCount,
          likeCount: postSnapshots.likeCount,
          commentCount: postSnapshots.commentCount,
          scrapedAt: postSnapshots.scrapedAt,
        })
        .from(postSnapshots)
        .where(inArray(postSnapshots.postId, chunk))
        .orderBy(asc(postSnapshots.scrapedAt), asc(postSnapshots.id))
        .all()
    );
  }
  const snapsByPost = new Map<number, SnapshotRow[]>();
  for (const snap of snapshotRows) {
    let list = snapsByPost.get(snap.postId);
    if (!list) {
      list = [];
      snapsByPost.set(snap.postId, list);
    }
    list.push(snap);
  }

  // --- Query 3: teams dictionary (all teams shown, zeros included).
  const dictRow = db
    .select()
    .from(settings)
    .where(eq(settings.key, DICT_TEAMS_KEY))
    .get();
  const dictTeams = parseDict(dictRow?.value, DEFAULT_TEAMS);

  // --- Shared daily axis.
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);

  // --- Assemble team entries: dictionary teams in order, then any team that
  // exists on posts but was removed from the dictionary, null-team last.
  const extraTeams = new Set<string>();
  for (const row of currentRows) {
    if (row.team !== null && !dictTeams.includes(row.team)) {
      extraTeams.add(row.team);
    }
  }
  const teamKeys: (string | null)[] = [...dictTeams, ...extraTeams, null];

  const entries: TeamEntry[] = teamKeys.map((teamKey) => {
    const teamPosts = currentRows.filter((r) => r.team === teamKey);
    const teamPrevPosts = prevRows.filter((r) => r.team === teamKey);

    const dashboardPosts: DashboardPost[] = teamPosts.map((row) => {
      const snaps = snapsByPost.get(row.postId) ?? [];
      const latest = snaps[snaps.length - 1];
      return {
        ...row,
        views: latest?.viewCount ?? null,
        likes: latest?.likeCount ?? null,
        comments: latest?.commentCount ?? null,
        snapshots: snaps.map((s) => ({
          viewCount: s.viewCount,
          likeCount: s.likeCount,
          commentCount: s.commentCount,
          scrapedAt: s.scrapedAt,
        })),
      };
    });
    dashboardPosts.sort((a, b) => (b.views ?? 0) - (a.views ?? 0));

    const totalViews = dashboardPosts.reduce((s, p) => s + (p.views ?? 0), 0);
    const totalLikes = dashboardPosts.reduce((s, p) => s + (p.likes ?? 0), 0);
    let totalComments: number | null = null;
    for (const p of dashboardPosts) {
      if (p.comments !== null) {
        totalComments = (totalComments ?? 0) + p.comments;
      }
    }

    // prevViews: as of the prev period end (last snapshot strictly before `from`).
    let prevViews = 0;
    for (const row of teamPrevPosts) {
      const snaps = snapsByPost.get(row.postId) ?? [];
      for (let i = snaps.length - 1; i >= 0; i--) {
        if (snaps[i].scrapedAt < from) {
          prevViews += snaps[i].viewCount ?? 0;
          break;
        }
      }
    }
    const deltaPct =
      prevViews > 0
        ? Math.round(((totalViews - prevViews) / prevViews) * 1000) / 10
        : null;

    // Daily cumulative series: pointer walk per post over sorted snapshots.
    const series = dates.map(() => 0);
    for (const post of teamPosts) {
      const snaps = snapsByPost.get(post.postId) ?? [];
      let idx = 0;
      let lastViews = 0;
      for (let d = 0; d < dates.length; d++) {
        const dayEnd = `${dates[d]} 23:59:59`;
        while (idx < snaps.length && snaps[idx].scrapedAt <= dayEnd) {
          lastViews = snaps[idx].viewCount ?? lastViews;
          idx++;
        }
        series[d] += lastViews;
      }
    }

    return {
      team: teamKey,
      postsCount: dashboardPosts.length,
      totalViews,
      totalLikes,
      totalComments,
      prevViews,
      deltaPct,
      series,
      posts: dashboardPosts,
    };
  });

  // --- Brand totals.
  const totals = {
    postsCount: entries.reduce((s, t) => s + t.postsCount, 0),
    totalViews: entries.reduce((s, t) => s + t.totalViews, 0),
    totalLikes: entries.reduce((s, t) => s + t.totalLikes, 0),
    totalComments: entries.some((t) => t.totalComments !== null)
      ? entries.reduce((s, t) => s + (t.totalComments ?? 0), 0)
      : null,
    prevViews: entries.reduce((s, t) => s + t.prevViews, 0),
    deltaPct: null as number | null,
  };
  totals.deltaPct =
    totals.prevViews > 0
      ? Math.round(
          ((totals.totalViews - totals.prevViews) / totals.prevViews) * 1000
        ) / 10
      : null;

  return NextResponse.json({
    brand: brandParam,
    from,
    to,
    prevFrom,
    prevTo,
    dates,
    teams: entries,
    totals,
  });
}
