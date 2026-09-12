export interface WorkoutStartFlight<T> {
  key: string;
  promise: Promise<T>;
}

export interface WorkoutStartFlightRef<T> {
  current: WorkoutStartFlight<T> | null;
}

/**
 * Installs the flight before `task` is allowed to run. The microtask boundary
 * is intentional: a synchronous throw while constructing an offline fallback
 * must not settle before the ref owns the attempt it will later clear.
 */
export function beginWorkoutStartFlight<T>(
  ref: WorkoutStartFlightRef<T>,
  key: string,
  task: () => Promise<T> | T,
): { kind: 'started' | 'reused'; promise: Promise<T> } | { kind: 'busy' } {
  const current = ref.current;
  if (current) {
    return current.key === key
      ? { kind: 'reused', promise: current.promise }
      : { kind: 'busy' };
  }

  const flight: WorkoutStartFlight<T> = {
    key,
    promise: null as unknown as Promise<T>,
  };
  ref.current = flight;
  const promise = Promise.resolve()
    .then(task)
    .finally(() => {
      if (ref.current === flight) ref.current = null;
    });
  flight.promise = promise;
  return { kind: 'started', promise };
}
