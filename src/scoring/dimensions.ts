import type { Analysis, RepoInfo } from '../github/types.js';
import { calendarStats } from './calendar.js';
import { clamp01, mean, sat, share } from './sat.js';
import type { Trust } from './trust.js';

export const DIMENSIONS = ['consistency', 'impact', 'collaboration', 'craft', 'community', 'depth'] as const;
export type DimensionKey = (typeof DIMENSIONS)[number];

export interface DimensionResult {
  /** 0..100 */
  score: number;
  /** each signal 0..1 */
  signals: Record<string, number>;
}

export type Dimensions = Record<DimensionKey, DimensionResult>;

/**
 * Share of a dimension's score that comes from its single best signal.
 * Rewards being exceptional at one thing without letting one signal carry a dimension.
 */
export const EXCELLENCE_BLEND = 0.2;

/** A signal value with its weight inside the dimension. Weights favor what is expensive to fake. */
type Sig = { v: number; w: number };

const isExternal = (login: string, owner: string | undefined) =>
  Boolean(owner) && owner!.toLowerCase() !== login.toLowerCase();

/** Probed repos only: those are the only ones with commit counts and craft signals. */
export function topRepos(a: Analysis, n = 10): RepoInfo[] {
  return [...a.repos]
    .filter((r) => r.probed && !r.isArchived && !r.isTemplate)
    .sort((x, y) => y.stars - x.stars || Date.parse(y.pushedAt) - Date.parse(x.pushedAt))
    .slice(0, n);
}

function finish(sigs: Record<string, Sig>): DimensionResult {
  const entries = Object.entries(sigs);
  const wsum = entries.reduce((s, [, x]) => s + x.w, 0);
  const weighted = wsum ? entries.reduce((s, [, x]) => s + clamp01(x.v) * x.w, 0) / wsum : 0;
  const best = entries.length ? Math.max(...entries.map(([, x]) => clamp01(x.v))) : 0;
  const blended = (1 - EXCELLENCE_BLEND) * weighted + EXCELLENCE_BLEND * best;
  return {
    score: Math.round(blended * 100),
    signals: Object.fromEntries(entries.map(([k, x]) => [k, clamp01(x.v)])),
  };
}

export function computeDimensions(a: Analysis, trust: Trust, now = Date.parse(a.fetchedAt)): Dimensions {
  const login = a.profile.login;
  const cal = calendarStats(a, now);
  const y0 = a.years[0] ?? { commits: 0, prs: 0, reviews: 0, issues: 0, restricted: 0, total: 0 };
  const original = a.repos;
  const top = topRepos(a);

  const consistency = finish({
    activeWeeks: { v: cal.activeWeeks / 52, w: 0.35 },
    longestStreak: { v: sat(cal.longestStreakDays, 30), w: 0.2 },
    tenure: { v: a.years.filter((y) => y.total + y.restricted >= 100).length / 3, w: 0.25 },
    recency: {
      v: Number.isFinite(cal.daysSinceLast)
        ? cal.daysSinceLast <= 14
          ? 1
          : clamp01(1 - (cal.daysSinceLast - 14) / 166)
        : 0,
      w: 0.2,
    },
  });

  const stars = original.reduce((s, r) => s + r.stars, 0);
  const impact = finish({
    qualityStars: { v: sat(stars * trust.starQuality, 300), w: 0.4 },
    forks: {
      v: sat(
        original.reduce((s, r) => s + r.forks, 0),
        60,
      ),
      w: 0.25,
    },
    reachOfContribs: {
      v: sat(
        a.contributedTo.repos.reduce((s, r) => s + r.stars, 0),
        5000,
      ),
      w: 0.2,
    },
    distinctUsed: { v: sat(original.filter((r) => r.stars >= 5).length, 5), w: 0.15 },
  });

  const externalPRs = a.mergedPRs.filter((pr) => pr.target && isExternal(login, pr.target.owner));
  const collaboration = finish({
    externalMergedPRs: {
      v: sat(
        externalPRs.reduce((s, pr) => s + Math.log10((pr.target?.stars ?? 0) + 10), 0),
        12,
      ),
      w: 0.4,
    },
    distinctTargets: { v: sat(new Set(externalPRs.map((pr) => pr.target!.nameWithOwner)).size, 6), w: 0.2 },
    reviews: { v: sat(y0.reviews, 30), w: 0.2 },
    issues: { v: sat(y0.issues, 20), w: 0.1 },
    orgs: { v: sat(a.profile.orgs, 3), w: 0.1 },
  });

  const craft = finish({
    commitDepth: { v: top.length ? mean(top.map((r) => sat(r.commits ?? 0, 150))) : 0, w: 0.2 },
    hasCI: { v: share(top.map((r) => r.hasCI)), w: 0.15 },
    hasTests: { v: share(top.map((r) => r.hasTests)), w: 0.15 },
    documented: { v: share(top.map((r) => r.hasReadme && Boolean(r.description))), w: 0.15 },
    licensed: { v: share(top.map((r) => Boolean(r.license))), w: 0.1 },
    languageBreadth: {
      v: sat(new Set(original.map((r) => r.primaryLanguage).filter(Boolean)).size, 4),
      w: 0.1,
    },
    longevity: {
      v: share(top.map((r) => Date.parse(r.pushedAt) - Date.parse(r.createdAt) >= 60 * 86_400_000)),
      w: 0.15,
    },
  });

  const community = finish({
    followers: { v: sat(a.profile.followers * trust.followerQuality, 150), w: 0.6 },
    sponsorable: { v: a.profile.hasSponsorsListing ? 1 : 0, w: 0.2 },
    gists: { v: sat(a.profile.gists, 10), w: 0.2 },
  });

  // privateWork is only observable with the user's own token; scoring from public data drops it
  // instead of penalizing it, and the PUBLIC_ONLY flag says so.
  const depth = finish({
    commitsYear: { v: sat(y0.commits, 600), w: 0.5 },
    ...(a.ownToken ? { privateWork: { v: sat(y0.restricted, 300), w: 0.3 } } : {}),
    prsYear: { v: sat(y0.prs, 60), w: 0.2 },
  });

  return { consistency, impact, collaboration, craft, community, depth };
}

/** Distinct primary languages across original repos, most common first. */
export function languagesOf(a: Analysis): string[] {
  const counts = new Map<string, number>();
  for (const r of a.repos) {
    if (r.primaryLanguage)
      counts.set(r.primaryLanguage, (counts.get(r.primaryLanguage) ?? 0) + 1 + r.stars / 50);
  }
  return [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([k]) => k);
}
