import { EXERCISES_SEED } from '../data/exercisesSeedData';
import type { ExerciseTarget } from '../types/exercise';

/**
 * Local, bundled `exercise_id -> target` lookup — deliberately NOT a
 * Firestore read. `EXERCISES_SEED` is already the canonical, bundled
 * runtime catalog used throughout `workoutPrescription` (see
 * `catalog.ts`'s own `Map(EXERCISES_SEED.map(...))` and
 * `localLimitationCatalog.ts`), so this mirrors that pattern instead of
 * opening a second source of truth or a network dependency for a
 * visual-only projection (`BodyMuscleMap`).
 */
const TARGET_BY_EXERCISE_ID: ReadonlyMap<string, ExerciseTarget> = new Map(
  EXERCISES_SEED.map((exercise) => [exercise.id, exercise.target]),
);

/** Undefined only if `exerciseId` isn't in the bundled catalog (should not happen for a live session). */
export function getExerciseTarget(exerciseId: string): ExerciseTarget | undefined {
  return TARGET_BY_EXERCISE_ID.get(exerciseId);
}
