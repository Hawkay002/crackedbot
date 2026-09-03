CREATE TABLE `audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`target_id` text,
	`action` text NOT NULL,
	`detail` text,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_guild_at` ON `audit` (`guild_id`,`at`);--> statement-breakpoint
CREATE TABLE `guilds` (
	`id` text PRIMARY KEY NOT NULL,
	`verify_channel_id` text,
	`modlog_channel_id` text,
	`review_channel_id` text,
	`rubric` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`discord_id` text NOT NULL,
	`github_id` text NOT NULL,
	`github_login` text NOT NULL,
	`tier` text NOT NULL,
	`score` integer NOT NULL,
	`leaderboard_opt_out` integer DEFAULT false NOT NULL,
	`linked_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`rescored_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `links_guild_discord` ON `links` (`guild_id`,`discord_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `links_guild_github` ON `links` (`guild_id`,`github_id`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`discord_id` text NOT NULL,
	`github_id` text NOT NULL,
	`github_login` text NOT NULL,
	`score_id` integer NOT NULL,
	`tier` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`message_id` text,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`resolved_at` text,
	`resolved_by` text
);
--> statement-breakpoint
CREATE INDEX `reviews_guild_status` ON `reviews` (`guild_id`,`status`);--> statement-breakpoint
CREATE TABLE `scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`github_id` text NOT NULL,
	`github_login` text NOT NULL,
	`total` integer NOT NULL,
	`raw` integer NOT NULL,
	`result` text NOT NULL,
	`analysis` blob,
	`own_token` integer NOT NULL,
	`computed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scores_github` ON `scores` (`github_id`,`computed_at`);