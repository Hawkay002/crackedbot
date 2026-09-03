import { log } from '../lib/logger.js';
import { GitHubError, gql } from './graphql.js';
import { buildProbeQuery, COLLAB_QUERY, PROFILE_QUERY, REPO_LIST_QUERY } from './queries.js';
import type { Analysis, Raw, RepoInfo } from './types.js';

export class UserNotFound extends Error {
  constructor(login: string) {
    super(`GitHub user not found: ${login}`);
    this.name = 'UserNotFound';
  }
}

const DAY = 86_400_000;
/** how many top repos get commit counts and craft probes */
export const PROBE_COUNT = 10;
/** stargazers are only sampled when the top repo is in the range people actually buy stars for */
export const STAR_SAMPLE_MIN = 10;
export const STAR_SAMPLE_MAX = 5000;

function iso(t: number): string {
  return new Date(t).toISOString();
}

function toRepo(r: Raw.RepoMeta): RepoInfo {
  return {
    name: r.name,
    nameWithOwner: r.nameWithOwner,
    isArchived: r.isArchived,
    isTemplate: r.isTemplate,
    stars: r.stargazerCount,
    forks: r.forkCount,
    description: r.description,
    pushedAt: r.pushedAt,
    createdAt: r.createdAt,
    diskUsageKb: r.diskUsage,
    primaryLanguage: r.primaryLanguage?.name ?? null,
    languages: r.languages.nodes.map((n) => n.name),
    topics: r.repositoryTopics.nodes.map((n) => n.topic.name),
    license: r.licenseInfo?.spdxId ?? null,
    lastCommitAt: r.defaultBranchRef?.target?.committedDate ?? null,
    probed: false,
    commits: null,
    recentCommits: null,
    hasReadme: false,
    hasCI: false,
    hasTests: false,
    hasDockerfile: false,
  };
}

/** The repos worth probing: top by stars, then by recency, skipping archived and templates. */
export function pickProbeTargets(repos: RepoInfo[], n = PROBE_COUNT): RepoInfo[] {
  return [...repos]
    .filter((r) => !r.isArchived && !r.isTemplate)
    .sort((x, y) => y.stars - x.stars || Date.parse(y.pushedAt) - Date.parse(x.pushedAt))
    .slice(0, n);
}

function applyProbe(repo: RepoInfo, p: Raw.RepoProbe): void {
  const target = p.defaultBranchRef?.target ?? null;
  repo.probed = true;
  repo.commits = target?.history.totalCount ?? 0;
  repo.recentCommits = target?.recent.totalCount ?? 0;
  repo.hasReadme = Boolean(p.readme || p.readmeLower || p.readmeBare);
  repo.hasCI = Boolean(p.workflows);
  repo.hasTests = Boolean(p.tests1 || p.tests2 || p.tests3 || p.tests4);
  repo.hasDockerfile = Boolean(p.dockerfile);
}

/**
 * Fetch everything scoring needs for one GitHub user in two parallel phases:
 *   A: profile + contributions (Q1)  ‖  repo listing (Q2a)
 *   B: commit counts + craft probes on the top 10 repos (Q2b)  ‖  PRs, follower and stargazer samples (Q3)
 * A failed Q2a, Q2b, or Q3 is recorded in `incomplete`; scoring zeros those signals and flags INCOMPLETE.
 * A failed Q1 throws, because nothing can be scored without the profile.
 */
