import { eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { type GuildRow, guilds } from '../db/schema.js';
import { DEFAULT_RUBRIC, loadRubric, type Rubric } from '../scoring/index.js';

export interface GuildConfig {
  row: GuildRow;
  rubric: Rubric;
}

export function getGuild(ctx: AppContext, guildId: string): GuildConfig {
  let row = ctx.db.select().from(guilds).where(eq(guilds.id, guildId)).get();
  if (!row) {
    ctx.db
      .insert(guilds)
      .values({ id: guildId, rubric: JSON.stringify(DEFAULT_RUBRIC) })
      .run();
    row = ctx.db.select().from(guilds).where(eq(guilds.id, guildId)).get()!;
  }
  return { row, rubric: loadRubric(row.rubric) };
}

export function updateGuild(
  ctx: AppContext,
  guildId: string,
  patch: Partial<Pick<GuildRow, 'verifyChannelId' | 'modlogChannelId' | 'reviewChannelId'>> & {
    rubric?: Rubric;
  },
): GuildConfig {
  getGuild(ctx, guildId);
  const set: Record<string, unknown> = { ...patch, updatedAt: new Date().toISOString() };
  if (patch.rubric) set.rubric = JSON.stringify(patch.rubric);
  ctx.db.update(guilds).set(set).where(eq(guilds.id, guildId)).run();
  return getGuild(ctx, guildId);
}

export function isConfigured(g: GuildConfig): boolean {
  return Boolean(g.row.verifyChannelId);
}
