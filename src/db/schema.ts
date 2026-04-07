import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  clientName: text("client_name").notNull(),
  reelsUrl: text("reels_url").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const posts = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id),
  instagramId: text("instagram_id").notNull().unique(),
  postUrl: text("post_url").notNull(),
  caption: text("caption"),
  thumbnailUrl: text("thumbnail_url"),
  firstSeenAt: text("first_seen_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

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
  status: text("status").notNull(), // 'success' | 'failed' | 'partial'
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
