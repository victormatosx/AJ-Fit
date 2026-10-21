import type { ExerciseSeedInput } from '../types/exercise';

export type EquivalenceCatalogExercise = ExerciseSeedInput;

export function purposePreserved(
  source: EquivalenceCatalogExercise,
  candidate: EquivalenceCatalogExercise,
): boolean {
  const samePattern = candidate.movement.pattern === source.movement.pattern;
  const samePrimaryMuscle = candidate.target.primaryMuscle === source.target.primaryMuscle;
  return samePattern && samePrimaryMuscle;
}

export const DIFFICULTY_RANK = { beginner: 0, intermediate: 1, advanced: 2 } as const;
