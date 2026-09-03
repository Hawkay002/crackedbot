import type { Analysis, MergedPR, RepoInfo } from '../src/github/types.js';

export const NOW = Date.parse('2026-09-04T00:00:00Z');
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();
const daysAgo = (d: number) => iso(NOW - d * DAY);

/** Deterministic pseudo-random so fixtures are stable. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** 365 days ending today, with `activeShare` of days non-zero and a `burst` count on one day. */
export function calendar(opts: {
  activeShare: number;
  perDay?: number;
  burstDay?: number;
  burstCount?: number;
  seed?: number;
}) {
  const r = rng(opts.seed ?? 1);
  const days: { date: string; count: number }[] = [];
  for (let i = 364; i >= 0; i--) {
    const active = r() < opts.activeShare;
    days.push({
      date: daysAgo(i).slice(0, 10),
      count: active ? Math.max(1, Math.round((opts.perDay ?? 2) * (0.5 + r()))) : 0,
    });
  }
  if (opts.burstDay !== undefined) days[364 - opts.burstDay]!.count += opts.burstCount ?? 0;
  return days;
}

export function repo(p: Partial<RepoInfo> & { name: string }): RepoInfo {
  return {
    nameWithOwner: `dev/${p.name}`,
    isArchived: false,
    isTemplate: false,
    stars: 0,
    forks: 0,
    description: 'a thing',
    pushedAt: daysAgo(10),
    createdAt: daysAgo(400),
    diskUsageKb: 500,
    primaryLanguage: 'TypeScript',
    languages: ['TypeScript'],
    topics: [],
    license: 'MIT',
    probed: true,
    commits: 120,
    recentCommits: null,
    lastCommitAt: daysAgo(10),
    hasReadme: true,
    hasCI: true,
    hasTests: true,
    hasDockerfile: false,
    ...p,
  };
}

export function pr(targetOwner: string, stars: number, daysAgoN = 30): MergedPR {
  return {
    mergedAt: daysAgo(daysAgoN),
    additions: 120,
    deletions: 30,
    target: { nameWithOwner: `${targetOwner}/proj`, owner: targetOwner, stars },
  };
}

export function analysis(p: Partial<Analysis> & { profile?: Partial<Analysis['profile']> }): Analysis {
  const cal = p.calendar ?? calendar({ activeShare: 0.3 });
  const total = cal.reduce((s, d) => s + d.count, 0);
  return {
    fetchedAt: iso(NOW),
    ownToken: true,
    years: p.years ?? [
      { commits: total, prs: 10, reviews: 5, issues: 5, restricted: 0, total: total + 20 },
      { commits: 200, prs: 10, reviews: 5, issues: 5, restricted: 0, total: 220 },
      { commits: 150, prs: 5, reviews: 0, issues: 2, restricted: 0, total: 157 },
    ],
    calendar: cal,
    commitsByRepo: [],
    contributedTo: { totalCount: 0, repos: [] },
    repos: [],
    mergedPRs: [],
    followerSample: [],
    stargazerSample: [],
    incomplete: [],
    rateLimit: { cost: 10, remaining: 4990 },
    durationMs: 0,
    ...p,
    profile: {
      id: '1',
      login: 'dev',
      name: 'Dev Person',
      bio: 'builds things',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
      company: null,
      websiteUrl: null,
      createdAt: daysAgo(4 * 365),
      hasSponsorsListing: false,
      followers: 40,
      following: 30,
      orgs: 1,
      gists: 3,
      starred: 100,
      totalRepos: 12,
      forkRepos: 3,
      ...p.profile,
    },
  };
}

// ---------- archetypes ----------

