/**
 * Wall-clock elapsed time for a workout session, in whole seconds.
 *
 * Deliberately not a tick counter: `startedAtMs` is the session's one
 * canonical start instant (`PersistedWorkoutExecution.startedAt`, epoch ms).
 * The caller re-invokes this with a fresh `nowMs` (e.g. from a UI-only
 * `setInterval` or an `AppState` foreground event) — the result is always
 * correct regardless of how much real time passed between calls, including
 * time spent backgrounded, locked, or with the JS runtime suspended.
 */
export function computeWorkoutElapsedSeconds(startedAtMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
}
