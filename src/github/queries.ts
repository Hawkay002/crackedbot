const CONTRIB_LITE = `
  fragment ContribLite on ContributionsCollection {
    totalCommitContributions
    totalPullRequestContributions
    totalPullRequestReviewContributions
    totalIssueContributions
    restrictedContributionsCount
  }`;

/** Q1: profile, three years of contribution totals, last year's calendar. ~1 point. */
export const PROFILE_QUERY = `
  query Profile($login: String!, $from0: DateTime!, $to0: DateTime!, $from1: DateTime!, $to1: DateTime!, $from2: DateTime!, $to2: DateTime!) {
    rateLimit { cost remaining }
    user(login: $login) {
      id databaseId login name bio avatarUrl company websiteUrl createdAt hasSponsorsListing
      followers { totalCount }
      following { totalCount }
      organizations { totalCount }
      gists { totalCount }
      starredRepositories { totalCount }
      repositories(ownerAffiliations: OWNER) { totalCount }
      forks: repositories(ownerAffiliations: OWNER, isFork: true) { totalCount }
      y0: contributionsCollection(from: $from0, to: $to0) {
        ...ContribLite
        contributionCalendar {
          totalContributions
          weeks { contributionDays { contributionCount date } }
        }
        commitContributionsByRepository(maxRepositories: 25) {
          repository { nameWithOwner owner { login } stargazerCount isFork }
          contributions { totalCount }
        }
      }
      y1: contributionsCollection(from: $from1, to: $to1) { ...ContribLite }
      y2: contributionsCollection(from: $from2, to: $to2) { ...ContribLite }
      repositoriesContributedTo(first: 50, includeUserRepositories: false, contributionTypes: [COMMIT, PULL_REQUEST, PULL_REQUEST_REVIEW]) {
        totalCount
        nodes { nameWithOwner stargazerCount isFork }
      }
    }
  }
  ${CONTRIB_LITE}`;

/**
 * Q2a: cheap repo listing, metadata only. No commit counts, no tree probes.
 * Those are expensive on big repos and go in Q2b for the top 10 only.
 */
export const REPO_LIST_QUERY = `
  query Repos($login: String!) {
    rateLimit { cost remaining }
    user(login: $login) {
      byStars: repositories(first: 30, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, orderBy: { field: STARGAZERS, direction: DESC }) {
        nodes { ...RepoMeta }
      }
      byPush: repositories(first: 30, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, orderBy: { field: PUSHED_AT, direction: DESC }) {
        nodes { ...RepoMeta }
      }
    }
  }
  fragment RepoMeta on Repository {
    name nameWithOwner isArchived isTemplate isPrivate stargazerCount forkCount description pushedAt createdAt diskUsage
    primaryLanguage { name }
    languages(first: 5, orderBy: { field: SIZE, direction: DESC }) { nodes { name } }
    repositoryTopics(first: 5) { nodes { topic { name } } }
    licenseInfo { spdxId }
    defaultBranchRef { target { ... on Commit { committedDate } } }
  }`;

const PROBE_FRAGMENT = `
  fragment Probe on Repository {
    name
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: 1) { totalCount }
          recent: history(first: 1, since: $since) { totalCount }
        }
      }
    }
    readme: object(expression: "HEAD:README.md") { id }
    readmeLower: object(expression: "HEAD:readme.md") { id }
    readmeBare: object(expression: "HEAD:README") { id }
    workflows: object(expression: "HEAD:.github/workflows") { id }
    tests1: object(expression: "HEAD:tests") { id }
    tests2: object(expression: "HEAD:test") { id }
    tests3: object(expression: "HEAD:__tests__") { id }
    tests4: object(expression: "HEAD:spec") { id }
    dockerfile: object(expression: "HEAD:Dockerfile") { id }
  }`;

/** Q2b: commit counts and craft probes for a handful of named repos. Built per call. */
export function buildProbeQuery(names: string[]): string {
  const fields = names
    .map((n, i) => `r${i}: repository(owner: $login, name: ${JSON.stringify(n)}) { ...Probe }`)
    .join('\n      ');
  return `
  query Probes($login: String!, $since: GitTimestamp!) {
    rateLimit { cost remaining }
    ${fields}
  }
  ${PROBE_FRAGMENT}`;
}

/** Q3: merged PRs, follower sample, and a stargazer sample of the top repo when it is in the farmable range. */
export const COLLAB_QUERY = `
  query Collab($login: String!, $owner: String!, $name: String!, $hasTop: Boolean!) {
    rateLimit { cost remaining }
    user(login: $login) {
      pullRequests(first: 50, states: MERGED, orderBy: { field: CREATED_AT, direction: DESC }) {
        totalCount
        nodes {
          mergedAt additions deletions
          baseRepository { nameWithOwner owner { login } stargazerCount }
        }
      }
      followers(first: 30) {
        nodes { createdAt followers { totalCount } repositories { totalCount } }
      }
    }
    repository(owner: $owner, name: $name) @include(if: $hasTop) {
      stargazers(first: 50, orderBy: { field: STARRED_AT, direction: DESC }) {
        nodes { createdAt followers { totalCount } }
      }
    }
  }`;

export const VIEWER_QUERY = `query { viewer { id databaseId login } }`;
