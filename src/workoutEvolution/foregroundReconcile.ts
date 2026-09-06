/**
 * Pure decision logic for the "app came back to foreground" Workout
 * Lifecycle reconciliation trigger (docs/workout-lifecycle — foreground
 * resume gap). Extracted from `useWorkoutEvolution` so the guard/throttle
 * rules are testable without React Native/AppState involved at all — this
 * whole module is plain TS, matching the "pure TS domain logic only"
 * boundary the rest of the test suite already assumes
 * (see vitest.config.mts).
 *
 * `useWorkoutEvolution` is the only caller; it feeds this the real
 * `AppState` transition plus its own in-flight/throttle bookkeeping and
 * acts on the boolean. No progression/eligibility logic lives here — this
 * only decides WHEN it is safe and useful to ask the existing, already
 * idempotent `reconcileWorkoutLifecycle` to run again.
 */

/** Mirrors React Native's `AppStateStatus` without importing react-native into pure-TS test scope. */
export type AppLifecycleState = 'active' | 'background' | 'inactive' | 'extension' | 'unknown';

/** Minimum time between two FOREGROUND-triggered reconciles, regardless of how many AppState events fire in between (event-storm protection). */
export const FOREGROUND_RECONCILE_THROTTLE_MS = 5_000;

export interface ForegroundReconcileGuardInput {
  previousState: AppLifecycleState;
  nextState: AppLifecycleState;
  /** False before the very first COLD_START `load()` has settled — COLD_START owns the first reconcile, a foreground event racing it must not duplicate it. */
  hasLoadedOnce: boolean;
  /** True while ANY reconcile (COLD_START, RECOVERY, POST_WORKOUT-triggered refresh, or a previous FOREGROUND) is already in flight. */
  reconcileInFlight: boolean;
  now: number;
  lastForegroundReconcileAtMs: number | null;
  throttleMs?: number;
}

/**
 * True only for a genuine `background|inactive -> active` resume — never for
 * any other AppState transition (docs: "nunca disparando em qualquer evento
 * active") — and only when running a reconcile right now is actually safe/
 * useful: cold start already owns the first load, nothing else is already
 * reconciling, and the last foreground reconcile wasn't just a moment ago
 * (event storm: active→inactive→active→background→active in quick
 * succession must still produce at most one reconcile).
 */
export function shouldReconcileOnForeground(input: ForegroundReconcileGuardInput): boolean {
  const isRealResume =
    input.nextState === 'active'
    && (input.previousState === 'background' || input.previousState === 'inactive');
  if (!isRealResume) return false;
  if (!input.hasLoadedOnce) return false;
  if (input.reconcileInFlight) return false;

  const throttleMs = input.throttleMs ?? FOREGROUND_RECONCILE_THROTTLE_MS;
  if (
    input.lastForegroundReconcileAtMs !== null
    && input.now - input.lastForegroundReconcileAtMs < throttleMs
  ) {
    return false;
  }
  return true;
}
