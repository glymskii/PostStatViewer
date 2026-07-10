import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { posts, postSnapshots } from "@/db/schema";
import { eq, desc, and, gte } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const days = parseInt(searchParams.get("days") || "30");

  if (!accountId) {
    return NextResponse.json(
      { error: "accountId is required" },
      { status: 400 }
    );
  }

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - days);
  const sinceStr = sinceDate.toISOString();

  // Get all posts for this account
  const accountPosts = db
    .select()
    .from(posts)
    .where(eq(posts.accountId, parseInt(accountId)))
    .orderBy(desc(posts.firstSeenAt))
    .all();

  // Get snapshots for each post
  const postsWithSnapshots = accountPosts.map((post) => {
    const snapshots = db
      .select()
      .from(postSnapshots)
      .where(
        and(
          eq(postSnapshots.postId, post.id),
          gte(postSnapshots.scrapedAt, sinceStr)
        )
      )
      .orderBy(postSnapshots.scrapedAt)
      .all();

    const latestSnapshot = snapshots[snapshots.length - 1];

    return {
      id: post.id,
      externalId: post.externalId,
      postUrl: post.postUrl,
      caption: post.caption,
      thumbnailUrl: post.thumbnailUrl,
      team: post.team,
      firstSeenAt: post.firstSeenAt,
      currentViews: latestSnapshot?.viewCount ?? null,
      currentLikes: latestSnapshot?.likeCount ?? null,
      snapshots: snapshots.map((s) => ({
        viewCount: s.viewCount,
        likeCount: s.likeCount,
        scrapedAt: s.scrapedAt,
      })),
    };
  });

  return NextResponse.json(postsWithSnapshots);
}
