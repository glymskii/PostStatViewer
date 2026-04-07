-- v2.1 destructive migration: multi-platform schema (Instagram/Threads/TikTok).
-- This drops the v1 accounts/posts/post_snapshots/scrape_runs tables and recreates them
-- with platform support. Existing data is wiped (approved by user; backup at
-- /app/data/poststat.db.v1.bak in production). The `settings` table is preserved.

DROP TABLE IF EXISTS `post_snapshots`;--> statement-breakpoint
DROP TABLE IF EXISTS `scrape_runs`;--> statement-breakpoint
DROP TABLE IF EXISTS `posts`;--> statement-breakpoint
DROP TABLE IF EXISTS `accounts`;--> statement-breakpoint

CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform` text NOT NULL,
	`username` text NOT NULL,
	`client_name` text NOT NULL,
	`profile_url` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_platform_username_unique` ON `accounts` (`platform`, `username`);--> statement-breakpoint

CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`external_id` text NOT NULL,
	`post_url` text NOT NULL,
	`caption` text,
	`thumbnail_url` text,
	`first_seen_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `posts_account_external_unique` ON `posts` (`account_id`, `external_id`);--> statement-breakpoint

CREATE TABLE `post_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer NOT NULL,
	`view_count` integer,
	`like_count` integer,
	`scraped_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint

CREATE TABLE `scrape_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`status` text NOT NULL,
	`posts_scraped` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
