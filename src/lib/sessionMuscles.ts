import { getExerciseTarget } from './muscleCatalog';
import type { MuscleId } from '../types/exercise';

export interface SessionMuscleBreakdown {
  primary: MuscleId[];
  secondary: MuscleId[];
}

const EMPTY_BREAKDOWN: SessionMuscleBreakdown = { primary: [], secondary: [] };

/**
 * Pure projection of an already-resolved list of exercise ids (the
 * effective, post-adaptation/substitution/omission session — e.g.
 * `FinalWorkoutExercise[].exerciseId`) onto the muscles it trains. Never
 * participates in prescription/adaptation decisions — read-only derived
 * data for `BodyMuscleMap`.
 *
 * A muscle can never appear in both arrays: if it's primary for ANY
 * exercise in the list, it's primary for the session, even if some other
 * exercise lists it as secondary (primary always wins, regardless of
 * input order). Unknown/unresolvable exercise ids are silently skipped —
 * a missing catalog entry must never throw or block the visual.
 */
export function deriveSessionMuscles(exerciseIds: readonly string[]): SessionMuscleBreakdown {
  if (exerciseIds.length === 0) return EMPTY_BREAKDOWN;

  const primary = new Set<MuscleId>();
  const secondary = new Set<MuscleId>();

  for (const exerciseId of exerciseIds) {
    const target = getExerciseTarget(exerciseId);
    if (!target) continue;
    primary.add(target.primaryMuscle);
    for (const muscle of target.secondaryMuscles) secondary.add(muscle);
  }

  for (const muscle of primary) secondary.delete(muscle);

  return { primary: [...primary], secondary: [...secondary] };
}
