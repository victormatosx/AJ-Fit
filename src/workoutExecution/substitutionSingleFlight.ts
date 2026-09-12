import type { ExerciseSubstitutionScope } from '../services/exerciseSubstitution';

export type SubstitutionFlightRef<T> = { current: Promise<T> | null };

export type SubstitutionFlight<T> =
  | { kind: 'started'; promise: Promise<T> }
  | { kind: 'reused'; promise: Promise<T> };

/**
 * Installs the in-flight promise synchronously, before the task is allowed to
 * start. This closes the same-tick gap that a React `disabled` state cannot:
 * every tap and every re-render sharing the ref observes the same flight.
 */
export function beginSubstitutionFlight<T>(
  ref: SubstitutionFlightRef<T>,
  task: () => Promise<T>,
): SubstitutionFlight<T> {
  if (ref.current) return { kind: 'reused', promise: ref.current };

  let flight: Promise<T>;
  flight = Promise.resolve()
    .then(task)
    .finally(() => {
      if (ref.current === flight) ref.current = null;
    });
  ref.current = flight;
  return { kind: 'started', promise: flight };
}

export type ConfirmedSubstitutions = Record<number, {
  exerciseId: string;
  scope: ExerciseSubstitutionScope;
}>;

/** Applies only an already server-confirmed effective identity to the UI. */
export function commitConfirmedSubstitution(
  current: ConfirmedSubstitutions,
  input: {
    exerciseIndex: number;
    prescribedExerciseId: string;
    requestedExerciseId: string;
    scope: ExerciseSubstitutionScope;
  },
): ConfirmedSubstitutions {
  const next = { ...current };
  if (input.requestedExerciseId === input.prescribedExerciseId) {
    delete next[input.exerciseIndex];
  } else {
    next[input.exerciseIndex] = {
      exerciseId: input.requestedExerciseId,
      scope: input.scope,
    };
  }
  return next;
}
