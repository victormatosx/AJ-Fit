import { PROGRESSION_V2_CONFIG } from '../progressionEngineV2/config';
import type { CurrentTrainingLevel } from '../workoutLifecycle/types';

/**
 * Same mapping `progressionEngineV2/resolver.ts`'s private
 * `minimumActiveDaysForLevel` uses, duplicated here (not imported — that
 * function isn't exported, and this file must never edit anything under
 * `progressionEngineV2/`) purely so the Home ring can show the real
 * denominator ("X of Y active days") without recomputing a new rule.
 */
export function requiredActiveDaysForLevel(level: CurrentTrainingLevel): number {
  return level === 'BEGINNER'
    ? PROGRESSION_V2_CONFIG.beginnerMinimumActiveDays
    : PROGRESSION_V2_CONFIG.intermediateAdvancedMinimumActiveDays;
}

/** Same cap the engine uses for Intermediate → Advanced ("Rumo ao Avançado X/4"). */
export const INTERMEDIATE_CYCLES_FOR_ADVANCED = PROGRESSION_V2_CONFIG.intermediateCyclesForPromotion;

/** Same threshold the engine uses to classify adherence as earned-eligible vs. below-target (`PROGRESSION_V2_CONFIG.adherenceEarnedThresholdBp`, basis points). Expressed as a whole percent (70, not 7000) since every consumer renders it as a percent. */
export const ADHERENCE_EARNED_THRESHOLD_PERCENT = PROGRESSION_V2_CONFIG.adherenceEarnedThresholdBp / 100;
