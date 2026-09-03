import { gzipSync } from 'node:zlib';
import { type Guild, type GuildMember, type MessageCreateOptions, WebhookClient } from 'discord.js';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { audit, links, reviews, scores } from '../db/schema.js';
import {
  profileOf,
  receiptEmbed,
  requestReviewButton,
  reviewButtons,
  statusLine,
  welcomeEmbed,
} from '../discord/receipt.js';
import { analyze } from '../github/analyzer.js';
import type { Analysis } from '../github/types.js';
import { log } from '../lib/logger.js';
import { snowflakeToDate } from '../lib/snowflake.js';
import type { VerifyState } from '../lib/state.js';
import { type Placement, place, type Rubric, type ScoreResult, score } from '../scoring/index.js';
import { type GuildConfig, getGuild } from './guilds.js';

const DAY = 86_400_000;

export interface Scored {
  analysis: Analysis;
  result: ScoreResult;
  scoreId: number;
}

/** Analyze + score + persist. Works with any token. */
export async function runScore(
  ctx: AppContext,
  token: string,
  login: string,
  rubric: Rubric,
  ownToken: boolean,
): Promise<Scored> {
  const analysis = await analyze(token, login, { ownToken });
  const result = score(analysis, rubric);
  const { analysis: _a, ...rest } = { ...result, analysis: undefined };
  const inserted = ctx.db
    .insert(scores)
    .values({
      githubId: analysis.profile.id,
      githubLogin: analysis.profile.login,
      total: result.total,
      raw: result.raw,
      result: JSON.stringify(rest),
      analysis: gzipSync(Buffer.from(JSON.stringify(analysis))),
      ownToken,
      expiresAt: new Date(Date.now() + 30 * DAY).toISOString(),
    })
    .returning({ id: scores.id })
    .get();
  ctx.lastAnalysisAt = Date.now();
  return { analysis, result, scoreId: inserted.id };
}

export function sharedGithub(ctx: AppContext, guildId: string, githubId: string, discordId: string): boolean {
  const other = ctx.db
    .select({ id: links.id })
    .from(links)
    .where(and(eq(links.guildId, guildId), eq(links.githubId, githubId), ne(links.discordId, discordId)))
    .get();
  return Boolean(other);
}

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

export async function sendTo(
  ctx: AppContext,
  channelId: string | null | undefined,
  payload: string | MessageCreateOptions,
): Promise<string | null> {
  if (!channelId) return null;
  try {
    const ch = await ctx.client.channels.fetch(channelId);
    if (!ch || !ch.isSendable()) return null;
    const msg = await ch.send(payload);
    return msg.id;
  } catch (err) {
    log.warn({ channelId, err: String(err) }, 'could not send to channel');
    return null;
  }
}

export function logAudit(
  ctx: AppContext,
  guildId: string,
  actorId: string,
  action: string,
  targetId?: string,
  detail?: string,
) {
  ctx.db
    .insert(audit)
    .values({ guildId, actorId, targetId: targetId ?? null, action, detail: detail ?? null })
    .run();
}

/**
 * Apply a placement inside a guild: roles, link row, review row, welcome, modlog.
 * Returns the message components the applicant should see.
 */
export async function applyPlacement(
  ctx: AppContext,
  guild: Guild,
  g: GuildConfig,
  discordId: string,
  scored: Scored,
  placement: Placement,
): Promise<{ content: string; roleError?: string; reviewId?: number }> {
  const { analysis, result, scoreId } = scored;
  const login = analysis.profile.login;
  let roleError: string | undefined;
  let reviewId: number | undefined;

  if (placement.status === 'admitted') {
    upsertLink(ctx, guild.id, discordId, analysis, result, placement.grantTier.name);
    try {
      const member = await guild.members.fetch(discordId);
      await syncTierRoles(member, g.rubric, placement.grantTier.roleId);
    } catch (err) {
      roleError = 'Placed, but I could not update roles. A mod needs to move my role above the tier roles.';
      log.warn({ guildId: guild.id, err: String(err) }, 'role sync failed');
    }
    await sendTo(ctx, g.row.verifyChannelId, {
      embeds: [welcomeEmbed(result, placement, profileOf(analysis), `<@${discordId}>`)],
    });
  }

  if (placement.status === 'review') {
    const row = ctx.db
      .insert(reviews)
      .values({
        guildId: guild.id,
        discordId,
        githubId: analysis.profile.id,
        githubLogin: login,
        scoreId,
        tier: placement.grantTier.name,
        reason: placement.reasons.join('\n'),
      })
      .returning({ id: reviews.id })
      .get();
    reviewId = row.id;
    const messageId = await sendTo(ctx, g.row.reviewChannelId, {
      content: `Review #${row.id} · <@${discordId}> as **${login}**\n${placement.reasons.map((r) => `• ${r}`).join('\n')}`,
      embeds: [receiptEmbed(result, placement, profileOf(analysis), { compact: true })],
      components: [reviewButtons(row.id)],
    });
    if (messageId) ctx.db.update(reviews).set({ messageId }).where(eq(reviews.id, row.id)).run();
  }

  const icon = { admitted: '✅', review: '🟡', rejected: '❌', blocked: '⛔' }[placement.status];
  await sendTo(ctx, g.row.modlogChannelId, {
    content: `${icon} <@${discordId}> → [${login}](<https://github.com/${login}>) · **${result.total}** · ${placement.tier.name} · ${placement.status}${
      placement.flags.length ? ` · flags: ${placement.flags.map((f) => f.code).join(', ')}` : ''
    }`,
    allowedMentions: { parse: [] },
  });
  logAudit(ctx, guild.id, discordId, `verify:${placement.status}`, discordId, `${login} ${result.total}`);

  return { content: statusLine(placement), roleError, reviewId };
}

