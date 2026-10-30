import type { Adherence, EvolutionQuality } from '../workoutLifecycle/types';
import { PROGRESSION_V2_CONFIG, type ProgressionV2Config } from './config';

/** Domain decisions compare the real ratio. Display rounding is deliberately separate. */
export function classifyAdherenceQuality(
  ratio: number,
  config: ProgressionV2Config = PROGRESSION_V2_CONFIG,
): EvolutionQuality {
  if (ratio >= config.adherenceHighThresholdBp / 10000) return 'HIGH';
  if (ratio >= config.adherenceEarnedThresholdBp / 10000) return 'GOOD';
  return 'BELOW_TARGET';
}

/**
 * Count-based classifier used by the gather layer. Cross multiplication
 * keeps the 70/85 boundaries independent from a rounded display ratio even
 * when `expectedSessions` is fractional (frequency × activeDays / 7).
 */
export function classifyAdherenceQualityFromCounts(
  fulfilledOpportunities: number,
  expectedSessions: number,
  config: ProgressionV2Config = PROGRESSION_V2_CONFIG,
): EvolutionQuality {
  if (expectedSessions <= 0) return 'BELOW_TARGET';
  if (fulfilledOpportunities * 10000 >= expectedSessions * config.adherenceHighThresholdBp) return 'HIGH';
  if (fulfilledOpportunities * 10000 >= expectedSessions * config.adherenceEarnedThresholdBp) return 'GOOD';
  return 'BELOW_TARGET';
}

/**
 * Adherence as an INTEGER number of basis points, `0..10000`.
 *
 * ## Why this is the canonical form
 *
 * `adherenceAtEarnBp` travels from the client to the EARN authority and is
 * persisted in the immutable ledger (`firestore.rules` binds the persisted
 * payload to the grant's value), so the two sides must agree EXACTLY. They
 * used not to: the client transported `Math.round(ratio * 10000)` from a
 * float division while the authority computed `Math.floor(valid * 10000 /
 * expected)` from integers. Those differ by 1 bp whenever the true value has
 * a fractional part ≥ 0.5 — 47.9% of all `(valid, expected)` pairs at or
 * above the earning threshold, including 5/7, 7/9, 8/11 and 11/12 — and the
 * authority's canonical comparison then rejected the request outright.
 *
 * One definition, integer arithmetic, no float anywhere: `valid * 10000` is
 * exact for every realistic count, and truncation toward zero is the only
 * rounding mode applied. Clamped to `[0, 10000]`, so extra workouts beyond
 * the prescription can never push adherence past 100% (docs §17/§56) and a
 * malformed negative count can never produce a negative figure.
 */
export function adherenceBasisPoints(validSessionCount: number, expectedSessions: number): number {
  if (!Number.isFinite(validSessionCount) || !Number.isFinite(expectedSessions)) return 0;
  if (expectedSessions <= 0 || validSessionCount <= 0) return 0;
  return Math.min(10_000, Math.floor(validSessionCount * 10_000 / expectedSessions));
}

/**
 * `validSessionCount / expectedSessions`, capped at 1.0 — extra workouts
 * beyond the prescription can never push adherence past 100% (docs §17/§56).
 *
 * `ratio` is DERIVED from `adherenceBasisPoints` rather than computed
 * independently, so the number the evaluator gates on and the number the
 * ledger records can never disagree. This also makes the resolver's
 * `ratio >= adherenceEarnedThresholdBp / 10000` test algebraically identical
 * to `classifyAdherenceQualityFromCounts`'s cross-multiplication —
 * `floor(v * 10000 / e) >= 7000` holds exactly when `v * 10000 >= 7000 * e`
 * — removing a latent disagreement between the gate and the quality band.
 */
export function computeAdherence(
  validSessionCount: number,
  expectedSessions: number,
  config: ProgressionV2Config = PROGRESSION_V2_CONFIG,
): Adherence {
  return {
    ratio: adherenceBasisPoints(validSessionCount, expectedSessions) / 10_000,
    quality: classifyAdherenceQualityFromCounts(validSessionCount, expectedSessions, config),
  };
}
