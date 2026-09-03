import { describe, expect, it } from 'vitest';
import { DEFAULT_RUBRIC, place, presetRubric, score, tierFor } from '../src/scoring/index.js';
import { sat } from '../src/scoring/sat.js';
import * as F from './fixtures.js';

const ctx = { discordCreatedAt: new Date(F.NOW - 400 * 86_400_000), sharedGithub: false, now: F.NOW };
const tierOf = (a: Parameters<typeof score>[0], rubric = DEFAULT_RUBRIC) =>
  tierFor(rubric, score(a, rubric, F.NOW).total).name;
const rank = (name: string) => DEFAULT_RUBRIC.tiers.findIndex((t) => t.name === name);

describe('sat', () => {
  it('saturates', () => {
    expect(sat(0, 10)).toBe(0);
    expect(sat(10, 10)).toBeCloseTo(0.632, 2);
    expect(sat(1000, 10)).toBeCloseTo(1, 5);
    expect(sat(-5, 10)).toBe(0);
  });
});

describe('archetypes land in the right tier', () => {
  it('cracked profile is Cracked', () => {
    const r = score(F.CRACKED, DEFAULT_RUBRIC, F.NOW);
    expect(r.trust.flags.map((f) => f.code)).toEqual([]);
    expect(r.total).toBeGreaterThanOrEqual(80);
    expect(tierOf(F.CRACKED)).toBe('Cracked');
  });

  it('solid mid profile is Builder or Shipper', () => {
    const r = score(F.SOLID_MID, DEFAULT_RUBRIC, F.NOW);
    expect(r.trust.flags.map((f) => f.code)).toEqual([]);
    expect(rank(tierOf(F.SOLID_MID))).toBeGreaterThanOrEqual(rank('Builder'));
    expect(rank(tierOf(F.SOLID_MID))).toBeLessThanOrEqual(rank('Shipper'));
  });

  it('newbie is Tinkerer at most, but not Tourist under the hackathon preset', () => {
    expect(rank(tierOf(F.NEWBIE))).toBeLessThanOrEqual(rank('Tinkerer'));
    const p = place(
      score(F.NEWBIE, presetRubric('hackathon'), F.NOW),
      F.NEWBIE,
      presetRubric('hackathon'),
      ctx,
    );
    expect(p.status).toBe('admitted');
  });
});

describe('adversarial fixtures never pass', () => {
  it('star farm is flagged and capped at Tinkerer', () => {
    const r = score(F.STAR_FARM, DEFAULT_RUBRIC, F.NOW);
    const codes = r.trust.flags.map((f) => f.code);
    expect(codes).toContain('STAR_FARM');
    expect(codes).toContain('FOLLOWER_FARM');
    expect(r.dimensions.impact.signals.qualityStars).toBeLessThan(0.4);
    expect(rank(tierOf(F.STAR_FARM))).toBeLessThanOrEqual(rank('Tinkerer'));
  });

  it('commit bot is flagged, blocked by default gates', () => {
    const r = score(F.COMMIT_BOT, DEFAULT_RUBRIC, F.NOW);
    const codes = r.trust.flags.map((f) => f.code);
    expect(codes).toContain('BOT_CADENCE');
    expect(codes).toContain('BURST');
    expect(r.total).toBeLessThan(20);
    const p = place(r, F.COMMIT_BOT, DEFAULT_RUBRIC, ctx);
    expect(p.status).toBe('blocked');
  });

  it('fork farm is flagged and Tourist', () => {
    const r = score(F.FORK_FARM, DEFAULT_RUBRIC, F.NOW);
    expect(r.trust.flags.map((f) => f.code)).toContain('FORK_FARM');
    expect(tierOf(F.FORK_FARM)).toBe('Tourist');
  });

  it('empty alt is Tourist and rejected', () => {
    const r = score(F.EMPTY_ALT, DEFAULT_RUBRIC, F.NOW);
    expect(r.trust.flags.map((f) => f.code)).toContain('NEW_ACCOUNT');
    expect(r.trust.multiplier).toBeLessThanOrEqual(0.15 + 1e-9);
    expect(tierOf(F.EMPTY_ALT)).toBe('Tourist');
    expect(place(r, F.EMPTY_ALT, DEFAULT_RUBRIC, ctx).status).toBe('rejected');
  });

  it('dormant old account does not coast on past impact', () => {
    const r = score(F.DORMANT_OLD, DEFAULT_RUBRIC, F.NOW);
    expect(r.dimensions.consistency.score).toBe(0);
    expect(rank(tierOf(F.DORMANT_OLD))).toBeLessThanOrEqual(rank('Tinkerer'));
  });

  it('a cracked profile still outranks every adversarial one by a wide margin', () => {
    const top = score(F.CRACKED, DEFAULT_RUBRIC, F.NOW).total;
    for (const a of [F.STAR_FARM, F.COMMIT_BOT, F.FORK_FARM, F.EMPTY_ALT, F.DORMANT_OLD]) {
      expect(top - score(a, DEFAULT_RUBRIC, F.NOW).total).toBeGreaterThan(40);
    }
  });
});

