// Dry-run the analyzer + scorer against any GitHub login. No Discord needed.
//   GITHUB_APP_FALLBACK_TOKEN=ghp_... npm run score -- torvalds [preset] [--json]
import 'dotenv/config';
import { analyze } from '../src/github/analyzer.js';
import {
  DEFAULT_RUBRIC,
  DIMENSION_LABELS,
  DIMENSIONS,
  type PresetName,
  place,
  presetRubric,
  score,
} from '../src/scoring/index.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const json = process.argv.includes('--json');
const login = args[0];
const preset = (args[1] as PresetName | undefined) ?? 'general';
const token = process.env.GITHUB_APP_FALLBACK_TOKEN ?? process.env.GITHUB_TOKEN;

if (!login || !token) {
  console.error('usage: GITHUB_APP_FALLBACK_TOKEN=... npm run score -- <login> [preset] [--json]');
  process.exit(1);
}

const rubric = preset === 'general' ? DEFAULT_RUBRIC : presetRubric(preset);
const t0 = Date.now();
const analysis = await analyze(token, login, { ownToken: false }).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nanalysis failed: ${msg}`);
  if (msg.includes('401'))
    console.error('Use a classic token (starts with ghp_) with no scopes, pasted exactly as generated.');
  process.exit(1);
});
const result = score(analysis, rubric);
const placement = place(result, analysis, rubric, { discordCreatedAt: new Date(0), sharedGithub: false });

if (json) {
  console.log(JSON.stringify({ analysis, result, placement }, null, 2));
  process.exit(0);
}

const bar = (n: number) => '█'.repeat(Math.round(n / 10)) + '░'.repeat(10 - Math.round(n / 10));
console.log(
  `\n${analysis.profile.login} · ${result.total}/100 · ${placement.tier.name} · ${placement.status}`,
);
console.log(
  `raw ${result.raw} × trust ${result.trust.multiplier.toFixed(2)} · ${Date.now() - t0} ms · ${analysis.rateLimit?.cost ?? '?'} pts\n`,
);
for (const d of DIMENSIONS) {
  const dim = result.dimensions[d];
  console.log(`${bar(dim.score)} ${String(dim.score).padStart(3)}  ${DIMENSION_LABELS[d]}`);
  for (const [k, v] of Object.entries(dim.signals))
    console.log(`             ${k.padEnd(18)} ${(v * 100).toFixed(0).padStart(3)}%`);
}
if (placement.flags.length) {
  console.log('\nflags');
  for (const f of placement.flags) console.log(`  ${f.code} ×${f.multiplier}  ${f.detail}`);
}
if (placement.reasons.length) {
  console.log('\nreasons');
  for (const r of placement.reasons) console.log(`  • ${r}`);
}
console.log('\nstrengths:', result.explanation.strengths.join(' · ') || 'none');
console.log('improve:  ', result.explanation.improvements.join(' · ') || 'none');
console.log('languages:', result.languages.join(', ') || 'none');
if (analysis.incomplete.length) console.log('incomplete:', analysis.incomplete.join(', '));
