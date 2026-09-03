// Time each GraphQL query separately for a login. Diagnoses slow analyses.
//   npm run profile -- torvalds
import 'dotenv/config';
import { gql } from '../src/github/graphql.js';
import { buildProbeQuery, COLLAB_QUERY, PROFILE_QUERY, REPO_LIST_QUERY } from '../src/github/queries.js';

const login = process.argv[2];
const token = process.env.GITHUB_APP_FALLBACK_TOKEN ?? process.env.GITHUB_TOKEN;
if (!login || !token) {
  console.error('usage: npm run profile -- <login>');
  process.exit(1);
}
const DAY = 86_400_000;
const now = Date.now();
const iso = (t: number) => new Date(t).toISOString();

async function time<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  const t0 = Date.now();
  try {
    const out = await fn();
    const rl = (out as { rateLimit?: { cost: number; remaining: number } }).rateLimit;
    console.log(
      `${label.padEnd(8)} ${String(Date.now() - t0).padStart(6)} ms  cost ${rl?.cost ?? '?'}  remaining ${rl?.remaining ?? '?'}`,
    );
    return out;
  } catch (err) {
    console.log(
      `${label.padEnd(8)} ${String(Date.now() - t0).padStart(6)} ms  FAILED ${(err as Error).message}`,
    );
    return null;
  }
}

const profile = await time('profile', () =>
  gql<{ user: { repositories: { totalCount: number } } | null }>(token, PROFILE_QUERY, {
    login,
    from0: iso(now - 365 * DAY),
    to0: iso(now),
    from1: iso(now - 730 * DAY),
    to1: iso(now - 365 * DAY),
    from2: iso(now - 1095 * DAY),
    to2: iso(now - 730 * DAY),
  }),
);
console.log(`         repos owned: ${profile?.user?.repositories.totalCount ?? '?'}`);

const repos = await time('list', () =>
  gql<{ user: { byStars: { nodes: { name: string; stargazerCount: number }[] } } | null }>(
    token,
    REPO_LIST_QUERY,
    { login },
  ),
);
const top = repos?.user?.byStars.nodes[0] ?? null;
console.log(`         top repo: ${top?.name ?? '-'} (${top?.stargazerCount ?? 0} stars)`);
const names = repos?.user?.byStars.nodes.slice(0, 10).map((r) => r.name) ?? [];
if (names.length) {
  await time('probes', () => gql(token, buildProbeQuery(names), { login, since: iso(now - 365 * DAY) }));
}

await time('collab', () =>
  gql(token, COLLAB_QUERY, {
    login,
    owner: login,
    name: top?.name ?? '-',
    hasTop: Boolean(top && top.stargazerCount >= 10),
  }),
);
await time('collab-', () => gql(token, COLLAB_QUERY, { login, owner: login, name: '-', hasTop: false }));