describe('placement', () => {
  it('shared github blocks', () => {
    const r = score(F.CRACKED, DEFAULT_RUBRIC, F.NOW);
    const p = place(r, F.CRACKED, DEFAULT_RUBRIC, { ...ctx, sharedGithub: true });
    expect(p.status).toBe('blocked');
    expect(p.flags.some((f) => f.code === 'SHARED_GITHUB')).toBe(true);
  });

  it('fresh discord account goes to review even when admitted', () => {
    const r = score(F.CRACKED, DEFAULT_RUBRIC, F.NOW);
    const p = place(r, F.CRACKED, DEFAULT_RUBRIC, {
      ...ctx,
      discordCreatedAt: new Date(F.NOW - 2 * 86_400_000),
    });
    expect(p.status).toBe('review');
    expect(p.tier.name).toBe('Cracked');
  });

  it('language gate sends a strong but off-topic profile to review', () => {
    const rubric = presetRubric('ml');
    const r = score(F.CRACKED, rubric, F.NOW);
    const p = place(r, F.CRACKED, rubric, ctx);
    // CRACKED has Python among its languages, so it passes ml
    expect(p.status).toBe('admitted');
    const systems = presetRubric('mobile');
    const p2 = place(score(F.SOLID_MID, systems, F.NOW), F.SOLID_MID, systems, ctx);
    // SOLID_MID is TypeScript + Python; mobile accepts TypeScript
    expect(p2.status).toBe('admitted');
    const strict = { ...systems, gates: { ...systems.gates, requireLanguagesAnyOf: ['Swift', 'Kotlin'] } };
    const p3 = place(score(F.SOLID_MID, strict, F.NOW), F.SOLID_MID, strict, ctx);
    expect(p3.status).toBe('review');
    expect(p3.reasons[0]).toMatch(/requires work in one of/);
  });

  it('incomplete analysis routes to review, never skips', () => {
    const a = { ...F.SOLID_MID, incomplete: ['collab'] };
    const r = score(a, DEFAULT_RUBRIC, F.NOW);
    expect(r.trust.flags.map((f) => f.code)).toContain('INCOMPLETE');
    expect(place(r, a, DEFAULT_RUBRIC, ctx).status).toBe('review');
  });

  it('grant tier never drops below entry tier on review approval', () => {
    const r = score(F.NEWBIE, DEFAULT_RUBRIC, F.NOW);
    const p = place(r, F.NEWBIE, DEFAULT_RUBRIC, ctx);
    expect(rank(p.grantTier.name)).toBeGreaterThanOrEqual(rank(DEFAULT_RUBRIC.entryTier));
  });
});

describe('explanations', () => {
  it('produce strengths for the strong and tips for the weak', () => {
    const strong = score(F.CRACKED, DEFAULT_RUBRIC, F.NOW);
    expect(strong.explanation.strengths.length).toBeGreaterThan(0);
    const weak = score(F.NEWBIE, DEFAULT_RUBRIC, F.NOW);
    expect(weak.explanation.improvements.length).toBe(3);
  });
});
