/** Normalized view of everything the analyzer fetched. Scoring works only on this. */
export interface Analysis {
  fetchedAt: string;
  /** true when fetched with the user's own token (restricted contribution counts visible) */
  ownToken: boolean;
  profile: {
    id: string;
    login: string;
    name: string | null;
    bio: string | null;
    avatarUrl: string;
    company: string | null;
    websiteUrl: string | null;
    createdAt: string;
    hasSponsorsListing: boolean;
    followers: number;
    following: number;
    orgs: number;
    gists: number;
    starred: number;
    totalRepos: number;
    forkRepos: number;
  };
  /** index 0 = last 12 months, 1 = the year before, 2 = the year before that */
  years: YearContributions[];
  /** daily contribution counts for the last 12 months, oldest first */
  calendar: { date: string; count: number }[];
  commitsByRepo: { nameWithOwner: string; owner: string; stars: number; isFork: boolean; commits: number }[];
  contributedTo: { totalCount: number; repos: { nameWithOwner: string; stars: number; isFork: boolean }[] };
  /** original (non-fork), public repos owned by the user, de-duplicated. Only `probed` ones carry commit counts and craft signals. */
  repos: RepoInfo[];
  mergedPRs: MergedPR[];
  followerSample: { createdAt: string; followers: number; repos: number }[];
  /** stargazers of the top original repo by stars, only sampled when that repo has 10..5000 stars */
  stargazerSample: { createdAt: string; followers: number }[];
  /** names of sub-queries that failed; scoring treats their signals as zero and flags INCOMPLETE */
  incomplete: string[];
  rateLimit: { cost: number; remaining: number } | null;
  /** wall-clock ms spent fetching */
  durationMs: number;
}

export interface YearContributions {
  commits: number;
  prs: number;
  reviews: number;
  issues: number;
  restricted: number;
  total: number;
}

export interface RepoInfo {
  name: string;
  nameWithOwner: string;
  isArchived: boolean;
  isTemplate: boolean;
  stars: number;
  forks: number;
  description: string | null;
  pushedAt: string;
  createdAt: string;
  diskUsageKb: number;
  primaryLanguage: string | null;
  languages: string[];
  topics: string[];
  license: string | null;
  lastCommitAt: string | null;
  /** true when Q2b ran for this repo; the fields below are only meaningful then */
  probed: boolean;
  /** all-time commits on the default branch */
  commits: number | null;
  /** commits on the default branch in the last 365 days */
  recentCommits: number | null;
  hasReadme: boolean;
  hasCI: boolean;
  hasTests: boolean;
  hasDockerfile: boolean;
}

export interface MergedPR {
  mergedAt: string;
  additions: number;
  deletions: number;
  target: { nameWithOwner: string; owner: string; stars: number } | null;
}

/** Raw GraphQL shapes, only what we read. */
export namespace Raw {
  export interface Count {
    totalCount: number;
  }
  export interface RateLimit {
    cost: number;
    remaining: number;
  }
  export interface ContribLite {
    totalCommitContributions: number;
    totalPullRequestContributions: number;
    totalPullRequestReviewContributions: number;
    totalIssueContributions: number;
    restrictedContributionsCount: number;
  }
  export interface ContribFull extends ContribLite {
    contributionCalendar: {
      totalContributions: number;
      weeks: { contributionDays: { contributionCount: number; date: string }[] }[];
    };
    commitContributionsByRepository: {
      repository: {
        nameWithOwner: string;
        owner: { login: string };
        stargazerCount: number;
        isFork: boolean;
      };
      contributions: Count;
    }[];
  }
  export interface Profile {
    rateLimit: RateLimit;
    user: {
      id: string;
      databaseId: number;
      login: string;
      name: string | null;
      bio: string | null;
      avatarUrl: string;
      company: string | null;
      websiteUrl: string | null;
      createdAt: string;
      hasSponsorsListing: boolean;
      followers: Count;
      following: Count;
      organizations: Count;
      gists: Count;
      starredRepositories: Count;
      repositories: Count;
      forks: Count;
      y0: ContribFull;
      y1: ContribLite;
      y2: ContribLite;
      repositoriesContributedTo: {
        totalCount: number;
        nodes: { nameWithOwner: string; stargazerCount: number; isFork: boolean }[];
      };
    } | null;
  }
  export interface RepoMeta {
    name: string;
    nameWithOwner: string;
    isArchived: boolean;
    isTemplate: boolean;
    isPrivate: boolean;
    stargazerCount: number;
    forkCount: number;
    description: string | null;
    pushedAt: string;
    createdAt: string;
    diskUsage: number;
    primaryLanguage: { name: string } | null;
    languages: { nodes: { name: string }[] };
    repositoryTopics: { nodes: { topic: { name: string } }[] };
    licenseInfo: { spdxId: string } | null;
    defaultBranchRef: { target: { committedDate: string } | null } | null;
  }
  export interface RepoList {
    rateLimit: RateLimit;
    user: { byStars: { nodes: RepoMeta[] }; byPush: { nodes: RepoMeta[] } } | null;
  }
  export interface RepoProbe {
    name: string;
    defaultBranchRef: { target: { history: Count; recent: Count } | null } | null;
    readme: { id: string } | null;
    readmeLower: { id: string } | null;
    readmeBare: { id: string } | null;
    workflows: { id: string } | null;
    tests1: { id: string } | null;
    tests2: { id: string } | null;
    tests3: { id: string } | null;
    tests4: { id: string } | null;
    dockerfile: { id: string } | null;
  }
  export type Probes = { rateLimit: RateLimit } & Record<string, RepoProbe | RateLimit | null>;
  export interface Collab {
    rateLimit: RateLimit;
    user: {
      pullRequests: {
        totalCount: number;
        nodes: {
          mergedAt: string;
          additions: number;
          deletions: number;
          baseRepository: { nameWithOwner: string; owner: { login: string }; stargazerCount: number } | null;
        }[];
      };
      followers: { nodes: { createdAt: string; followers: Count; repositories: Count }[] };
    } | null;
    repository?: { stargazers: { nodes: { createdAt: string; followers: Count }[] } } | null;
  }
}