export const CRACKED = analysis({
  calendar: calendar({ activeShare: 0.85, perDay: 5, seed: 7 }),
  years: [
    { commits: 1400, prs: 90, reviews: 60, issues: 30, restricted: 400, total: 1580 },
    { commits: 1100, prs: 70, reviews: 40, issues: 20, restricted: 300, total: 1230 },
    { commits: 800, prs: 40, reviews: 20, issues: 10, restricted: 100, total: 870 },
  ],
  repos: [
    repo({ name: 'popular', stars: 2400, forks: 210, commits: 900, createdAt: daysAgo(900) }),
    repo({ name: 'mid', stars: 300, forks: 25, commits: 400, primaryLanguage: 'Rust', languages: ['Rust'] }),
    repo({ name: 'small', stars: 40, forks: 3, commits: 80, primaryLanguage: 'Go', languages: ['Go'] }),
    repo({
      name: 'tool',
      stars: 12,
      forks: 1,
      commits: 60,
      primaryLanguage: 'Python',
      languages: ['Python'],
    }),
  ],
  mergedPRs: [
    pr('rust-lang', 90000),
    pr('vercel', 120000),
    pr('denoland', 90000),
    pr('someone', 200),
    pr('other', 30),
  ],
  contributedTo: {
    totalCount: 12,
    repos: [{ nameWithOwner: 'rust-lang/rust', stars: 90000, isFork: false }],
  },
  followerSample: Array.from({ length: 40 }, (_, i) => ({
    createdAt: daysAgo(800 + i * 20),
    followers: 30 + i,
    repos: 10 + i,
  })),
  stargazerSample: Array.from({ length: 60 }, (_, i) => ({
    createdAt: daysAgo(300 + i * 25),
    followers: 5 + (i % 40),
  })),
  profile: {
    followers: 1800,
    orgs: 4,
    hasSponsorsListing: true,
    createdAt: daysAgo(9 * 365),
    totalRepos: 60,
    forkRepos: 10,
  },
});

export const SOLID_MID = analysis({
  calendar: calendar({ activeShare: 0.4, perDay: 2, seed: 3 }),
  repos: [
    repo({ name: 'app', stars: 35, forks: 4, commits: 260 }),
    repo({ name: 'lib', stars: 9, forks: 1, commits: 90, primaryLanguage: 'Python', languages: ['Python'] }),
    repo({ name: 'site', stars: 2, forks: 0, commits: 40, hasTests: false, hasCI: false }),
  ],
  mergedPRs: [pr('someorg', 1500), pr('friend', 12)],
  followerSample: Array.from({ length: 20 }, (_, i) => ({
    createdAt: daysAgo(500 + i * 30),
    followers: 3 + i,
    repos: 4 + i,
  })),
});

export const NEWBIE = analysis({
  calendar: calendar({ activeShare: 0.12, perDay: 1, seed: 5 }),
  years: [
    { commits: 40, prs: 2, reviews: 0, issues: 1, restricted: 0, total: 43 },
    { commits: 0, prs: 0, reviews: 0, issues: 0, restricted: 0, total: 0 },
    { commits: 0, prs: 0, reviews: 0, issues: 0, restricted: 0, total: 0 },
  ],
  repos: [
    repo({
      name: 'portfolio',
      stars: 1,
      commits: 15,
      hasCI: false,
      hasTests: false,
      license: null,
      createdAt: daysAgo(120),
    }),
    repo({
      name: 'todo-app',
      stars: 0,
      commits: 8,
      hasCI: false,
      hasTests: false,
      license: null,
      createdAt: daysAgo(60),
    }),
  ],
  profile: { followers: 3, orgs: 0, gists: 0, createdAt: daysAgo(200), totalRepos: 4, forkRepos: 2 },
});

/** Bought stars: 60 stargazers created in the same fortnight with no followers. */
export const STAR_FARM = analysis({
  calendar: calendar({ activeShare: 0.15, perDay: 1, seed: 11 }),
  repos: [repo({ name: 'viral', stars: 1200, forks: 3, commits: 25, hasCI: false, hasTests: false })],
  stargazerSample: Array.from({ length: 60 }, (_, i) => ({
    createdAt: daysAgo(20 + (i % 10)),
    followers: 0,
  })),
  followerSample: Array.from({ length: 30 }, (_, i) => ({
    createdAt: daysAgo(15 + (i % 5)),
    followers: 0,
    repos: 0,
  })),
  profile: { followers: 900, orgs: 0, createdAt: daysAgo(400), totalRepos: 3, forkRepos: 0 },
});

