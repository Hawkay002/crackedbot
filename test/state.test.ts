import { describe, expect, it } from 'vitest';
import { snowflakeToDate } from '../src/lib/snowflake.js';
import { newNonce, StateVerifier, signState } from '../src/lib/state.js';
import { applyPreset, DEFAULT_RUBRIC, parseRubric } from '../src/scoring/index.js';

const SECRET = 'x'.repeat(64);
const data = {
  g: '123456789012345678',
  u: '223456789012345678',
  c: '323456789012345678',
  n: newNonce(),
};

describe('signed state', () => {
  it('round-trips and is single-use', () => {
    const v = new StateVerifier(SECRET);
    const s = signState(SECRET, data);
    expect(v.peek(s).ok).toBe(true);
    const first = v.verify(s);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.state.g).toBe(data.g);
    const second = v.verify(s);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe('replayed');
    expect(v.peek(s).ok).toBe(false);
  });

  it('fits in a Discord link button with room to spare', () => {
    const s = signState(SECRET, data);
    const url = `https://some-long-tunnel-hostname.trycloudflare.com/auth/start?s=${encodeURIComponent(s)}`;
    expect(url.length).toBeLessThan(400);
  });

  it('holds the interaction token server-side, once', () => {
    const v = new StateVerifier(SECRET);
    const n = newNonce();
    v.remember(n, 'a'.repeat(220));
    expect(v.takeToken(n)).toBe('a'.repeat(220));
    expect(v.takeToken(n)).toBeNull();
    expect(v.takeToken('unknown')).toBeNull();
    v.remember(n, 'tok', 1_000_000);
    expect(v.takeToken(n, 1_000_000 + 11 * 60 * 1000)).toBeNull();
  });

  it('rejects tampering and wrong secrets', () => {
    const v = new StateVerifier(SECRET);
    const s = signState(SECRET, data);
    const [payload, sig] = s.split('.');
    const tampered = `${Buffer.from(JSON.stringify({ ...data, u: '999999999999999999', n: 'a', e: Date.now() + 1e6 })).toString('base64url')}.${sig}`;
    expect(v.verify(tampered).ok).toBe(false);
    expect(new StateVerifier('y'.repeat(64)).verify(s).ok).toBe(false);
    expect(v.verify(`${payload}.`).ok).toBe(false);
    expect(v.verify('garbage').ok).toBe(false);
  });

  it('expires after ten minutes', () => {
    const v = new StateVerifier(SECRET);
    const s = signState(SECRET, data, 1_000_000);
    const late = v.verify(s, 1_000_000 + 11 * 60 * 1000);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error).toBe('expired');
  });
});

describe('snowflake', () => {
  it('decodes creation time', () => {
    // Discord's own example id
    expect(snowflakeToDate('175928847299117063').toISOString()).toBe('2016-04-30T11:18:25.796Z');
  });
});

describe('rubric', () => {
  it('parses the default and presets', () => {
    expect(parseRubric(DEFAULT_RUBRIC).ok).toBe(true);
    const sys = applyPreset(DEFAULT_RUBRIC, 'systems');
    expect(sys.gates.requireLanguagesAnyOf).toContain('Rust');
    expect(sys.tiers).toHaveLength(5);
  });

  it('rejects broken tiers and unknown entry tier', () => {
    const bad = parseRubric({
      ...DEFAULT_RUBRIC,
      tiers: [
        { name: 'A', min: 10 },
        { name: 'B', min: 5 },
      ],
    });
    expect(bad.ok).toBe(false);
    const badEntry = parseRubric({ ...DEFAULT_RUBRIC, entryTier: 'Nope' });
    expect(badEntry.ok).toBe(false);
    if (!badEntry.ok) expect(badEntry.errors.join(' ')).toMatch(/entryTier/);
  });
});