export async function analyze(
  token: string,
  login: string,
  opts: { ownToken: boolean; now?: number },
): Promise<Analysis> {
  const now = opts.now ?? Date.now();
  const t0 = Date.now();
  const incomplete: string[] = [];
  let cost = 0;
  let remaining = Number.POSITIVE_INFINITY;
  const account = (rl: Raw.RateLimit) => {
    cost += rl.cost;
    remaining = Math.min(remaining, rl.remaining);
  };
  const fail = (what: string, err: unknown) => {
    incomplete.push(what);
    log.warn(
      { login, what, err: err instanceof GitHubError ? err.message : String(err) },
      'sub-query failed',
    );
  };

  // ---- phase A ----
  const [p, l] = await Promise.allSettled([
    gql<Raw.Profile>(token, PROFILE_QUERY, {
      login,
      from0: iso(now - 365 * DAY),
      to0: iso(now),
      from1: iso(now - 730 * DAY),
      to1: iso(now - 365 * DAY),
      from2: iso(now - 1095 * DAY),
      to2: iso(now - 730 * DAY),
    }),
    gql<Raw.RepoList>(token, REPO_LIST_QUERY, { login }),
  ]);
  if (p.status === 'rejected') throw p.reason;
  if (!p.value.user) throw new UserNotFound(login);
  const u = p.value.user;
  account(p.value.rateLimit);

  let repos: RepoInfo[] = [];
  if (l.status === 'fulfilled' && l.value.user) {
    const seen = new Map<string, Raw.RepoMeta>();
    for (const node of [...l.value.user.byStars.nodes, ...l.value.user.byPush.nodes]) {
      if (!node.isPrivate && !seen.has(node.nameWithOwner)) seen.set(node.nameWithOwner, node);
    }
    repos = [...seen.values()].map(toRepo);
    account(l.value.rateLimit);
  } else {
    fail('repos', l.status === 'rejected' ? l.reason : 'no user');
  }

  // ---- phase B ----
  const targets = pickProbeTargets(repos);
  const top = targets[0] ?? null;
  const sampleStars = Boolean(top && top.stars >= STAR_SAMPLE_MIN && top.stars <= STAR_SAMPLE_MAX);

  const [pr, c] = await Promise.allSettled([
    targets.length
      ? gql<Raw.Probes>(token, buildProbeQuery(targets.map((r) => r.name)), {
          login,
          since: iso(now - 365 * DAY),
        })
      : Promise.resolve(null),
    gql<Raw.Collab>(token, COLLAB_QUERY, {
      login,
      owner: login,
      name: top?.name ?? '-',
      hasTop: sampleStars,
    }),
  ]);

  if (pr.status === 'fulfilled') {
    if (pr.value) {
      account(pr.value.rateLimit);
      targets.forEach((repo, i) => {
        const probe = pr.value![`r${i}`] as Raw.RepoProbe | null | undefined;
        if (probe && 'name' in probe) applyProbe(repo, probe);
      });
    }
  } else {
    fail('probes', pr.reason);
  }

  let collab: Raw.Collab | null = null;
  if (c.status === 'fulfilled') {
    collab = c.value;
    account(c.value.rateLimit);
  } else {
    fail('collab', c.reason);
  }

  // ---- normalize ----
  const calendar = u.y0.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays)
    .map((d) => ({ date: d.date, count: d.contributionCount }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const year = (x: Raw.ContribLite) => ({
    commits: x.totalCommitContributions,
    prs: x.totalPullRequestContributions,
    reviews: x.totalPullRequestReviewContributions,
    issues: x.totalIssueContributions,
    restricted: x.restrictedContributionsCount,
    total:
      x.totalCommitContributions +
      x.totalPullRequestContributions +
      x.totalPullRequestReviewContributions +
      x.totalIssueContributions,
  });

  return {
    fetchedAt: iso(now),
    ownToken: opts.ownToken,
    profile: {
      id: String(u.databaseId),
      login: u.login,
      name: u.name,
      bio: u.bio,
      avatarUrl: u.avatarUrl,
      company: u.company,
      websiteUrl: u.websiteUrl,
      createdAt: u.createdAt,
      hasSponsorsListing: u.hasSponsorsListing,
      followers: u.followers.totalCount,
      following: u.following.totalCount,
      orgs: u.organizations.totalCount,
      gists: u.gists.totalCount,
      starred: u.starredRepositories.totalCount,
      totalRepos: u.repositories.totalCount,
      forkRepos: u.forks.totalCount,
    },
    years: [year(u.y0), year(u.y1), year(u.y2)],
    calendar,
    commitsByRepo: u.y0.commitContributionsByRepository.map((x) => ({
      nameWithOwner: x.repository.nameWithOwner,
      owner: x.repository.owner.login,
      stars: x.repository.stargazerCount,
      isFork: x.repository.isFork,
      commits: x.contributions.totalCount,
    })),
    contributedTo: {
      totalCount: u.repositoriesContributedTo.totalCount,
      repos: u.repositoriesContributedTo.nodes.map((n) => ({
        nameWithOwner: n.nameWithOwner,
        stars: n.stargazerCount,
        isFork: n.isFork,
      })),
    },
    repos,
    mergedPRs:
      collab?.user?.pullRequests.nodes.map((x) => ({
        mergedAt: x.mergedAt,
        additions: x.additions,
        deletions: x.deletions,
        target: x.baseRepository
          ? {
              nameWithOwner: x.baseRepository.nameWithOwner,
              owner: x.baseRepository.owner.login,
              stars: x.baseRepository.stargazerCount,
            }
          : null,
      })) ?? [],
    followerSample:
      collab?.user?.followers.nodes.map((f) => ({
        createdAt: f.createdAt,
        followers: f.followers.totalCount,
        repos: f.repositories.totalCount,
      })) ?? [],
    stargazerSample:
      collab?.repository?.stargazers.nodes.map((s) => ({
        createdAt: s.createdAt,
        followers: s.followers.totalCount,
      })) ?? [],
    incomplete,
    rateLimit: { cost, remaining: Number.isFinite(remaining) ? remaining : 0 },
    durationMs: Date.now() - t0,
  };
}
