/** Saturating map to [0,1]: sat(k, k) ≈ 0.63, sat(3k, k) ≈ 0.95. Whales do not dominate. */
export function sat(x: number, k: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0;
  return 1 - Math.exp(-x / k);
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function share(xs: boolean[]): number {
  return xs.length ? xs.filter(Boolean).length / xs.length : 0;
}
