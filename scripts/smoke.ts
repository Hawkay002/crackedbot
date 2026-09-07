// Boot smoke test: migrations + HTTP routes + signed-state flow. No Discord, no GitHub, no network.
//   npm run smoke
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { openDb } from '../src/db/index.js';
import { scores } from '../src/db/schema.js';
import { createApp } from '../src/http/app.js';
import { newNonce, StateVerifier, signState } from '../src/lib/state.js';
import { getGuild, updateGuild } from '../src/services/guilds.js';

let failures = 0;
const check = (label: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` ${extra}` : ''}`);
  if (!ok) failures++;
};

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crackedbot-smoke-'));
const cfg = loadConfig({
  DISCORD_BOT_TOKEN: 'x',
  DISCORD_APP_ID: '123456789012345678',
  GITHUB_CLIENT_ID: 'Iv1.abc',
  GITHUB_CLIENT_SECRET: 'secret',
  STATE_SECRET: 'a'.repeat(64),
  PUBLIC_URL: 'https://example.test/',
  DATA_DIR: dataDir,
});
check('config parses and normalizes PUBLIC_URL', cfg.PUBLIC_URL === 'https://example.test');

const { db, sqlite } = openDb(cfg.DATA_DIR);
const tables = (
  sqlite.prepare("select name from sqlite_master where type='table' order by name").all() as {
    name: string;
  }[]
)
  .map((r) => r.name)
  .filter((n) => !n.startsWith('__') && !n.startsWith('sqlite_'));
check(
  'migrations create tables',
  tables.join(',') === 'audit,ballots,guilds,links,reviews,scores,votes',
  tables.join(','),
);

const fakeClient = { isReady: () => true, guilds: { cache: { size: 3 } } };
const ctx = {
  cfg,
  db,
  client: fakeClient,
  verifier: new StateVerifier(cfg.STATE_SECRET),
  startedAt: Date.now(),
  lastAnalysisAt: null,
} as unknown as AppContext;

const g = getGuild(ctx, '111111111111111111');
check('guild auto-created with default rubric', g.rubric.preset === 'general' && g.rubric.tiers.length === 5);
const g2 = updateGuild(ctx, '111111111111111111', { verifyChannelId: '222222222222222222' });
check('guild update persists', g2.row.verifyChannelId === '222222222222222222');

db.insert(scores)
  .values({
    githubId: '42',
    githubLogin: 'octocat',
    total: 73,
    raw: 80,
    result: '{}',
    ownToken: true,
    expiresAt: new Date().toISOString(),
  })
  .run();

const app = createApp(ctx);
const get = (p: string) => app.request(p);

let r = await get('/health');
check('/health 200', r.status === 200, await r.text());

r = await get('/badge/octocat.svg');
const svg = await r.text();
check(
  '/badge renders score + tier',
  r.status === 200 && svg.includes('73 · Shipper'),
  r.headers.get('content-type') ?? '',
);
r = await get('/badge/nobody.svg');
check('/badge unscored', (await r.text()).includes('unscored'));
r = await get('/badge/bad%20login.svg');
check('/badge rejects bad login', r.status === 400);

r = await get('/auth/start');
check('/auth/start without state is 400', r.status === 400);

const nonce = newNonce();
ctx.verifier.remember(nonce, 'interaction-token');
const s = signState(cfg.STATE_SECRET, {
  g: '111111111111111111',
  u: '333333333333333333',
  c: '222222222222222222',
  n: nonce,
});
r = await get(`/auth/start?s=${encodeURIComponent(s)}`);
const loc = r.headers.get('location') ?? '';
check(
  '/auth/start redirects to GitHub',
  r.status === 302 && loc.startsWith('https://github.com/login/oauth/authorize?client_id=Iv1.abc'),
  loc.slice(0, 80),
);
check(
  'redirect carries callback + state',
  loc.includes(encodeURIComponent('https://example.test/auth/callback')) && loc.includes('state='),
);

r = await get(`/auth/start?s=${encodeURIComponent(s)}x`);
check('/auth/start tampered state is 400', r.status === 400);
r = await get('/auth/callback?code=abc&state=garbage');
check('/auth/callback bad state is 400', r.status === 400);

sqlite.close();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : '\nSMOKE OK');
process.exit(failures ? 1 : 0);
