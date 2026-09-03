import type { TrainingCycle } from '../workoutLifecycle/types';

/**
 * The only `progressionReason` values that represent an actually EARNED
 * cycle transition (docs progression/03 §34, §53). A Motivational Renewal or
 * a Program Adaptation never lands here — they must never inflate the
 * Intermediate → Advanced count.
 */
export const EARNED_CYCLE_PROGRESSION_REASONS: ReadonlySet<string> = new Set([
  'EARNED_CYCLE_EVOLUTION',
  'EARNED_LEVEL_PROMOTION',
]);

type MinimalCycle = Pick<TrainingCycle<unknown>, 'level' | 'status' | 'progressionReason' | 'cycleNumber' | 'completionReason'>;

/**
 * Counts INTERMEDIATE cycles that were both COMPLETED and reached that way
 * through an earned transition — never by `programId`/`ProgramInstance`
 * counting (docs §34), never by inventing history for a V1 baseline
 * (docs §35: `V1_MIGRATION_BASELINE_NO_PRIOR_HISTORY_INFERRED` never matches
 * an earned reason).
 */
export function countEarnedIntermediateCycles(cycles: readonly MinimalCycle[]): number {
  return cycles.filter((cycle) => {
    if (cycle.level !== 'INTERMEDIATE' || cycle.status !== 'COMPLETED') return false;
    if (cycle.completionReason === 'EARNED_EVOLUTION') return true;
    if (cycle.completionReason != null) return false;

    // Backward-compatible, conservative inference for pre-8A V2 history:
    // the old writer recorded the earned transition on the successor's
    // entry reason. A completed cycle receives credit only when its exact
    // cycleNumber+1 successor proves that transition; a lone legacy baseline
    // never receives invented credit.
    return cycles.some(
      (successor) => successor.cycleNumber === cycle.cycleNumber + 1
        && EARNED_CYCLE_PROGRESSION_REASONS.has(successor.progressionReason),
    );
  }).length;
}
