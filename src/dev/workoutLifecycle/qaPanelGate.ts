/**
 * Development-only Workout Lifecycle QA panel gate.
 *
 * Same shape as `isDevSubscriptionOverrideAllowed()`
 * (src/dev/subscriptionOverride.ts): requires BOTH `__DEV__` (dead-code
 * eliminated in any release/production build) AND an explicit build-time
 * opt-in flag. Unlike the subscription override, this panel never lets the
 * client *change* anything server-authoritative — it only reads and
 * displays the backend's own `workoutLifecycleQaMode` decision
 * (NORMAL/QA_ACCELERATED/QA_TRANSITION — docs/workout-lifecycle/v2/qa/).
 * Gating its visibility this way still matters: it's an internal
 * diagnostic surface (raw active-day/adherence counters, and — for
 * QA_TRANSITION — a forcing action) that should never render in a shipped
 * build.
 */
export function isWorkoutLifecycleQaPanelAllowed(): boolean {
  return __DEV__ && process.env.EXPO_PUBLIC_ENABLE_DEV_WORKOUT_LIFECYCLE_QA_PANEL === '1';
}
