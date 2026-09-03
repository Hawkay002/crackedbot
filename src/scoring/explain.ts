import type { DimensionKey, Dimensions } from './dimensions.js';

const LABELS: Record<string, { name: string; tip: string }> = {
  activeWeeks: { name: 'active weeks', tip: 'contribute something most weeks, even one commit' },
  longestStreak: { name: 'longest streak', tip: 'build a multi-week streak of small daily commits' },
  tenure: { name: 'multi-year tenure', tip: 'stay active across years, not just this one' },
  recency: { name: 'recent activity', tip: 'push something this month' },
  qualityStars: {
    name: 'stars on original repos',
    tip: 'polish and publish one project people can actually use',
  },
  forks: { name: 'forks of your repos', tip: 'ship something reusable enough to fork' },
  reachOfContribs: { name: 'reach of repos contributed to', tip: 'contribute to a well-known project' },
  distinctUsed: { name: 'repos with 5+ stars', tip: 'have more than one project people use' },
  externalMergedPRs: { name: 'merged PRs into other repos', tip: 'get PRs merged into repos you do not own' },
  distinctTargets: { name: 'distinct upstream repos', tip: 'contribute to several different projects' },
  reviews: { name: 'PR reviews', tip: 'review other people’s pull requests' },
  issues: { name: 'issues opened', tip: 'file good issues on projects you use' },
  orgs: { name: 'org memberships', tip: 'join or create a GitHub organization' },
  commitDepth: { name: 'commit depth', tip: 'keep iterating on your top repos instead of starting new ones' },
  hasCI: { name: 'CI on top repos', tip: 'add a GitHub Actions workflow to your main projects' },
  hasTests: { name: 'tests on top repos', tip: 'add a tests folder to your main projects' },
  documented: { name: 'README + description', tip: 'write a README and a description on every repo' },
  licensed: { name: 'license on top repos', tip: 'add a LICENSE file' },
  languageBreadth: { name: 'language breadth', tip: 'ship in more than one language' },
  longevity: { name: 'project longevity', tip: 'keep pushing to a repo for more than two months' },
  followers: { name: 'followers', tip: 'followers come from shipping, not from asking' },
  sponsorable: { name: 'sponsors listing', tip: 'turn on GitHub Sponsors' },
  gists: { name: 'gists', tip: 'share snippets as gists' },
  commitsYear: { name: 'commits this year', tip: 'commit more often' },
  privateWork: { name: 'private contributions', tip: 'link with your own account so private work counts' },
  prsYear: { name: 'PRs this year', tip: 'open pull requests, even on your own repos' },
};

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  consistency: 'Consistency',
  impact: 'Impact',
  collaboration: 'Collaboration',
  craft: 'Craft',
  community: 'Community',
  depth: 'Depth',
};

export interface Explanation {
  strengths: string[];
  improvements: string[];
}

export function explain(dims: Dimensions, weights: Record<DimensionKey, number>): Explanation {
  const rows: { key: string; dim: DimensionKey; value: number; weight: number }[] = [];
  for (const dim of Object.keys(dims) as DimensionKey[]) {
    for (const [key, value] of Object.entries(dims[dim].signals)) {
      rows.push({ key, dim, value, weight: weights[dim] });
    }
  }
  const strengths = rows
    .filter((r) => r.value >= 0.7)
    .sort((a, b) => b.value * b.weight - a.value * a.weight)
    .slice(0, 3)
    .map((r) => `${LABELS[r.key]?.name ?? r.key} (${Math.round(r.value * 100)}%)`);
  const improvements = rows
    .filter((r) => r.value < 0.4 && r.weight > 0)
    .sort((a, b) => (1 - a.value) * a.weight - (1 - b.value) * b.weight)
    .reverse()
    .slice(0, 3)
    .map((r) => LABELS[r.key]?.tip ?? r.key);
  return { strengths, improvements };
}
