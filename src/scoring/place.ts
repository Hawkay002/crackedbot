import type { Analysis } from '../github/types.js';
import { daysSince } from '../lib/snowflake.js';
import type { ScoreResult } from './index.js';
import { type Rubric, type Tier, tierFor, tierIndex } from './rubric.js';
import type { Flag } from './trust.js';

export type PlacementStatus = 'admitted' | 'review' | 'rejected' | 'blocked';

export interface Placement {
  status: PlacementStatus;
  /** tier the score lands in, regardless of admission */
  tier: Tier;
  /** tier whose role should be granted on admission (never below entry tier when approved by a mod) */
  grantTier: Tier;
  reasons: string[];
  /** flags including context flags (DISCORD_FRESH, SHARED_GITHUB) */
  flags: Flag[];
}

export interface PlacementContext {
  discordCreatedAt: Date;
  /** true when this GitHub account is already linked to a different Discord user in this guild */
  sharedGithub: boolean;
  now?: number;
}

export function place(
  result: ScoreResult,
  analysis: Analysis,
  rubric: Rubric,
  ctx: PlacementContext,
): Placement {
  const now = ctx.now ?? Date.now();
  const flags: Flag[] = [...result.trust.flags];
  const reasons: string[] = [];

  if (ctx.sharedGithub) {
    flags.push({
      code: 'SHARED_GITHUB',
      detail: 'this GitHub account is already linked to another member of this server',
      multiplier: 1,
    });
  }
  const discordAge = daysSince(ctx.discordCreatedAt, now);
  if (discordAge < 14) {
    flags.push({
      code: 'DISCORD_FRESH',
      detail: `Discord account is ${Math.floor(discordAge)} days old`,
      multiplier: 1,
    });
  }

  const tier = tierFor(rubric, result.total);
  const entryIdx = tierIndex(rubric, rubric.entryTier);
  const entryTier = rubric.tiers[entryIdx] ?? rubric.tiers[0]!;
  const grantTier = tierIndex(rubric, tier.name) >= entryIdx ? tier : entryTier;

  const blocked = flags.filter((f) => rubric.gates.blockFlags.includes(f.code));
  if (blocked.length) {
    return {
      status: 'blocked',
      tier,
      grantTier,
      reasons: blocked.map((f) => `${f.code}: ${f.detail}`),
      flags,
    };
  }

  const ageDays = daysSince(analysis.profile.createdAt, now);
  if (ageDays < rubric.gates.minAccountAgeDays) {
    reasons.push(
      `GitHub account must be at least ${rubric.gates.minAccountAgeDays} days old (yours is ${Math.floor(ageDays)})`,
    );
  }
  const want = rubric.gates.requireLanguagesAnyOf;
  if (want.length) {
    const have = new Set(result.languages.map((l) => l.toLowerCase()));
    if (!want.some((w) => have.has(w.toLowerCase()))) {
      reasons.push(`this server requires work in one of: ${want.join(', ')}`);
    }
  }
  if (rubric.gates.requireExternalMergedPR) {
    const login = analysis.profile.login.toLowerCase();
    const has = analysis.mergedPRs.some((pr) => pr.target && pr.target.owner.toLowerCase() !== login);
    if (!has) reasons.push('this server requires at least one merged PR into a repo you do not own');
  }

  const admitted = tierIndex(rubric, tier.name) >= entryIdx;
  if (!admitted) {
    reasons.push(`score ${result.total} is below the ${entryTier.name} bar of ${entryTier.min}`);
  }

  const reviewFlags = flags.filter((f) => f.code === 'DISCORD_FRESH' || f.code === 'INCOMPLETE');
  if (reviewFlags.length) {
    for (const f of reviewFlags) reasons.push(`${f.code}: ${f.detail}`);
    return { status: 'review', tier, grantTier, reasons, flags };
  }
  if (reasons.length === 0) return { status: 'admitted', tier, grantTier, reasons, flags };
  // gate failures on an otherwise admitted score, and near misses, go to a human
  if (admitted || result.total >= rubric.gates.reviewBelowScore) {
    return { status: 'review', tier, grantTier, reasons, flags };
  }
  return { status: 'rejected', tier, grantTier, reasons, flags };
}
