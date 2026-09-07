CREATE TABLE `ballots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vote_id` integer NOT NULL,
	`voter_id` text NOT NULL,
	`choice` text NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ballots_vote_voter` ON `ballots` (`vote_id`,`voter_id`);--> statement-breakpoint
CREATE TABLE `votes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`discord_id` text NOT NULL,
	`github_id` text NOT NULL,
	`github_login` text NOT NULL,
	`score_id` integer NOT NULL,
	`tier` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`channel_id` text,
	`message_id` text,
	`quorum` integer NOT NULL,
	`threshold_pct` integer NOT NULL,
	`yes` integer DEFAULT 0 NOT NULL,
	`no` integer DEFAULT 0 NOT NULL,
	`opened_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`closes_at` text NOT NULL,
	`closed_at` text,
	`closed_by` text
);
--> statement-breakpoint
CREATE INDEX `votes_guild_status` ON `votes` (`guild_id`,`status`);--> statement-breakpoint
CREATE INDEX `votes_closes` ON `votes` (`status`,`closes_at`);