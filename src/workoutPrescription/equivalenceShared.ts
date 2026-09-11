import type { ExerciseSeedInput } from '../types/exercise';

/**
 * Behavior-preserving extraction (exercise-substitution audit, Fase 1):
 * `purposePreserved`/`DIFFICULTY_RANK` used to be byte-identical, independently
 * defined in both `limitationResolver.ts` and `prescriptionEvolution/equivalence.ts`.
 * Extracted here verbatim — no logic changed — so both consumers (and the new
 * manual-substitution resolver) share one definition instead of three. See the
 * exercise-substitution architecture audit for the full duplication analysis.
 */

export type EquivalenceCatalogExercise = Omit<ExerciseSeedInput, 'limitationProfile'> & {
  limitationProfile?: unknown;
};

/**
 * Hard equivalence gate: a candidate must share the source's movement pattern
 * AND either share its primary muscle or be an explicitly declared limitation
 * variant of it. "Same primary muscle" alone is never equivalence.
 */
export function purposePreserved(
  source: EquivalenceCatalogExercise,
  candidate: EquivalenceCatalogExercise,
): boolean {
  const samePattern = candidate.movement.pattern === source.movement.pattern;
  const samePrimaryMuscle = candidate.target.primaryMuscle === source.target.primaryMuscle;
  const explicitlyApprovedVariant = source.substitution.limitationVariantIds
    ?.includes(candidate.id) ?? false;
  return samePattern && (samePrimaryMuscle || explicitlyApprovedVariant);
}

export const DIFFICULTY_RANK = { beginner: 0, intermediate: 1, advanced: 2 } as const;
