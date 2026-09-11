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

/**
 * Workout Recovery — long-session alert. A session still `IN_PROGRESS` this
 * long almost certainly means the user forgot about it (or the app died in
 * a way that never surfaced Recovery until much later), not that they're
 * still mid-set — the bootstrap modal should make the elapsed time obvious
 * instead of using the same low-key copy as a normal few-minutes-old
 * session. Single threshold, defined once here; nothing else may hardcode
 * its own copy of "4 hours".
 */
export const LONG_WORKOUT_SESSION_THRESHOLD_SECONDS = 4 * 60 * 60;

export function isLongWorkoutSession(
  elapsedSeconds: number,
  thresholdSeconds: number = LONG_WORKOUT_SESSION_THRESHOLD_SECONDS,
): boolean {
  return elapsedSeconds >= thresholdSeconds;
}

/**
 * Defensive accessor for a `PersistedWorkoutExecution.startedAt`-shaped
 * value — typed as a Firestore `Timestamp` at the type level, but Workout
 * Recovery reads execution docs that could in principle be malformed/legacy
 * data, and this must never throw or produce a nonsensical duration.
 * `null` (never `NaN`/a negative/a throw) for anything not a genuine,
 * finite instant — the caller's only correct response to `null` is to fall
 * back to the normal (non-long-session) Recovery copy, never to guess.
 */
export function safeStartedAtMs(value: unknown): number | null {
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    try {
      const millis = (value as { toMillis: () => number }).toMillis();
      return Number.isFinite(millis) ? millis : null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

/**
 * Human-readable session duration for the Workout Recovery long-session
 * alert — deliberately never shows seconds. Below 24h: `4h00`, `5h12`,
 * `12h05` (always 2-digit minutes). At/above 24h: `1d 3h` — a days/hours
 * form instead of an unreadable `27h14`; day-scale durations don't need
 * minute precision to be useful, and this matches the exact form the
 * product spec asks for.
 */
export function formatWorkoutSessionDuration(elapsedSeconds: number): string {
  const totalMinutes = Math.floor(Math.max(0, elapsedSeconds) / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours >= 24) {
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return `${days}d ${hours}h`;
  }
  return `${totalHours}h${String(minutes).padStart(2, '0')}`;
}
