-- v2.4: comment counts for the team performance dashboard.
-- Hand-written (like 0002/0003): drizzle snapshots are stale, `drizzle-kit
-- generate` must NOT be used — it would diff against the outdated 0001
-- snapshot and produce a destructive migration.
-- post_snapshots.comment_count — число комментариев (Threads: replies),
-- nullable: extraction is best-effort and old snapshots predate the column.
ALTER TABLE `post_snapshots` ADD `comment_count` integer;
