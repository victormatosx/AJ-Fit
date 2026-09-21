import { logDebug } from './logger';

export type PerfMark =
  | 'app_epoch' | 'auth_ready' | 'profile_ready' | 'workout_readiness_ready'
  | 'home_mount' | 'home_today_ready' | 'home_evolution_ready'
  | 'profile_cached_ready' | 'profile_remote_ready'
  | 'profile_cache_hit' | 'profile_cache_miss' | 'profile_cache_invalid'
  | 'questionnaire_cache_hit' | 'questionnaire_cache_miss' | 'questionnaire_cache_invalid'
  | 'profile_cache_hydration' | 'profile_network_revalidation'
  | 'questionnaire_cache_hydration' | 'questionnaire_network_revalidation'
  | 'exercise_catalog_cache_hit' | 'exercise_catalog_cache_miss' | 'exercise_catalog_cache_invalid'
  | 'exercise_catalog_cache_hydration' | 'exercise_catalog_network_revalidation'
  // Phase 4.0 — post-Home breakdown (DEV + EXPO_PUBLIC_PERF_TRACE only, see
  // recordPerfMark below). Today marks fire once per useWorkoutSchedule
  // `reload()` invocation — a mark appearing twice inside one cold start's
  // home_mount→home_today_ready window IS the duplicate-read signal, not a
  // bug in the instrumentation.
  | 'today_load_program_ready' | 'today_schedule_config_ready'
  | 'today_schedule_recovery_checked' | 'today_schedule_resolved'
  | 'today_prescription_handoff_used'
  // Evolution marks fire once per useWorkoutEvolution `load()` invocation,
  // in the order the awaits actually execute.
  | 'evolution_reconcile_ready' | 'evolution_lifecycle_pending_progression_ready'
  | 'evolution_events_ready' | 'evolution_activation_notice_ready'
  | 'evolution_state_commit'
  // Phase 4.2 — internal breakdown of reconcileWorkoutLifecycle (previously
  // a black box). Fire only on the branch actually taken; absence of a mark
  // means that branch didn't run this call.
  | 'evolution_reconcile_recovery_ready' | 'evolution_reconcile_lifecycle_ready'
  | 'evolution_reconcile_pending_ready' | 'evolution_reconcile_prepare_ready'
  | 'evolution_reconcile_progression_eval_ready'
  | 'evolution_reconcile_not_due' | 'evolution_reconcile_activation_done'
  | 'evolution_reconcile_cleanup_done';

const epoch = typeof performance !== 'undefined' ? performance.now() : Date.now();

/** DEV and explicit flag only. No UID or payload enters these timing logs. */
export function recordPerfMark(mark: PerfMark): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__ || process.env.EXPO_PUBLIC_PERF_TRACE !== '1') return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  logDebug('app:perf', mark, { msSinceAppEpoch: Math.round(now - epoch) });
}
