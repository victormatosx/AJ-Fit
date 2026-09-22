import type { ScheduleConfig } from './types';

/**
 * Bootstrap-only handoff (NOT a cache — see docs/superpowers/plans/
 * 2026-09-22-home-bootstrap-perf-audit-phase2.md Task 2): lets
 * `useWorkoutReadinessGate`'s pre-mount existence check pass its already-
 * resolved `ScheduleConfig` to `useWorkoutSchedule`'s first resolve,
 * avoiding a second read of the same document a few hundred ms later.
 *
 * ONLY ever set when the readiness gate found an EXISTING config (i.e. it
 * did NOT write one) — the caller is responsible for never setting this
 * when `ensureScheduleConfigFromQuestionnaire` ran, since that write makes
 * any earlier read stale. Consumed exactly once per uid, then cleared, so a
 * later `useWorkoutSchedule` remount (identity switch, logout/login) always
 * re-fetches.
 */
let handoff: { uid: string; config: ScheduleConfig } | null = null;

export function setScheduleConfigBootstrapHandoff(uid: string, config: ScheduleConfig): void {
  handoff = { uid, config };
}

export function takeScheduleConfigBootstrapHandoff(uid: string): ScheduleConfig | undefined {
  if (!handoff || handoff.uid !== uid) return undefined;
  const { config } = handoff;
  handoff = null;
  return config;
}
