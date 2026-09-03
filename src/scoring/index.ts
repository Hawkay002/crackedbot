import type { Analysis } from '../github/types.js';
import {
  computeDimensions,
  DIMENSIONS,
  type DimensionKey,
  type Dimensions,
  languagesOf,
} from './dimensions.js';
import { type Explanation, explain } from './explain.js';
import type { Rubric } from './rubric.js';
import { evaluateTrust, type Trust } from './trust.js';

export interface ScoreResult {
  /** 0..100 after trust multiplier */
  total: number;
  /** 0..100 before trust multiplier */
  raw: number;
  dimensions: Dimensions;
  trust: Trust;
  languages: string[];
  explanation: Explanation;
  /** the weights actually used */
  weights: Record<DimensionKey, number>;
  computedAt: string;
}

export function weightedTotal(dims: Dimensions, weights: Record<DimensionKey, number>): number {
  let sum = 0;
  let wsum = 0;
  for (const d of DIMENSIONS) {
    sum += dims[d].score * weights[d];
    wsum += weights[d];
  }
  return wsum ? sum / wsum : 0;
}

export function score(a: Analysis, rubric: Rubric, now = Date.parse(a.fetchedAt)): ScoreResult {
  const trust = evaluateTrust(a, now);
  const dimensions = computeDimensions(a, trust, now);
  const raw = weightedTotal(dimensions, rubric.weights);
  const total = Math.round(raw * trust.multiplier);
  return {
    total,
    raw: Math.round(raw),
    dimensions,
    trust,
    languages: languagesOf(a),
    explanation: explain(dimensions, rubric.weights),
    weights: rubric.weights,
    computedAt: new Date(now).toISOString(),
  };
}

export { DIMENSIONS, type DimensionKey, type Dimensions } from './dimensions.js';
export { DIMENSION_LABELS } from './explain.js';
export * from './place.js';
export * from './presets.js';
export * from './rubric.js';
export type { Flag, FlagCode, Trust } from './trust.js';
