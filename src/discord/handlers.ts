import { gunzipSync } from 'node:zlib';
import {
  AttachmentBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type Interaction,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { and, desc, eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { links, reviews, scores } from '../db/schema.js';
import type { Analysis } from '../github/types.js';
import { log } from '../lib/logger.js';
import { snowflakeToDate } from '../lib/snowflake.js';
import { newNonce, signState } from '../lib/state.js';
import {
  applyPreset,
  DIMENSION_LABELS,
  DIMENSIONS,
  PRESETS,
  type PresetName,
  parseRubric,
  place,
  rubricSchema,
  type ScoreResult,
  tierIndex,
} from '../scoring/index.js';
import { type GuildConfig, getGuild, isConfigured, updateGuild } from '../services/guilds.js';
import {
  applyPlacement,
  latestScore,
  logAudit,
  runScore,
  sendTo,
  syncTierRoles,
  upsertLink,
} from '../services/verification.js';
import { COLORS, linkButton, receiptEmbed } from './receipt.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

function isMod(i: ChatInputCommandInteraction | ButtonInteraction): boolean {
  return Boolean(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

function scoreFromRow(row: typeof scores.$inferSelect): { result: ScoreResult; analysis: Analysis | null } {
  const result = JSON.parse(row.result) as ScoreResult;
  const analysis = row.analysis ? (JSON.parse(gunzipSync(row.analysis).toString('utf8')) as Analysis) : null;
  return { result, analysis };
}

export function makeInteractionHandler(ctx: AppContext) {
  return async (interaction: Interaction): Promise<void> => {
    try {
      if (interaction.isChatInputCommand()) await handleCommand(ctx, interaction);
      else if (interaction.isButton()) await handleButton(ctx, interaction);
    } catch (err) {
      log.error({ err: err instanceof Error ? err.stack : String(err) }, 'interaction failed');
      if (interaction.isRepliable()) {
        const content = 'Something broke on my end. Try again, or ping a mod.';
        if (interaction.deferred || interaction.replied)
          await interaction.editReply({ content }).catch(() => {});
        else await interaction.reply({ content, ...EPHEMERAL }).catch(() => {});
      }
    }
  };
}

async function handleCommand(ctx: AppContext, i: ChatInputCommandInteraction): Promise<void> {
  if (!i.inCachedGuild()) {
    await i.reply({ content: 'Use this inside a server.', ...EPHEMERAL });
    return;
  }
  switch (i.commandName) {
    case 'verify':
      return verify(ctx, i);
    case 'score':
      return scoreCmd(ctx, i);
    case 'unlink':
      return unlink(ctx, i);
    case 'leaderboard':
      return leaderboard(ctx, i);
    case 'setup':
      return setup(ctx, i);
    case 'rubric':
      return rubric(ctx, i);
    case 'whois':
      return whois(ctx, i);
    case 'rescore':
      return rescore(ctx, i);
    case 'review':
      return reviewList(ctx, i);
    default:
      await i.reply({ content: 'Unknown command.', ...EPHEMERAL });
  }
}

// ---------- member commands ----------

async function verify(ctx: AppContext, i: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const g = getGuild(ctx, i.guildId);
  if (!isConfigured(g)) {
    await i.reply({ content: 'This server has not run `/setup` yet. Ping an admin.', ...EPHEMERAL });
    return;
  }
  if (g.row.verifyChannelId && i.channelId !== g.row.verifyChannelId) {
    await i.reply({ content: `Run this in <#${g.row.verifyChannelId}>.`, ...EPHEMERAL });
    return;
  }
  const existing = ctx.db
    .select()
    .from(links)
    .where(and(eq(links.guildId, i.guildId), eq(links.discordId, i.user.id)))
    .get();
  if (existing) {
    await i.reply({
      content: `You're already verified as **${existing.githubLogin}** (${existing.tier}, ${existing.score}/100). Run \`/unlink\` first to link a different account.`,
      ...EPHEMERAL,
    });
    return;
  }
  const nonce = newNonce();
  ctx.verifier.remember(nonce, i.token);
  const state = signState(ctx.cfg.STATE_SECRET, { g: i.guildId, u: i.user.id, c: i.channelId, n: nonce });
  const url = `${ctx.cfg.PUBLIC_URL}/auth/start?s=${encodeURIComponent(state)}`;
  await i.reply({
    content:
      'Click the button, sign in with GitHub, and come back. The link is yours only and expires in 10 minutes.\n' +
      'I read public data plus your own contribution counts. No repo access, and I never store the token.',
    components: [linkButton(url)],
    ...EPHEMERAL,
  });
}

async function scoreCmd(ctx: AppContext, i: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const target = i.options.getUser('user');
  if (target && target.id !== i.user.id && !isMod(i)) {
    await i.reply({ content: 'Only mods can view other members’ receipts.', ...EPHEMERAL });
    return;
  }
  const userId = target?.id ?? i.user.id;
  await showReceipt(ctx, i, userId);
}

async function showReceipt(
  ctx: AppContext,
  i: ChatInputCommandInteraction<'cached'>,
  userId: string,
): Promise<void> {
  const g = getGuild(ctx, i.guildId);
  const link = ctx.db
    .select()
    .from(links)
    .where(and(eq(links.guildId, i.guildId), eq(links.discordId, userId)))
    .get();
  if (!link) {
    await i.reply({
      content: userId === i.user.id ? 'You have not verified yet. Run `/verify`.' : 'Not linked.',
      ...EPHEMERAL,
    });
    return;
  }
  const row = latestScore(ctx, link.githubId);
  if (!row) {
    await i.reply({ content: 'Linked, but no stored score. Ask a mod to `/rescore`.', ...EPHEMERAL });
    return;
  }
  const { result, analysis } = scoreFromRow(row);
  const placement = analysis
    ? place(result, analysis, g.rubric, { discordCreatedAt: snowflakeToDate(userId), sharedGithub: false })
    : null;
  const profile = { login: link.githubLogin, avatarUrl: analysis?.profile.avatarUrl ?? '' };
  const embed = placement
    ? receiptEmbed(result, placement, profile)
    : new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle(`${link.githubLogin} · ${result.total}/100 · ${link.tier}`);
  await i.reply({ embeds: [embed], ...EPHEMERAL });
}

async function unlink(ctx: AppContext, i: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const g = getGuild(ctx, i.guildId);
  const link = ctx.db
    .select()
    .from(links)
    .where(and(eq(links.guildId, i.guildId), eq(links.discordId, i.user.id)))
    .get();
  if (!link) {
    await i.reply({ content: 'Nothing linked.', ...EPHEMERAL });
    return;
  }
  ctx.db.delete(links).where(eq(links.id, link.id)).run();
  const elsewhere = ctx.db
    .select({ id: links.id })
    .from(links)
    .where(eq(links.githubId, link.githubId))
    .get();
  if (!elsewhere) ctx.db.delete(scores).where(eq(scores.githubId, link.githubId)).run();
  try {
    await syncTierRoles(i.member, g.rubric, null);
  } catch (err) {
    log.warn({ err: String(err) }, 'role removal failed on unlink');
  }
  logAudit(ctx, i.guildId, i.user.id, 'unlink', i.user.id, link.githubLogin);
  await i.reply({
    content: `Unlinked **${link.githubLogin}** and removed tier roles. Your stored data is gone.`,
    ...EPHEMERAL,
  });
}

async function leaderboard(ctx: AppContext, i: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const rows = ctx.db
    .select()
    .from(links)
    .where(and(eq(links.guildId, i.guildId), eq(links.leaderboardOptOut, false)))
    .orderBy(desc(links.score))
    .limit(10)
    .all();
  if (!rows.length) {
    await i.reply({ content: 'Nobody has verified yet.', ...EPHEMERAL });
    return;
  }
  const lines = rows.map(
    (r, idx) =>
      `**${idx + 1}.** <@${r.discordId}> · [${r.githubLogin}](<https://github.com/${r.githubLogin}>) · **${r.score}** · ${r.tier}`,
  );
  await i.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle('Cracked leaderboard')
        .setDescription(lines.join('\n')),
    ],
    allowedMentions: { parse: [] },
  });
}

// ---------- admin commands ----------

async function setup(ctx: AppContext, i: ChatInputCommandInteraction<'cached'>): Promise<void> {
  if (!isMod(i)) return deny(i);
  const verifyCh = i.options.getChannel('verify-channel', true);
  const modlog = i.options.getChannel('modlog-channel');
  const review = i.options.getChannel('review-channel');
  const g = updateGuild(ctx, i.guildId, {
    verifyChannelId: verifyCh.id,
    modlogChannelId: modlog?.id ?? null,
    reviewChannelId: review?.id ?? null,
  });
  const me = await i.guild.members.fetchMe();
  const tierRoles = g.rubric.tiers.filter((t) => t.roleId);
  const unreachable = tierRoles.filter((t) => {
    const role = i.guild.roles.cache.get(t.roleId!);
    return role && role.position >= me.roles.highest.position;
  });
  const warn = unreachable.length
    ? `\n⚠️ My role sits below: ${unreachable.map((t) => `<@&${t.roleId}>`).join(', ')}. Move my role above them or I cannot assign them.`
    : '';
  const mapped = tierRoles.length
    ? tierRoles.map((t) => `${t.name} → <@&${t.roleId}>`).join(', ')
    : 'none yet, use `/rubric tier <name> <role>`';
  logAudit(ctx, i.guildId, i.user.id, 'setup');
  await i.reply({
    content: `Saved.\n• verify: <#${verifyCh.id}>\n• modlog: ${modlog ? `<#${modlog.id}>` : 'off'}\n• review: ${review ? `<#${review.id}>` : 'off'}\n• tier roles: ${mapped}\n• preset: ${g.rubric.preset}, entry tier: ${g.rubric.entryTier}${warn}`,
    allowedMentions: { parse: [] },
    ...EPHEMERAL,
  });
}

async function rubric(ctx: AppContext, i: ChatInputCommandInteraction<'cached'>): Promise<void> {
  if (!isMod(i)) return deny(i);
  const sub = i.options.getSubcommand();
  const g = getGuild(ctx, i.guildId);

  if (sub === 'view') {
    await i.reply({ embeds: [rubricEmbed(g)], ...EPHEMERAL });
    return;
  }
  if (sub === 'preset') {
    const name = i.options.getString('name', true) as PresetName;
    const next = updateGuild(ctx, i.guildId, { rubric: applyPreset(g.rubric, name) });
    logAudit(ctx, i.guildId, i.user.id, 'rubric:preset', undefined, name);
    await i.reply({
      content: `Applied **${name}**: ${PRESETS[name].description}`,
      embeds: [rubricEmbed(next)],
      ...EPHEMERAL,
    });
    return;
  }
  if (sub === 'tier') {
    const name = i.options.getString('name', true);
    const role = i.options.getRole('role');
    const idx = tierIndex(g.rubric, name);
    if (idx < 0) {
      await i.reply({
        content: `No tier named **${name}**. Tiers: ${g.rubric.tiers.map((t) => t.name).join(', ')}`,
        ...EPHEMERAL,
      });
      return;
    }
    const tiers = g.rubric.tiers.map((t, k) => (k === idx ? { ...t, roleId: role?.id ?? null } : t));
    const next = updateGuild(ctx, i.guildId, { rubric: rubricSchema.parse({ ...g.rubric, tiers }) });
    logAudit(ctx, i.guildId, i.user.id, 'rubric:tier', undefined, `${name}=${role?.id ?? 'none'}`);
    await i.reply({
      content: role
        ? `**${next.rubric.tiers[idx]!.name}** now grants <@&${role.id}>.`
        : `**${name}** no longer grants a role.`,
      allowedMentions: { parse: [] },
      ...EPHEMERAL,
    });
    return;
  }
  if (sub === 'entry') {
    const name = i.options.getString('name', true);
    const idx = tierIndex(g.rubric, name);
    if (idx < 0) {
      await i.reply({ content: `No tier named **${name}**.`, ...EPHEMERAL });
      return;
    }
    updateGuild(ctx, i.guildId, {
      rubric: rubricSchema.parse({ ...g.rubric, entryTier: g.rubric.tiers[idx]!.name }),
    });
    await i.reply({ content: `Entry tier is now **${g.rubric.tiers[idx]!.name}**.`, ...EPHEMERAL });
    return;
  }
  if (sub === 'export') {
    const file = new AttachmentBuilder(Buffer.from(JSON.stringify(g.rubric, null, 2)), {
      name: 'rubric.json',
    });
    await i.reply({ files: [file], ...EPHEMERAL });
    return;
  }
  if (sub === 'import') {
    const att = i.options.getAttachment('file', true);
    if (att.size > 64_000) {
      await i.reply({ content: 'File too large.', ...EPHEMERAL });
      return;
    }
    await i.deferReply(EPHEMERAL);
    let json: unknown;
    try {
      json = await (await fetch(att.url, { signal: AbortSignal.timeout(10_000) })).json();
    } catch {
      await i.editReply('Could not read that file as JSON.');
      return;
    }
    const parsed = parseRubric(json);
    if (!parsed.ok) {
      await i.editReply(`Invalid rubric:\n${parsed.errors.map((e) => `• ${e}`).join('\n')}`);
      return;
    }
    const next = updateGuild(ctx, i.guildId, { rubric: parsed.rubric });
    logAudit(ctx, i.guildId, i.user.id, 'rubric:import');
    await i.editReply({ content: 'Rubric replaced.', embeds: [rubricEmbed(next)] });
  }
}

function rubricEmbed(g: GuildConfig): EmbedBuilder {
  const r = g.rubric;
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(`Rubric · preset ${r.preset}`)
    .addFields(
      { name: 'Weights', value: DIMENSIONS.map((d) => `${DIMENSION_LABELS[d]} ${r.weights[d]}`).join(' · ') },
      {
        name: 'Tiers',
        value: r.tiers
          .map(
            (t) =>
              `${t.name} ≥ ${t.min}${t.roleId ? ` → <@&${t.roleId}>` : ''}${t.name === r.entryTier ? ' (entry)' : ''}`,
          )
          .join('\n'),
      },
      {
        name: 'Gates',
        value: [
          `min account age ${r.gates.minAccountAgeDays}d`,
          r.gates.requireLanguagesAnyOf.length
            ? `languages: ${r.gates.requireLanguagesAnyOf.join(', ')}`
            : 'any language',
          r.gates.requireExternalMergedPR ? 'external merged PR required' : 'no PR requirement',
          `review if score ≥ ${r.gates.reviewBelowScore}`,
          `block on: ${r.gates.blockFlags.join(', ') || 'nothing'}`,
        ].join('\n'),
      },
    );
}

async function whois(ctx: AppContext, i: ChatInputCommandInteraction<'cached'>): Promise<void> {
  if (!isMod(i)) return deny(i);
  const user = i.options.getUser('user', true);
  await showReceipt(ctx, i, user.id);
}

async function rescore(ctx: AppContext, i: ChatInputCommandInteraction<'cached'>): Promise<void> {
  if (!isMod(i)) return deny(i);
  const token = ctx.cfg.GITHUB_APP_FALLBACK_TOKEN;
  if (!token) {
    await i.reply({ content: 'Set `GITHUB_APP_FALLBACK_TOKEN` to enable rescoring.', ...EPHEMERAL });
    return;
  }
  const user = i.options.getUser('user', true);
  const g = getGuild(ctx, i.guildId);
  const link = ctx.db
    .select()
    .from(links)
    .where(and(eq(links.guildId, i.guildId), eq(links.discordId, user.id)))
    .get();
  if (!link) {
    await i.reply({ content: 'That member has not linked a GitHub account.', ...EPHEMERAL });
    return;
  }
  await i.deferReply(EPHEMERAL);
  const scored = await runScore(ctx, token, link.githubLogin, g.rubric, false);
  const placement = place(scored.result, scored.analysis, g.rubric, {
    discordCreatedAt: snowflakeToDate(user.id),
    sharedGithub: false,
  });
  const prevIdx = tierIndex(g.rubric, link.tier);
  const nextIdx = tierIndex(g.rubric, placement.tier.name);
  const demote = g.rubric.rescore.demote;
  let note: string;
  if (placement.status === 'admitted' && (nextIdx > prevIdx || demote)) {
    upsertLink(ctx, i.guildId, user.id, scored.analysis, scored.result, placement.grantTier.name);
    const member = await i.guild.members.fetch(user.id);
    await syncTierRoles(member, g.rubric, placement.grantTier.roleId);
    note = `Updated: ${link.tier} → ${placement.grantTier.name}.`;
  } else {
    ctx.db
      .update(links)
      .set({ score: scored.result.total, rescoredAt: new Date().toISOString() })
      .where(eq(links.id, link.id))
      .run();
    note = `Score refreshed (${scored.result.total}). Tier kept at ${link.tier}${nextIdx < prevIdx && !demote ? ' because demotion is off' : ''}.`;
  }
  logAudit(ctx, i.guildId, i.user.id, 'rescore', user.id, note);
  await sendTo(ctx, g.row.modlogChannelId, {
    content: `🔁 <@${i.user.id}> rescored <@${user.id}>: ${note}`,
    allowedMentions: { parse: [] },
  });
  await i.editReply({
    content: note,
    embeds: [
      receiptEmbed(scored.result, placement, {
        login: link.githubLogin,
        avatarUrl: scored.analysis.profile.avatarUrl,
      }),
    ],
  });
}

async function reviewList(ctx: AppContext, i: ChatInputCommandInteraction<'cached'>): Promise<void> {
  if (!isMod(i)) return deny(i);
  const open = ctx.db
    .select()
    .from(reviews)
    .where(and(eq(reviews.guildId, i.guildId), eq(reviews.status, 'open')))
    .orderBy(desc(reviews.id))
    .limit(15)
    .all();
  if (!open.length) {
    await i.reply({ content: 'No open reviews.', ...EPHEMERAL });
    return;
  }
  const g = getGuild(ctx, i.guildId);
  const lines = open.map((r) => {
    const link =
      g.row.reviewChannelId && r.messageId
        ? `https://discord.com/channels/${i.guildId}/${g.row.reviewChannelId}/${r.messageId}`
        : null;
    return `**#${r.id}** <@${r.discordId}> as ${r.githubLogin}${link ? ` · [open](${link})` : ''}\n${r.reason
      .split('\n')
      .map((x) => `  • ${x}`)
      .join('\n')}`;
  });
  await i.reply({ content: lines.join('\n').slice(0, 1900), allowedMentions: { parse: [] }, ...EPHEMERAL });
}

async function deny(i: ChatInputCommandInteraction): Promise<void> {
  await i.reply({ content: 'Mods only.', ...EPHEMERAL });
}

// ---------- buttons ----------

async function handleButton(ctx: AppContext, i: ButtonInteraction): Promise<void> {
  if (!i.inCachedGuild()) return;
  const [ns, action, idStr] = i.customId.split(':');
  const id = Number(idStr);

  if (ns === 'review' && (action === 'approve' || action === 'deny')) {
    if (!isMod(i)) {
      await i.reply({ content: 'Mods only.', ...EPHEMERAL });
      return;
    }
    const r = ctx.db.select().from(reviews).where(eq(reviews.id, id)).get();
    if (!r || r.guildId !== i.guildId) {
      await i.reply({ content: 'Review not found.', ...EPHEMERAL });
      return;
    }
    if (r.status !== 'open') {
      await i.reply({ content: `Already ${r.status}.`, ...EPHEMERAL });
      return;
    }
    const g = getGuild(ctx, i.guildId);
    await i.deferUpdate();
    if (action === 'approve') {
      const row = ctx.db.select().from(scores).where(eq(scores.id, r.scoreId)).get();
      const { result, analysis } = row ? scoreFromRow(row) : { result: null, analysis: null };
      const tier =
        g.rubric.tiers.find((t) => t.name === r.tier) ??
        g.rubric.tiers[tierIndex(g.rubric, g.rubric.entryTier)]!;
      if (analysis && result) upsertLink(ctx, i.guildId, r.discordId, analysis, result, tier.name);
      let roleNote = '';
      try {
        const member = await i.guild.members.fetch(r.discordId);
        await syncTierRoles(member, g.rubric, tier.roleId);
      } catch {
        roleNote = ' (role assignment failed, check my role position)';
      }
      ctx.db
        .update(reviews)
        .set({ status: 'approved', resolvedAt: new Date().toISOString(), resolvedBy: i.user.id })
        .where(eq(reviews.id, id))
        .run();
      logAudit(ctx, i.guildId, i.user.id, 'review:approve', r.discordId, `${r.githubLogin} as ${tier.name}`);
      await i.editReply({
        content: `${i.message.content}\n\n✅ Approved by <@${i.user.id}> as **${tier.name}**${roleNote}`,
        components: [],
      });
      await sendTo(ctx, g.row.verifyChannelId, {
        content: `✅ <@${r.discordId}> verified as **${r.githubLogin}** (${tier.name}), approved by a mod.`,
      });
    } else {
      ctx.db
        .update(reviews)
        .set({ status: 'denied', resolvedAt: new Date().toISOString(), resolvedBy: i.user.id })
        .where(eq(reviews.id, id))
        .run();
      logAudit(ctx, i.guildId, i.user.id, 'review:deny', r.discordId, r.githubLogin);
      await i.editReply({ content: `${i.message.content}\n\n❌ Denied by <@${i.user.id}>`, components: [] });
    }
    return;
  }

  if (ns === 'verify' && action === 'review') {
    const g = getGuild(ctx, i.guildId);
    const row = ctx.db.select().from(scores).where(eq(scores.id, id)).get();
    if (!row) {
      await i.reply({ content: 'That result expired. Run `/verify` again.', ...EPHEMERAL });
      return;
    }
    const already = ctx.db
      .select({ id: reviews.id })
      .from(reviews)
      .where(
        and(eq(reviews.guildId, i.guildId), eq(reviews.discordId, i.user.id), eq(reviews.status, 'open')),
      )
      .get();
    if (already) {
      await i.reply({ content: `You already have review #${already.id} open.`, ...EPHEMERAL });
      return;
    }
    const { result, analysis } = scoreFromRow(row);
    if (!analysis) {
      await i.reply({ content: 'That result expired. Run `/verify` again.', ...EPHEMERAL });
      return;
    }
    const placement = place(result, analysis, g.rubric, {
      discordCreatedAt: snowflakeToDate(i.user.id),
      sharedGithub: false,
    });
    const forced = {
      ...placement,
      status: 'review' as const,
      reasons: ['Member requested manual review', ...placement.reasons],
    };
    const applied = await applyPlacement(
      ctx,
      i.guild,
      g,
      i.user.id,
      { analysis, result, scoreId: row.id },
      forced,
    );
    await i.update({
      content: `🟡 Review #${applied.reviewId} opened. A mod will take a look.`,
      components: [],
    });
  }
}
