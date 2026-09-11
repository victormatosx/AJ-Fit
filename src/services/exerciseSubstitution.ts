import { httpsCallable } from 'firebase/functions';

import { functions } from '../lib/firebaseFunctions';

export {
  canRevertToAnchor,
  exerciseDisplayName,
  exerciseDisplayTarget,
  resolveDisplayCandidates,
  type ManualSubstitutionUserContext,
} from './exerciseSubstitutionCandidates';

export { loadManualSubstitutionUserContext } from './exerciseSubstitutionContext';

/**
 * Client-side surface for Manual Substitution (exercise-substitution
 * architecture audit). `applyExerciseSubstitution` is the ONLY way a
 * substitution is ever persisted: it calls the `applyExerciseSubstitution`
 * callable, which independently recomputes eligibility against live
 * Firestore data and performs the entire write server-side. A stale or
 * tampered local candidate list (`exerciseSubstitutionCandidates.ts`) can
 * never bypass it.
 *
 * This module (and only this module) imports `firebase/functions`, which
 * calls `getFunctions()` eagerly at import time — `workoutExecutions.ts`
 * therefore imports `loadManualSubstitutionUserContext` from
 * `exerciseSubstitutionContext.ts` directly, never from here (Fase 6 fix;
 * see that file's doc comment).
 */
const APPLY_EXERCISE_SUBSTITUTION_CALLABLE = 'applyExerciseSubstitution';

export type ExerciseSubstitutionScope = 'SESSION' | 'PERMANENT';

export interface ApplyExerciseSubstitutionInput {
  executionId: string;
  exerciseIndex: number;
  requestedExerciseId: string;
  scope: ExerciseSubstitutionScope;
}

export interface ApplyExerciseSubstitutionResult {
  exerciseId: string;
  scope: ExerciseSubstitutionScope;
}

export async function applyExerciseSubstitution(
  input: ApplyExerciseSubstitutionInput,
): Promise<ApplyExerciseSubstitutionResult> {
  const callable = httpsCallable<ApplyExerciseSubstitutionInput, ApplyExerciseSubstitutionResult>(
    functions,
    APPLY_EXERCISE_SUBSTITUTION_CALLABLE,
  );
  return (await callable(input)).data;
}
