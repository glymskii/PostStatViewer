import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { accounts, posts, postSnapshots } from "@/db/schema";
import { and, desc, eq, gte, lt } from "drizzle-orm";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ReportPost {
  postId: number;
  accountId: number;
  platform: string;
  username: string;
  clientName: string;
  brand: string | null;
  team: string | null;
  postUrl: string;
  caption: string | null;
  firstSeenAt: string;
  views: number | null;
  likes: number | null;
}

interface ReportGroup {
  brand: string | null;
  team: string | null;
  postsCount: number;
  totalViews: number;
  avgViews: number;
  totalLikes: number;
  posts: ReportPost[];
}

/** "2026-06-30" → "2026-07-01" (exclusive upper bound for string comparison). */
function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * GET /api/report?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Cross-account attribution report: all posts first seen within the period
 * (inclusive on both ends), grouped by (account.brand, post.team). Views and
 * likes are the post's LATEST snapshot overall — same "current value"
 * semantics as /api/stats. Inactive accounts are included: a post published
 * in the period counts even if its account was deactivated later.
 *
 * Timestamps in the DB are SQLite `datetime('now')` strings
 * ("YYYY-MM-DD HH:MM:SS", UTC, no 'T'), so period bounds are compared as
 * plain "YYYY-MM-DD" strings with an exclusive next-day upper bound. Never
 * use toISOString() here — its 'T' separator breaks the lexicographic
 * comparison against space-separated timestamps.
 *
 * Brand/team filters are intentionally client-side (dataset is tiny; the
 * Excel export must match on-screen filters).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";

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

  const toExclusive = nextDay(to);

  const rows = db
    .select({
      postId: posts.id,
      accountId: accounts.id,
      platform: accounts.platform,
      username: accounts.username,
      clientName: accounts.clientName,
      brand: accounts.brand,
      team: posts.team,
      postUrl: posts.postUrl,
      caption: posts.caption,
      firstSeenAt: posts.firstSeenAt,
    })
    .from(posts)
    .innerJoin(accounts, eq(posts.accountId, accounts.id))
    .where(and(gte(posts.firstSeenAt, from), lt(posts.firstSeenAt, toExclusive)))
    .all();

  // Latest snapshot per post (N+1 in the codebase's sync style — volumes are tiny).
  const reportPosts: ReportPost[] = rows.map((row) => {
    const latest = db
      .select()
      .from(postSnapshots)
      .where(eq(postSnapshots.postId, row.postId))
      .orderBy(desc(postSnapshots.scrapedAt), desc(postSnapshots.id))
      .limit(1)
      .get();
    return {
      ...row,
      views: latest?.viewCount ?? null,
      likes: latest?.likeCount ?? null,
    };
  });

  // Group by (brand, team). Nulls stay null — labels are a UI concern.
  const groupMap = new Map<string, ReportGroup>();
  for (const post of reportPosts) {
    // JSON key is unambiguous for any brand/team values (nulls, spaces, etc).
    const key = JSON.stringify([post.brand, post.team]);
    let group = groupMap.get(key);
    if (!group) {
      group = {
        brand: post.brand,
        team: post.team,
        postsCount: 0,
        totalViews: 0,
        avgViews: 0,
        totalLikes: 0,
        posts: [],
      };
      groupMap.set(key, group);
    }
    group.postsCount++;
    group.totalViews += post.views ?? 0;
    group.totalLikes += post.likes ?? 0;
    group.posts.push(post);
  }

  const groups = Array.from(groupMap.values());
  for (const group of groups) {
    group.avgViews =
      group.postsCount > 0 ? Math.round(group.totalViews / group.postsCount) : 0;
    group.posts.sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  }
  groups.sort((a, b) => b.totalViews - a.totalViews);

  const totals = {
    postsCount: reportPosts.length,
    totalViews: groups.reduce((sum, g) => sum + g.totalViews, 0),
    totalLikes: groups.reduce((sum, g) => sum + g.totalLikes, 0),
    avgViews: 0,
  };
  totals.avgViews =
    totals.postsCount > 0 ? Math.round(totals.totalViews / totals.postsCount) : 0;

  return NextResponse.json({ from, to, groups, totals });
}
