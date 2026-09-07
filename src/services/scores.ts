import { gunzipSync } from 'node:zlib';
import { desc, eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { type ScoreRow, scores } from '../db/schema.js';
import type { Analysis } from '../github/types.js';
import type { ScoreResult } from '../scoring/index.js';

export interface LoadedScore {
  row: ScoreRow;
  result: ScoreResult;
  /** null once the 30-day raw blob has been swept */
  analysis: Analysis | null;
}

export function decodeScore(row: ScoreRow): LoadedScore {
  const result = JSON.parse(row.result) as ScoreResult;
  const analysis = row.analysis ? (JSON.parse(gunzipSync(row.analysis).toString('utf8')) as Analysis) : null;
  return { row, result, analysis };
}

export function loadScore(ctx: AppContext, scoreId: number): LoadedScore | null {
  const row = ctx.db.select().from(scores).where(eq(scores.id, scoreId)).get();
  return row ? decodeScore(row) : null;
}

export function latestScore(ctx: AppContext, githubId: string): ScoreRow | null {
  return (
    ctx.db.select().from(scores).where(eq(scores.githubId, githubId)).orderBy(desc(scores.id)).get() ?? null
  );
}