/** Full pipeline after the OAuth callback. */
export async function completeVerification(
  ctx: AppContext,
  state: VerifyState,
  /** interaction token from /verify, null if the bot restarted since (falls back to a DM) */
  interactionToken: string | null,
  token: string,
  viewerLogin: string,
  viewerId: string,
): Promise<
  | { ok: true; status: Placement['status']; login: string; total: number; tier: string }
  | { ok: false; message: string }
> {
  const guild = await ctx.client.guilds.fetch(state.g).catch(() => null);
  if (!guild) return { ok: false, message: 'I am no longer in that server.' };
  const g = getGuild(ctx, state.g);
  const webhook = interactionToken
    ? new WebhookClient({ id: ctx.cfg.DISCORD_APP_ID, token: interactionToken })
    : null;
  const edit = async (payload: Parameters<WebhookClient['editMessage']>[1]): Promise<void> => {
    if (webhook) {
      const ok = await webhook
        .editMessage('@original', payload)
        .then(() => true)
        .catch((err) => {
          log.warn({ err: String(err) }, 'webhook edit failed');
          return false;
        });
      if (ok) return;
    }
    // no usable interaction: DM the applicant instead
    const user = await ctx.client.users.fetch(state.u).catch(() => null);
    const { components: _c, ...dm } = payload as {
      components?: unknown;
      content?: string;
      embeds?: unknown[];
    };
    await user?.send(dm as Parameters<NonNullable<typeof user>['send']>[0]).catch(() => {});
  };

  const shared = sharedGithub(ctx, state.g, viewerId, state.u);

  let scored: Scored;
  try {
    scored = await runScore(ctx, token, viewerLogin, g.rubric, true);
  } catch (err) {
    log.error({ err: String(err), login: viewerLogin }, 'analysis failed');
    await edit({ content: 'GitHub analysis failed. Try again in a minute.', components: [] });
    return { ok: false, message: 'GitHub analysis failed. Go back to Discord and try again in a minute.' };
  }

  const placement = place(scored.result, scored.analysis, g.rubric, {
    discordCreatedAt: snowflakeToDate(state.u),
    sharedGithub: shared,
  });
  const applied = await applyPlacement(ctx, guild, g, state.u, scored, placement);

  const components = placement.status === 'rejected' ? [requestReviewButton(scored.scoreId)] : [];
  await edit({
    content: [applied.content, applied.roleError].filter(Boolean).join('\n'),
    embeds: [receiptEmbed(scored.result, placement, profileOf(scored.analysis))],
    components,
  });

  log.info(
    {
      guild: state.g,
      user: state.u,
      login: viewerLogin,
      total: scored.result.total,
      tier: placement.tier.name,
      status: placement.status,
      flags: placement.flags.map((f) => f.code),
      ms: scored.analysis.durationMs,
      viaDm: !webhook,
    },
    'verification complete',
  );
  return {
    ok: true,
    status: placement.status,
    login: viewerLogin,
    total: scored.result.total,
    tier: placement.tier.name,
  };
}

export function latestScore(ctx: AppContext, githubId: string) {
  return (
    ctx.db.select().from(scores).where(eq(scores.githubId, githubId)).orderBy(desc(scores.id)).get() ?? null
  );
}
