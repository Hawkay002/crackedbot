import type { GuildMember, MessageCreateOptions } from 'discord.js';
import type { AppContext } from '../context.js';
import { audit, links } from '../db/schema.js';
import type { Analysis } from '../github/types.js';
import { log } from '../lib/logger.js';
import type { Rubric, ScoreResult } from '../scoring/index.js';

/** Send to a channel by id, swallowing permission and missing-channel errors. Returns the message id. */
export async function sendTo(
  ctx: AppContext,
  channelId: string | null | undefined,
  payload: string | MessageCreateOptions,
): Promise<string | null> {
  if (!channelId) return null;
  try {
    const ch = await ctx.client.channels.fetch(channelId);
    if (!ch?.isSendable()) return null;
    const msg = await ch.send(payload);
    return msg.id;
  } catch (err) {
    log.warn({ channelId, err: String(err) }, 'could not send to channel');
    return null;
  }
}

/** DM a user, swallowing closed-DM errors. */
export async function dmUser(
  ctx: AppContext,
  userId: string,
  payload: string | MessageCreateOptions,
): Promise<boolean> {
  try {
    const user = await ctx.client.users.fetch(userId);
    await user.send(payload);
    return true;
  } catch {
    return false;
  }
}

/** Make the member hold exactly one tier role: `grantRoleId`, or none. */
export async function syncTierRoles(
  member: GuildMember,
  rubric: Rubric,
  grantRoleId: string | null,
): Promise<void> {
  const tierRoles = new Set(rubric.tiers.map((t) => t.roleId).filter((r): r is string => Boolean(r)));
  const toRemove = [...tierRoles].filter((r) => r !== grantRoleId && member.roles.cache.has(r));
  if (toRemove.length) await member.roles.remove(toRemove, 'crackedbot tier change');
  if (grantRoleId && !member.roles.cache.has(grantRoleId))
    await member.roles.add(grantRoleId, 'crackedbot tier');
}

export function upsertLink(
  ctx: AppContext,
  guildId: string,
  discordId: string,
  analysis: Analysis,
  result: ScoreResult,
  tier: string,
): void {
  ctx.db
    .insert(links)
    .values({
      guildId,
      discordId,
      githubId: analysis.profile.id,
      githubLogin: analysis.profile.login,
      tier,
      score: result.total,
    })
    .onConflictDoUpdate({
      target: [links.guildId, links.discordId],
      set: {
        githubId: analysis.profile.id,
        githubLogin: analysis.profile.login,
        tier,
        score: result.total,
        rescoredAt: new Date().toISOString(),
      },
    })
    .run();
}

export function logAudit(
  ctx: AppContext,
  guildId: string,
  actorId: string,
  action: string,
  targetId?: string,
  detail?: string,
): void {
  ctx.db
    .insert(audit)
    .values({ guildId, actorId, targetId: targetId ?? null, action, detail: detail ?? null })
    .run();
}
