import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { Analysis } from '../github/types.js';
import { DIMENSION_LABELS, DIMENSIONS, type Placement, type ScoreResult } from '../scoring/index.js';

export const COLORS = {
  admitted: 0x2ecc71,
  review: 0xf1c40f,
  rejected: 0xe74c3c,
  blocked: 0x95a5a6,
  info: 0x5865f2,
} as const;

export function bar(score: number, width = 10): string {
  const filled = Math.round((Math.max(0, Math.min(100, score)) / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export interface ReceiptProfile {
  login: string;
  avatarUrl: string;
  url?: string;
}

export function profileOf(a: Analysis): ReceiptProfile {
  return {
    login: a.profile.login,
    avatarUrl: a.profile.avatarUrl,
    url: `https://github.com/${a.profile.login}`,
  };
}

export function receiptEmbed(
  result: ScoreResult,
  placement: Placement,
  profile: ReceiptProfile,
  opts: { compact?: boolean } = {},
): EmbedBuilder {
  const url = profile.url ?? `https://github.com/${profile.login}`;
  const e = new EmbedBuilder()
    .setColor(COLORS[placement.status])
    .setTitle(`${profile.login} · ${result.total}/100 · ${placement.tier.name}`)
    .setURL(url)
    .setThumbnail(profile.avatarUrl);

  const dims = DIMENSIONS.map(
    (d) =>
      `\`${bar(result.dimensions[d].score)}\` ${String(result.dimensions[d].score).padStart(3)}  ${DIMENSION_LABELS[d]}`,
  ).join('\n');
  e.addFields({ name: 'Breakdown', value: dims });

  if (!opts.compact) {
    if (result.explanation.strengths.length) {
      e.addFields({ name: 'Strengths', value: result.explanation.strengths.map((s) => `• ${s}`).join('\n') });
    }
    if (result.explanation.improvements.length) {
      e.addFields({
        name: 'Would raise your score',
        value: result.explanation.improvements.map((s) => `• ${s}`).join('\n'),
      });
    }
  }
  const visibleFlags = placement.flags.filter((f) => f.code !== 'PUBLIC_ONLY' || !opts.compact);
  if (visibleFlags.length) {
    e.addFields({
      name: 'Flags',
      value: visibleFlags
        .map((f) => `• **${f.code}** ${f.detail}`)
        .join('\n')
        .slice(0, 1024),
    });
  }
  if (result.trust.multiplier < 1) {
    e.addFields({
      name: 'Trust multiplier',
      value: `×${result.trust.multiplier.toFixed(2)} (raw ${result.raw})`,
      inline: true,
    });
  }
  if (result.languages.length) {
    e.addFields({ name: 'Languages', value: result.languages.slice(0, 6).join(', '), inline: true });
  }
  e.setFooter({ text: `Cracked Score · ${new Date(result.computedAt).toISOString().slice(0, 10)}` });
  return e;
}

export function statusLine(placement: Placement): string {
  switch (placement.status) {
    case 'admitted':
      return `✅ **Admitted as ${placement.grantTier.name}.** Roles updated.`;
    case 'review':
      return `🟡 **Sent to manual review.**\n${placement.reasons.map((r) => `• ${r}`).join('\n')}`;
    case 'rejected':
      return `❌ **Didn't clear the bar.**\n${placement.reasons.map((r) => `• ${r}`).join('\n')}`;
    case 'blocked':
      return `⛔ **Blocked.**\n${placement.reasons.map((r) => `• ${r}`).join('\n')}`;
  }
}

export function welcomeEmbed(
  result: ScoreResult,
  placement: Placement,
  profile: ReceiptProfile,
  mention: string,
) {
  return new EmbedBuilder()
    .setColor(COLORS.admitted)
    .setThumbnail(profile.avatarUrl)
    .setDescription(
      `${mention} verified as [${profile.login}](https://github.com/${profile.login}) · **${result.total}/100 · ${placement.grantTier.name}**`,
    );
}

export function reviewButtons(reviewId: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`review:approve:${reviewId}`)
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`review:deny:${reviewId}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
  );
}

export function requestReviewButton(scoreId: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`verify:review:${scoreId}`)
      .setLabel('Request review')
      .setStyle(ButtonStyle.Secondary),
  );
}

export function linkButton(url: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setLabel('Link GitHub').setStyle(ButtonStyle.Link).setURL(url),
  );
}
