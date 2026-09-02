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
 * `validSessionCount / expectedSessions`, capped at 1.0 — extra workouts
 * beyond the prescription can never push adherence past 100% (docs §17/§56).
 */
export function computeAdherence(
  validSessionCount: number,
  expectedSessions: number,
  config: ProgressionV2Config = PROGRESSION_V2_CONFIG,
): Adherence {
  const ratio = expectedSessions > 0 ? Math.min(1, validSessionCount / expectedSessions) : 0;
  return { ratio, quality: classifyAdherenceQualityFromCounts(validSessionCount, expectedSessions, config) };
}
