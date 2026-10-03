import type { ExerciseExecution, SetExecution } from './types';

export type CompletedSetValues = Pick<
  SetExecution,
  'actualReps' | 'weightKg' | 'actualDurationSeconds'
>;

export type SetRecordFailureKind = 'RETRYABLE' | 'PERMANENT';

const PERMANENT_FIRESTORE_CODES = new Set([
  'permission-denied',
  'invalid-argument',
  'unauthenticated',
  'not-found',
  'already-exists',
  'failed-precondition',
]);

const PERMANENT_DOMAIN_ERRORS = new Set([
  'EXECUTION_NOT_FOUND',
  'EXECUTION_NOT_IN_PROGRESS',
  'INVALID_SET_COORDINATES',
]);

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return String((error as { code: unknown }).code).replace(/^firestore\//, '');
}

/** Unknown transport/runtime failures stay retryable; only explicit rejects roll back. */
export function classifySetRecordFailure(error: unknown): SetRecordFailureKind {
  const code = errorCode(error);
  if (code && PERMANENT_FIRESTORE_CODES.has(code)) return 'PERMANENT';
  const message = error instanceof Error ? error.message : '';
  return PERMANENT_DOMAIN_ERRORS.has(message) ? 'PERMANENT' : 'RETRYABLE';
}

function sameSet(left: SetExecution, right: SetExecution): boolean {
  return left.setIndex === right.setIndex
    && left.status === right.status
    && left.actualReps === right.actualReps
    && left.weightKg === right.weightKg
    && left.actualDurationSeconds === right.actualDurationSeconds;
}

/** Pure local projection; Firestore remains authoritative and is never bypassed. */
export function projectSetCompleted(
  exercises: readonly ExerciseExecution[],
  exerciseIndex: number,
  setIndex: number,
  values: CompletedSetValues,
): { exercises: ExerciseExecution[]; previous: SetExecution; optimistic: SetExecution } {
  const exercisePosition = exercises.findIndex((exercise) => exercise.exerciseIndex === exerciseIndex);
  const exercise = exercises[exercisePosition];
  if (!exercise) throw new Error('INVALID_SET_COORDINATES');
  const setPosition = exercise.sets.findIndex((set) => set.setIndex === setIndex);
  const previous = exercise.sets[setPosition];
  if (!previous) throw new Error('INVALID_SET_COORDINATES');

  const optimistic: SetExecution = {
    ...previous,
    status: 'COMPLETED',
    ...values,
  };
  const nextExercise: ExerciseExecution = {
    ...exercise,
    sets: exercise.sets.map((set, index) => index === setPosition ? optimistic : set),
  };
  return {
    exercises: exercises.map((item, index) => index === exercisePosition ? nextExercise : item),
    previous,
    optimistic,
  };
}

/**
 * Rolls back only the exact optimistic value written by this mutation. A
 * newer confirmed edit can therefore never be overwritten by a late failure.
 */
export function rollbackOptimisticSetCompletion(
  exercises: readonly ExerciseExecution[],
  exerciseIndex: number,
  setIndex: number,
  optimistic: SetExecution,
  previous: SetExecution,
): ExerciseExecution[] {
  const exercisePosition = exercises.findIndex((exercise) => exercise.exerciseIndex === exerciseIndex);
  const exercise = exercises[exercisePosition];
  if (!exercise) return [...exercises];
  const setPosition = exercise.sets.findIndex((set) => set.setIndex === setIndex);
  const current = exercise.sets[setPosition];
  if (!current || !sameSet(current, optimistic)) return [...exercises];
  const nextExercise: ExerciseExecution = {
    ...exercise,
    sets: exercise.sets.map((set, index) => index === setPosition ? previous : set),
  };
  return exercises.map((item, index) => index === exercisePosition ? nextExercise : item);
}

/** Coalesces rapid duplicate taps before React has committed the next set. */
export function beginSetRecordFlight<T>(
  flights: Map<string, Promise<T>>,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const existing = flights.get(key);
  if (existing) return existing;
  const flight = operation();
  flights.set(key, flight);
  void flight.then(
    () => { if (flights.get(key) === flight) flights.delete(key); },
    () => { if (flights.get(key) === flight) flights.delete(key); },
  );
  return flight;
}
