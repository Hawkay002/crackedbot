import { sql } from 'drizzle-orm';
import { blob, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const guilds = sqliteTable('guilds', {
  id: text('id').primaryKey(),
  verifyChannelId: text('verify_channel_id'),
  modlogChannelId: text('modlog_channel_id'),
  reviewChannelId: text('review_channel_id'),
  /** rubric JSON, see scoring/rubric.ts */
  rubric: text('rubric').notNull(),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

export const links = sqliteTable(
  'links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    discordId: text('discord_id').notNull(),
    githubId: text('github_id').notNull(),
    githubLogin: text('github_login').notNull(),
    tier: text('tier').notNull(),
    score: integer('score').notNull(),
    leaderboardOptOut: integer('leaderboard_opt_out', { mode: 'boolean' }).notNull().default(false),
    linkedAt: text('linked_at').notNull().default(now),
    rescoredAt: text('rescored_at'),
  },
  (t) => [
    uniqueIndex('links_guild_discord').on(t.guildId, t.discordId),
    uniqueIndex('links_guild_github').on(t.guildId, t.githubId),
  ],
);

export const scores = sqliteTable(
  'scores',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    githubId: text('github_id').notNull(),
    githubLogin: text('github_login').notNull(),
    total: integer('total').notNull(),
    raw: integer('raw').notNull(),
    /** ScoreResult JSON minus the analysis */
    result: text('result').notNull(),
    /** gzip(JSON(Analysis)) so mods can ask why without refetching */
    analysis: blob('analysis', { mode: 'buffer' }),
    /** true when computed with the user's own token (private contribution counts visible) */
    ownToken: integer('own_token', { mode: 'boolean' }).notNull(),
    computedAt: text('computed_at').notNull().default(now),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [index('scores_github').on(t.githubId, t.computedAt)],
);

export const reviews = sqliteTable(
  'reviews',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    discordId: text('discord_id').notNull(),
    githubId: text('github_id').notNull(),
    githubLogin: text('github_login').notNull(),
    scoreId: integer('score_id').notNull(),
    tier: text('tier').notNull(),
    reason: text('reason').notNull(),
    status: text('status', { enum: ['open', 'approved', 'denied'] })
      .notNull()
      .default('open'),
    messageId: text('message_id'),
    note: text('note'),
    createdAt: text('created_at').notNull().default(now),
    resolvedAt: text('resolved_at'),
    resolvedBy: text('resolved_by'),
  },
  (t) => [index('reviews_guild_status').on(t.guildId, t.status)],
);

export const audit = sqliteTable(
  'audit',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    actorId: text('actor_id').notNull(),
    targetId: text('target_id'),
    action: text('action').notNull(),
    detail: text('detail'),
    at: text('at').notNull().default(now),
  },
  (t) => [index('audit_guild_at').on(t.guildId, t.at)],
);

export type GuildRow = typeof guilds.$inferSelect;
export type LinkRow = typeof links.$inferSelect;
export type ScoreRow = typeof scores.$inferSelect;
export type ReviewRow = typeof reviews.$inferSelect;
