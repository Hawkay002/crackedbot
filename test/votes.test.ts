import { describe, expect, it } from 'vitest';
import { DEFAULT_RUBRIC, parseRubric, type Rubric } from '../src/scoring/index.js';
import { shouldVote, tallyOutcome } from '../src/services/votes.js';

const withVote = (patch: Partial<Rubric['vote']>): Rubric => {
  const r = parseRubric({ ...DEFAULT_RUBRIC, vote: { ...DEFAULT_RUBRIC.vote, enabled: true, ...patch } });
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.rubric;
};

describe('vote rubric', () => {
  it('is off by default with sane numbers', () => {
    expect(DEFAULT_RUBRIC.vote.enabled).toBe(false);
    expect(DEFAULT_RUBRIC.vote.scope).toBe('review');
    expect(DEFAULT_RUBRIC.vote.quorum).toBe(3);
    expect(DEFAULT_RUBRIC.vote.threshold).toBe(0.6);
    expect(DEFAULT_RUBRIC.vote.durationHours).toBe(24);
  });

  it('rejects nonsense settings', () => {
    expect(parseRubric({ ...DEFAULT_RUBRIC, vote: { threshold: 0.3 } }).ok).toBe(false);
    expect(parseRubric({ ...DEFAULT_RUBRIC, vote: { durationHours: 0 } }).ok).toBe(false);
    expect(parseRubric({ ...DEFAULT_RUBRIC, vote: { scope: 'everyone' } }).ok).toBe(false);
    expect(parseRubric({ ...DEFAULT_RUBRIC, vote: { channelId: 'not-a-snowflake' } }).ok).toBe(false);
  });

  it('old rubrics without a vote block still load', () => {
    const { vote: _v, ...legacy } = DEFAULT_RUBRIC;
    const r = parseRubric(legacy);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rubric.vote.enabled).toBe(false);
  });
});

describe('shouldVote', () => {
  it('never votes when disabled', () => {
    for (const s of ['admitted', 'review', 'rejected', 'blocked'] as const) {
      expect(shouldVote(s, DEFAULT_RUBRIC)).toBe(false);
    }
  });

  it('review scope only votes on borderline cases', () => {
    const r = withVote({ scope: 'review' });
    expect(shouldVote('review', r)).toBe(true);
    expect(shouldVote('admitted', r)).toBe(false);
    expect(shouldVote('rejected', r)).toBe(false);
    expect(shouldVote('blocked', r)).toBe(false);
  });

  it('admitted scope votes on admitted and borderline, not rejected', () => {
    const r = withVote({ scope: 'admitted' });
    expect(shouldVote('admitted', r)).toBe(true);
    expect(shouldVote('review', r)).toBe(true);
    expect(shouldVote('rejected', r)).toBe(false);
    expect(shouldVote('blocked', r)).toBe(false);
  });

  it('all scope votes on everything except hard blocks', () => {
    const r = withVote({ scope: 'all' });
    expect(shouldVote('rejected', r)).toBe(true);
    expect(shouldVote('blocked', r)).toBe(false);
  });
});

describe('tallyOutcome', () => {
  it('escalates below quorum', () => {
    expect(tallyOutcome(2, 0, 3, 60)).toBe('escalated');
    expect(tallyOutcome(0, 0, 1, 60)).toBe('escalated');
  });

  it('admits at or above the threshold', () => {
    expect(tallyOutcome(3, 2, 3, 60)).toBe('admitted');
    expect(tallyOutcome(2, 1, 3, 60)).toBe('admitted');
    expect(tallyOutcome(1, 0, 1, 100)).toBe('admitted');
  });

  it('rejects below the threshold', () => {
    expect(tallyOutcome(2, 2, 3, 60)).toBe('rejected');
    expect(tallyOutcome(0, 3, 3, 60)).toBe('rejected');
    expect(tallyOutcome(5, 1, 3, 90)).toBe('rejected');
  });

  it('a single bad-faith no cannot sink a clear yes', () => {
    expect(tallyOutcome(9, 1, 3, 60)).toBe('admitted');
  });
});
