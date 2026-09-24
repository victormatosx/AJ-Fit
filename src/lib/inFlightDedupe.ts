/**
 * Generic single-flight/in-flight request dedupe — Fase 1.1. Generalizes the
 * `Map<string, Promise<T>>` pattern already proven in
 * `services/workoutPrograms.ts` (`generateAndPersistWorkoutProgramDeduped`)
 * so read paths can reuse it without duplicating the map/finally bookkeeping.
 *
 * Deliberately NOT a cache: the registry entry is removed the instant the
 * call settles, success OR failure, via `.finally()` — a failure is never
 * cached, and a call made after the previous one has settled always starts a
 * genuinely fresh attempt. Concurrent callers for the same key share exactly
 * one real attempt and all observe its real, final result.
 *
 * `createInFlightDedupe()` returns a dedupe function bound to its OWN private
 * map — callers must keep the returned function around (e.g. module-level)
 * so concurrent calls actually land in the same map instance.
 */
export function createInFlightDedupe<T>(): (key: string, attempt: () => Promise<T>) => Promise<T> {
  const inFlight = new Map<string, Promise<T>>();
  return function dedupeInFlight(key: string, attempt: () => Promise<T>): Promise<T> {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = attempt().finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
    inFlight.set(key, promise);
    return promise;
  };
}
