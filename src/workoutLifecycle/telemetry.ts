
/**
 * Fase 6 — operational telemetry for the Workout Lifecycle, distinct from
 * `workoutLifecycleEvents` (the append-only domain ledger, source of
 * historical truth). This is observability only: nothing here is ever read
 * back to make a domain decision (docs §75/§76/§BY), and a failure to emit
 * an event must never fail — or even affect — a real lifecycle transition
 * (docs §88/§BX).
 *
 * The production adapter is installed before React mounts (App.tsx). Until
 * that happens, emissions are diagnosed rather than silently discarded.
 *
 * No PII: no name, email, free-form health/limitation text, or questionnaire
 * content in any payload — technical IDs and coarse buckets only.
 */
export type WorkoutLifecycleTelemetryEvent =
  | {
      name: 'lifecycle_rollout_decision';
      decision: 'ENROLLED' | 'NOT_ROLLED_OUT';
      bucket: number;
      percentage: number;
    }
  | { name: 'lifecycle_rollout_config_failed'; reason: 'MISSING' | 'MALFORMED' | 'UNAVAILABLE' }
  | { name: 'migration_failed'; errorCategory: string; retryable: boolean }
  | { name: 'lifecycle_reconcile_started'; trigger: 'POST_WORKOUT' | 'COLD_START' | 'RECOVERY' | 'FOREGROUND' }
  | {
      name: 'lifecycle_reconcile_completed';
      trigger: 'POST_WORKOUT' | 'COLD_START' | 'RECOVERY' | 'FOREGROUND';
      outcome: 'NO_LIFECYCLE' | 'NO_ACTION' | 'PREPARED' | 'AUTO_ACTIVATED' | 'STALE_REPREPARED';
    }
  | {
      name: 'lifecycle_reconcile_failed';
      trigger: 'POST_WORKOUT' | 'COLD_START' | 'RECOVERY' | 'FOREGROUND';
      errorCategory: string;
      retryable: boolean;
    }
  | { name: 'lifecycle_stale_prepare_rejected'; reason: 'PROGRAM_INSTANCE' | 'CYCLE' | 'INPUT_SNAPSHOT' | 'CONCURRENT_WRITE' }
  | { name: 'lifecycle_partial_state_recovered'; classification: string }
  | {
      name: 'progression_failed';
      stage: 'MIGRATION' | 'EVALUATION' | 'PREPARATION' | 'ACTIVATION' | 'DEFERRAL' | 'ADAPTATION' | 'RECONCILIATION';
      errorCategory: string;
      retryable: boolean;
    };

export interface WorkoutLifecycleTelemetryLogger {
  log(event: WorkoutLifecycleTelemetryEvent): void;
}

let warnedUnconfigured = false;
const unconfiguredLogger: WorkoutLifecycleTelemetryLogger = {
  log() {
    if (warnedUnconfigured) return;
    warnedUnconfigured = true;
    // This is intentionally a fixed diagnostic with no event payload/PII.
    console.warn('[workout-lifecycle:telemetry] provider_not_configured');
  },
};

let activeLogger: WorkoutLifecycleTelemetryLogger = unconfiguredLogger;

export function setWorkoutLifecycleTelemetryLogger(logger: WorkoutLifecycleTelemetryLogger): void {
  activeLogger = logger;
}

/** Test-only reset that also proves an unconfigured production path is visible. */
export function resetWorkoutLifecycleTelemetryLogger(): void {
  warnedUnconfigured = false;
  activeLogger = unconfiguredLogger;
}

/** Never throws — a broken/misconfigured logger must never break a real lifecycle transition (docs §88/§BX). */
export function logWorkoutLifecycleEvent(event: WorkoutLifecycleTelemetryEvent): void {
  try {
    activeLogger.log(event);
  } catch {
    // Swallowed by design — see module doc comment.
  }
}

/** Stable, bounded diagnostic category; never forwards an error message. */
export function workoutLifecycleErrorCategory(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String((error as { code: unknown }).code);
    if (/^[a-z0-9/_-]{1,64}$/i.test(code)) return code.toUpperCase();
  }
  return error instanceof Error ? (error.constructor.name || 'ERROR').toUpperCase() : 'UNKNOWN';
}
