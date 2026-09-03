import { lifecycleStableHash } from './domain';

/**
 * Fase 6 — deterministic, sticky rollout gate for NEW V1→V2 migrations only.
 * Pure/no I/O: the caller loads `WorkoutLifecycleRolloutConfig` from wherever
 * it lives (Firestore doc today) and passes it in.
 *
 * Scope is intentionally narrow: this NEVER gates an account that already
 * has a V2 `workoutLifecycleState/current` document (docs §30/§CC — reducing
 * the rollout percentage must never move an already-migrated user back to
 * V1). Every call site of `isEligibleForNewMigration` only reaches it from
 * inside the `!lifecycle` branch, so that guarantee holds structurally, not
 * just by convention.
 */
export interface WorkoutLifecycleRolloutConfig {
  schemaVersion: 1;
  enabled: boolean;
  /** 0-100 inclusive. Ignored when `enabled` is false. */
  percentage: number;
}

/** Safe default when config is absent or malformed: no NEW migrations, but this never affects an existing V2 user (see module doc). */
export const WORKOUT_LIFECYCLE_ROLLOUT_FAIL_SAFE_CONFIG: WorkoutLifecycleRolloutConfig = {
  schemaVersion: 1,
  enabled: false,
  percentage: 0,
};

/** Deterministic 0-99 bucket for a uid — stable across app launches and rollout-percentage changes (same uid always lands in the same bucket). */
export function stickyRolloutBucket(uid: string): number {
  const hash = parseInt(lifecycleStableHash(`workout-lifecycle-v2-rollout:${uid}`), 16);
  return hash % 100;
}

/** Whether this uid's NEW migration should proceed under the current config. */
export function isEligibleForNewMigration(uid: string, config: WorkoutLifecycleRolloutConfig): boolean {
  if (!config.enabled) return false;
  if (!Number.isFinite(config.percentage)) return false;
  const percentage = Math.max(0, Math.min(100, config.percentage));
  return stickyRolloutBucket(uid) < percentage;
}

export function isValidRolloutConfig(value: unknown): value is WorkoutLifecycleRolloutConfig {
  return (
    typeof value === 'object' && value !== null
    && Object.keys(value).length === 3
    && (value as { schemaVersion?: unknown }).schemaVersion === 1
    && typeof (value as { enabled?: unknown }).enabled === 'boolean'
    && typeof (value as { percentage?: unknown }).percentage === 'number'
    && Number.isFinite((value as { percentage: number }).percentage)
    && Number.isInteger((value as { percentage: number }).percentage)
    && (value as { percentage: number }).percentage >= 0
    && (value as { percentage: number }).percentage <= 100
  );
}
