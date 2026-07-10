-- v2.3: brand/team attribution for the «Отчёт» page.
-- Hand-written (like 0002): drizzle snapshots are stale since the hand-written
-- 0002 migration, so `drizzle-kit generate` must NOT be used — it would diff
-- against the outdated 0001 snapshot and produce a destructive migration.
-- accounts.brand — бренд аккаунта (nullable, backfilled manually via UI).
-- posts.team     — команда, создавшая пост (nullable).
ALTER TABLE `accounts` ADD `brand` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `team` text;
