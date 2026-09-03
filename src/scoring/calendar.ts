import type { Analysis } from '../github/types.js';

export interface CalendarStats {
  /** ISO weeks (7-day buckets from the end) with at least one contribution, out of 52 */
  activeWeeks: number;
  longestStreakDays: number;
  /** days since the last non-zero day, Infinity if none */
  daysSinceLast: number;
  maxDay: number;
  /** share of the year's contributions that landed on the three busiest days */
  top3Share: number;
  total: number;
}

export function calendarStats(a: Analysis, now = Date.parse(a.fetchedAt)): CalendarStats {
  const days = a.calendar;
  let total = 0;
  let maxDay = 0;
  let streak = 0;
  let longest = 0;
  let lastActive: string | null = null;
  for (const d of days) {
    total += d.count;
    if (d.count > maxDay) maxDay = d.count;
    if (d.count > 0) {
      streak += 1;
      lastActive = d.date;
      if (streak > longest) longest = streak;
    } else {
      streak = 0;
    }
  }
  // 7-day buckets counted from the most recent day backwards
  const active = new Set<number>();
  const n = days.length;
  for (let i = 0; i < n; i++) {
    if (days[i]!.count > 0) active.add(Math.floor((n - 1 - i) / 7));
  }
  const activeWeeks = Math.min(52, active.size);
  const daysSinceLast = lastActive ? (now - Date.parse(lastActive)) / 86_400_000 : Number.POSITIVE_INFINITY;
  const top3 = [...days]
    .map((d) => d.count)
    .sort((x, y) => y - x)
    .slice(0, 3)
    .reduce((s, c) => s + c, 0);
  const top3Share = total > 0 ? top3 / total : 0;
  return { activeWeeks, longestStreakDays: longest, daysSinceLast, maxDay, top3Share, total };
}