/** Script that made 2000 commits over one weekend. */
export const COMMIT_BOT = analysis({
  calendar: calendar({ activeShare: 0.01, perDay: 1, burstDay: 3, burstCount: 2000, seed: 13 }),
  years: [
    { commits: 2010, prs: 0, reviews: 0, issues: 0, restricted: 0, total: 2010 },
    { commits: 0, prs: 0, reviews: 0, issues: 0, restricted: 0, total: 0 },
    { commits: 0, prs: 0, reviews: 0, issues: 0, restricted: 0, total: 0 },
  ],
  repos: [
    repo({
      name: 'streak',
      stars: 0,
      commits: 2000,
      hasCI: false,
      hasTests: false,
      license: null,
      createdAt: daysAgo(5),
    }),
  ],
  profile: {
    followers: 0,
    orgs: 0,
    gists: 0,
    name: null,
    bio: null,
    createdAt: daysAgo(100),
    totalRepos: 1,
    forkRepos: 0,
  },
});

/** Forked 40 popular repos, wrote nothing. */
export const FORK_FARM = analysis({
  calendar: calendar({ activeShare: 0.03, perDay: 1, seed: 17 }),
  years: [
    { commits: 8, prs: 0, reviews: 0, issues: 0, restricted: 0, total: 8 },
    { commits: 3, prs: 0, reviews: 0, issues: 0, restricted: 0, total: 3 },
    { commits: 0, prs: 0, reviews: 0, issues: 0, restricted: 0, total: 0 },
  ],
  repos: [repo({ name: 'notes', stars: 0, commits: 2, hasCI: false, hasTests: false, license: null })],
  profile: { followers: 5, orgs: 0, createdAt: daysAgo(700), totalRepos: 42, forkRepos: 41 },
});

/** Fresh account, one hello-world. */
export const EMPTY_ALT = analysis({
  calendar: calendar({ activeShare: 0.01, perDay: 1, seed: 19 }),
  years: [
    { commits: 2, prs: 0, reviews: 0, issues: 0, restricted: 0, total: 2 },
    { commits: 0, prs: 0, reviews: 0, issues: 0, restricted: 0, total: 0 },
    { commits: 0, prs: 0, reviews: 0, issues: 0, restricted: 0, total: 0 },
  ],
  repos: [
    repo({
      name: 'hello',
      stars: 0,
      commits: 1,
      hasCI: false,
      hasTests: false,
      hasReadme: false,
      license: null,
      description: null,
      createdAt: daysAgo(3),
    }),
  ],
  profile: {
    followers: 0,
    orgs: 0,
    gists: 0,
    name: null,
    bio: null,
    createdAt: daysAgo(4),
    totalRepos: 1,
    forkRepos: 0,
  },
});

/** Old account with a good history that stopped 3 years ago. */
export const DORMANT_OLD = analysis({
  calendar: calendar({ activeShare: 0, seed: 23 }),
  years: [
    { commits: 0, prs: 0, reviews: 0, issues: 0, restricted: 0, total: 0 },
    { commits: 0, prs: 0, reviews: 0, issues: 0, restricted: 0, total: 0 },
    { commits: 0, prs: 0, reviews: 0, issues: 0, restricted: 0, total: 0 },
  ],
  repos: [
    repo({
      name: 'old-lib',
      stars: 180,
      forks: 20,
      commits: 300,
      pushedAt: daysAgo(1200),
      lastCommitAt: daysAgo(1200),
      createdAt: daysAgo(2400),
    }),
    repo({
      name: 'old-app',
      stars: 20,
      forks: 2,
      commits: 150,
      pushedAt: daysAgo(1300),
      lastCommitAt: daysAgo(1300),
      createdAt: daysAgo(2000),
    }),
  ],
  mergedPRs: [pr('bigorg', 20000, 1300)],
  profile: { followers: 120, orgs: 2, createdAt: daysAgo(10 * 365), totalRepos: 20, forkRepos: 5 },
});
