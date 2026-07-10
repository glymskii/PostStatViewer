import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const PLATFORMS = ["instagram", "threads", "tiktok"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const accounts = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    platform: text("platform", { enum: PLATFORMS }).notNull(),
    username: text("username").notNull(),
    clientName: text("client_name").notNull(),
    // Brand attribution («Salam bro», «Just doner», …). Nullable — legacy
    // accounts are backfilled manually via the settings UI.
    brand: text("brand"),
    profileUrl: text("profile_url").notNull(),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    platformUsernameUnique: uniqueIndex(
      "accounts_platform_username_unique"
    ).on(t.platform, t.username),
  })
);

export const posts = sqliteTable(
  "posts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id),
    externalId: text("external_id").notNull(),
    postUrl: text("post_url").notNull(),
    caption: text("caption"),
    thumbnailUrl: text("thumbnail_url"),
    // Team attribution («Сценаристы», «Жади», …) — who produced this post.
    // Nullable; set manually per post from the account page.
    team: text("team"),
    firstSeenAt: text("first_seen_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    accountExternalUnique: uniqueIndex("posts_account_external_unique").on(
      t.accountId,
      t.externalId
    ),
  })
);

export const postSnapshots = sqliteTable("post_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postId: integer("post_id")
    .notNull()
    .references(() => posts.id),
  viewCount: integer("view_count"),
  likeCount: integer("like_count"),
  scrapedAt: text("scraped_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const scrapeRuns = sqliteTable("scrape_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id),
  status: text("status").notNull(), // 'success' | 'failed' | 'partial' | 'in_progress'
  postsScraped: integer("posts_scraped").notNull().default(0),
  errorMessage: text("error_message"),
  startedAt: text("started_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  finishedAt: text("finished_at"),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
