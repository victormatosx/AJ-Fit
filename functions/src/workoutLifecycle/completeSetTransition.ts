/**
 * Fase 3 — the ONE invariant that makes "complete a set" safe to call from
 * two writers (the app itself, and the capability-gated external endpoint,
 * `externalWorkoutAction.ts`) without a server-side idempotency document:
 * the set's own identity (`exerciseIndex`/`setIndex`) plus its CURRENT
 * `status` already form a complete idempotency key.
 *
 * Mirrors `src/workoutExecution/completeSetTransition.ts` exactly —
 * `functions/` is a separate TypeScript project (its own `tsconfig.json`
 * `rootDir`/`include` is scoped to `functions/src` only) with no module
 * boundary back into the app's `src/`, the same reason
 * `MAX_CARDIO_ACTUAL_DURATION_SECONDS` is duplicated between
 * `completeWorkoutCardio.ts` and the app's `src/lib/cardioTimer.ts`. Keep
 * both `decideSetCompletion` copies logically identical; if one changes,
 * update the other (and its test).
 *
 * Deliberately knows nothing about Firestore/`firebase-admin` — a pure
 * decision function over already-read data, called from inside
 * `externalWorkoutAction.ts`'s `runTransaction` callback.
 */

export type MinimalSetExecutionStatus = 'PENDING' | 'COMPLETED' | 'SKIPPED';

export interface MinimalSetExecution {
  status: MinimalSetExecutionStatus;
  weightKg: number | null;
  actualReps: number | null;
}

export interface MinimalExerciseExecution {
  sets: readonly MinimalSetExecution[];
}

export type SetCompletionRejectionReason =
  | 'INVALID_EXERCISE_INDEX'
  | 'INVALID_SET_INDEX'
  | 'SET_NOT_PENDING';

/**
 * `completed_now` — this call is the one that transitioned PENDING ->
 * COMPLETED; the caller must persist `weightKg`/`actualReps` now.
 *
 * `already_completed` — the identical "complete once" case: some earlier
 * call (the app, a retry, a concurrent request) already completed this
 * exact set. The caller must NOT write anything — `weightKg`/`actualReps`
 * here are the ALREADY-PERSISTED authoritative values.
 *
 * `rejected` — the identity doesn't resolve to a real set, or it's
 * `SKIPPED`. Does NOT cover "execution is IN_PROGRESS" — that is a
 * precondition on the whole execution, checked by the caller before
 * reading the target set.
 */
export type SetCompletionDecision =
  | Readonly<{ outcome: 'completed_now'; weightKg: number | null; actualReps: number | null }>
  | Readonly<{ outcome: 'already_completed'; weightKg: number | null; actualReps: number | null }>
  | Readonly<{ outcome: 'rejected'; reason: SetCompletionRejectionReason }>;

export function decideSetCompletion(input: {
  exercises: readonly MinimalExerciseExecution[];
  exerciseIndex: number;
  setIndex: number;
  weightKg: number | null;
  actualReps: number | null;
}): SetCompletionDecision {
  const exercise = input.exercises[input.exerciseIndex];
  if (!exercise) return { outcome: 'rejected', reason: 'INVALID_EXERCISE_INDEX' };

  const set = exercise.sets[input.setIndex];
  if (!set) return { outcome: 'rejected', reason: 'INVALID_SET_INDEX' };

  if (set.status === 'COMPLETED') {
    return { outcome: 'already_completed', weightKg: set.weightKg, actualReps: set.actualReps };
  }
  if (set.status !== 'PENDING') {
    return { outcome: 'rejected', reason: 'SET_NOT_PENDING' };
  }
  return { outcome: 'completed_now', weightKg: input.weightKg, actualReps: input.actualReps };
}

/** Mirrors `sanitizeActualReps` (`src/screens/workoutScreenPlan.ts`): a positive integer, or `null`. Never zero, fractional or negative. */
export function isValidActualReps(value: number | null): boolean {
  return value === null || (Number.isInteger(value) && value > 0);
}

/** A finite, non-negative number (0 is valid — bodyweight), or `null`. */
export function isValidWeightKg(value: number | null): boolean {
  return value === null || (Number.isFinite(value) && value >= 0);
}
