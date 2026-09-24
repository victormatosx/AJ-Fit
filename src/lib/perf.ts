import { logDebug } from './logger';

export type PerfMark =
  | 'app_epoch' | 'auth_ready' | 'profile_ready' | 'workout_readiness_ready'
  | 'home_mount' | 'home_today_ready' | 'home_evolution_ready'
  | 'home_initial_data_settled' | 'home_initial_layout_committed'
  | 'home_initial_visual_ready' | 'home_initial_overlay_hidden'
  | 'home_snapshot_read_start' | 'home_snapshot_hit' | 'home_snapshot_miss'
  | 'home_snapshot_applied' | 'home_snapshot_layout_committed'
  | 'home_snapshot_visual_ready' | 'home_snapshot_overlay_hidden'
  | 'home_authoritative_data_settled' | 'home_authoritative_ready'
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
  | 'evolution_reconcile_cleanup_done'
  | 'evolution_prepare_attempt_entered' | 'evolution_prepare_attempt_returned'
  // Fase 5.2 — progressive rendering. `evolution_shell_visible` fires once,
  // at Home mount (the ticker/strip container is always in the tree from
  // first paint, independent of load state). `evolution_first_useful_content`
  // fires only when the provisional SUMMARY_READY summary is actually
  // revealed early (initial load only — see `isInitialLoad` in
  // useWorkoutEvolution.ts). `evolution_authoritative_ready` fires only after
  // a successful authoritative resolution; an ERROR/offline fallback may
  // still commit UI state but never emits this readiness mark.
  | 'evolution_shell_visible' | 'evolution_first_useful_content' | 'evolution_authoritative_ready'
  // Fase 5.3 — visual-only Evolution summary cache. These marks never carry
  // UID, ProgramInstance identity, or summary values.
  | 'evolution_cache_read_start' | 'evolution_cache_hit' | 'evolution_cache_miss'
  | 'evolution_cached_summary_visible' | 'evolution_current_summary_visible'
  // Home bootstrap audit (2026-09-22) — the three gates that previously had
  // no dedicated marks (Today/Evolution already do — see home_today_ready/
  // home_evolution_ready above). "fetch_start" fires when the hook actually
  // issues its Firestore call/subscribes its listener (not on mount — these
  // hooks may re-run on prop changes); "settled" fires exactly once, the
  // first time the gate's own InitialSectionStatus leaves PENDING, mirroring
  // homeInitialReadiness.ts's own settle condition for that gate.
  | 'home_activity_fetch_start' | 'home_activity_network_ready' | 'home_activity_settled'
  | 'home_frequency_fetch_start' | 'home_frequency_network_ready' | 'home_frequency_settled'
  | 'home_support_inbox_listener_start' | 'home_support_inbox_settled'
  // Phase 3 — pre-mount audit (2026-09-22). subscription_bootstrap covers
  // SubscriptionContext's own RevenueCat identity-sync window (previously
  // unmeasured — confirmed uid-only dependency, already parallel with
  // profile, but its own duration was invisible). preferences_reconciliation
  // covers the language/units reconcile effect (App.tsx) — genuinely serial
  // AFTER profile (it reads profile.preferences), not a waterfall to fix,
  // but its duration was invisible and could still be the long pole.
  // premium_gate_resolved_app fires the instant resolvePremiumGate first
  // returns 'app' for the current identity — the true end of the pre-mount
  // routing decision, previously only inferrable from workout_readiness_ready
  // (its last-checked input, not the gate's own resolution moment).
  // appshell_mount is AppShell's own top-level mount (distinct from
  // home_mount, which is HomeScreen's). evolution_start fires when
  // useWorkoutEvolution's load() is first invoked, before any await.
  | 'subscription_bootstrap_start' | 'subscription_bootstrap_settled'
  | 'preferences_reconciliation_start' | 'preferences_reconciliation_settled'
  | 'premium_gate_resolved_app'
  | 'appshell_mount'
  | 'evolution_start';

const epoch = typeof performance !== 'undefined' ? performance.now() : Date.now();

function isEnabled(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ && process.env.EXPO_PUBLIC_PERF_TRACE === '1';
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** DEV and explicit flag only. No UID or payload enters these timing logs. */
export function recordPerfMark(mark: PerfMark): void {
  if (!isEnabled()) return;
  logDebug('app:perf', mark, { msSinceAppEpoch: Math.round(now() - epoch) });
}

/**
 * Ported from the perf-fase0-fase1 worktree (Fase 0), additive — same gate,
 * same epoch, does not touch `recordPerfMark` or `PerfMark`. Returns a
 * stopper closure for spans that don't map to a single instant (e.g. one
 * step inside a function that isn't itself a full PerfMark boundary). Label
 * is a free string, not constrained to `PerfMark`, so ad-hoc internal spans
 * don't force new closed-vocabulary entries.
 */
export function startPerfTimer(label: string): () => number {
  const startedAt = now();
  return () => {
    const durationMs = Math.max(0, Math.round(now() - startedAt));
    if (isEnabled()) logDebug('app:perf', label, { durationMs });
    return durationMs;
  };
}

/** Monotonic offset shared by every PERF record in this JS process. */
export function perfNowMsSinceAppEpoch(): number {
  return Math.max(0, Math.round(now() - epoch));
}

/**
 * Structured DEV+PERF diagnostics for query shape/cardinality. Callers must
 * pass only static schema descriptions and aggregate counts -- never ids,
 * document contents, dates belonging to a user, or other personal data.
 */
export function recordPerfTrace(label: string, context: Record<string, unknown>): void {
  if (!isEnabled()) return;
  logDebug('app:perf', label, {
    msSinceAppEpoch: perfNowMsSinceAppEpoch(),
    ...context,
  });
}

let firestoreReadCounters: Record<string, number> = {};

/**
 * Ported from perf-fase0-fase1 (Fase 0), additive. Counts one real
 * `getDoc`/`getDocs` dispatch under a closed, non-identifying label — call
 * at the lowest point that actually issues the SDK call, never at a call
 * site that may end up deduped/short-circuited (an in-flight-deduped call
 * that joins an existing promise must NOT count again).
 */
export function countFirestoreRead(label: string): void {
  if (!isEnabled()) return;
  const count = (firestoreReadCounters[label] ?? 0) + 1;
  firestoreReadCounters[label] = count;
  logDebug('app:perf', 'firestore_read', { label, count });
}

export function firestoreReadCounts(): Readonly<Record<string, number>> {
  return { ...firestoreReadCounters };
}

export function resetFirestoreReadCounters(): void {
  firestoreReadCounters = {};
}
