import type { Analysis } from '../github/types.js';
import { daysSince } from '../lib/snowflake.js';
import { calendarStats } from './calendar.js';
import { median, share } from './sat.js';

export type FlagCode =
  | 'NEW_ACCOUNT'
  | 'BURST'
  | 'FOLLOWER_FARM'
  | 'STAR_FARM'
  | 'FORK_FARM'
  | 'HOLLOW_REPOS'
  | 'BOT_CADENCE'
  | 'NO_PROFILE'
  | 'INCOMPLETE'
  | 'PUBLIC_ONLY'
  | 'DISCORD_FRESH'
  | 'SHARED_GITHUB';

export interface Flag {
  code: FlagCode;
  detail: string;
  /** multiplier applied to the total, 1 = none */
  multiplier: number;
}

export interface Trust {
  flags: Flag[];
  multiplier: number;
  /** 0..1 discount applied to raw star counts */
  starQuality: number;
  /** 0..1 discount applied to raw follower counts */
  followerQuality: number;
}

export const TRUST_FLOOR = 0.15;
/** follower-farm detection only runs for accounts in the range people actually buy followers for */
export const FOLLOWER_FARM_MIN = 20;
export const FOLLOWER_FARM_MAX = 2000;

export function evaluateTrust(a: Analysis, now = Date.parse(a.fetchedAt)): Trust {
  const flags: Flag[] = [];
  let starQuality = 1;
  let followerQuality = 1;

  const ageDays = daysSince(a.profile.createdAt, now);
  if (ageDays < 30) {
    flags.push({
      code: 'NEW_ACCOUNT',
      detail: `GitHub account is ${Math.floor(ageDays)} days old`,
      multiplier: 0.15,
    });
  } else if (ageDays < 90) {
    flags.push({
      code: 'NEW_ACCOUNT',
      detail: `GitHub account is ${Math.floor(ageDays)} days old`,
      multiplier: 0.5,
    });
  }

  const cal = calendarStats(a, now);
  if (cal.total >= 20 && cal.maxDay / cal.total > 0.35 && cal.activeWeeks < 8) {
    flags.push({
      code: 'BURST',
      detail: `${Math.round((100 * cal.maxDay) / cal.total)}% of the year's contributions landed on one day`,
      multiplier: 0.5,
    });
  }

  const y0 = a.years[0];
  if (y0 && y0.commits > 500 && (cal.activeWeeks < 6 || cal.top3Share > 0.8)) {
    flags.push({
      code: 'BOT_CADENCE',
      detail:
        cal.activeWeeks < 6
          ? `${y0.commits} commits across only ${cal.activeWeeks} active weeks`
          : `${Math.round(cal.top3Share * 100)}% of ${y0.commits} commits landed on three days`,
      multiplier: 0.4,
    });
  }

  // Follower farms exist to inflate small accounts. Above the cap, the newest followers of a
  // genuinely popular account are mostly brand-new users, which looks identical to a bought batch.
  const fs = a.followerSample;
  if (
    fs.length >= 5 &&
    a.profile.followers >= FOLLOWER_FARM_MIN &&
    a.profile.followers <= FOLLOWER_FARM_MAX
  ) {
    const zeroRepos = share(fs.map((f) => f.repos === 0));
    const medAge = median(fs.map((f) => daysSince(f.createdAt, now)));
    if (zeroRepos >= 0.6 && medAge < 90) {
      followerQuality = 0.1;
      flags.push({
        code: 'FOLLOWER_FARM',
        detail: `${Math.round(zeroRepos * 100)}% of sampled followers have no repos and a median age of ${Math.round(medAge)} days`,
        multiplier: 0.7,
      });
    }
  }

  const sg = a.stargazerSample;
  if (sg.length >= 10) {
    const weak = sg
      .filter((s) => s.followers < 2)
      .map((s) => Date.parse(s.createdAt))
      .sort((x, y) => x - y);
    let best = 0;
    for (let i = 0, j = 0; i < weak.length; i++) {
      while (weak[i]! - weak[j]! > 30 * 86_400_000) j++;
      best = Math.max(best, i - j + 1);
    }
    if (best / sg.length >= 0.5) {
      starQuality = 0.1;
      flags.push({
        code: 'STAR_FARM',
        detail: `${Math.round((100 * best) / sg.length)}% of sampled stargazers were created within one 30-day window and have almost no followers`,
        multiplier: 0.7,
      });
    }
  }

  const original = a.repos.length;
  if (a.profile.totalRepos >= 5 && a.profile.forkRepos / a.profile.totalRepos > 0.8 && original < 2) {
    flags.push({
      code: 'FORK_FARM',
      detail: `${a.profile.forkRepos} of ${a.profile.totalRepos} repos are forks`,
      multiplier: 0.6,
    });
  }

  const probed = a.repos.filter((r) => r.probed && r.commits !== null);
  if (probed.length >= 3) {
    const hollow = share(probed.map((r) => (r.commits ?? 0) < 3));
    if (hollow > 0.7) {
      flags.push({
        code: 'HOLLOW_REPOS',
        detail: `${Math.round(hollow * 100)}% of your top repos have fewer than 3 commits`,
        multiplier: 0.7,
      });
    }
  }

  if (!a.profile.name && !a.profile.bio && !a.profile.websiteUrl) {
    flags.push({ code: 'NO_PROFILE', detail: 'no name, bio, or website on the profile', multiplier: 0.9 });
  }

  if (a.incomplete.length) {
    flags.push({
      code: 'INCOMPLETE',
      detail: `could not fetch: ${a.incomplete.join(', ')}. Those signals scored as zero.`,
      multiplier: 1,
    });
  }

  if (!a.ownToken) {
    flags.push({
      code: 'PUBLIC_ONLY',
      detail: 'scored from public data only, private contribution counts not visible',
      multiplier: 1,
    });
  }

  const multiplier = Math.max(
    TRUST_FLOOR,
    flags.reduce((m, f) => m * f.multiplier, 1),
  );
  return { flags, multiplier, starQuality, followerQuality };
}
