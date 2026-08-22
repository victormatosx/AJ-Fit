/**
 * Single source of truth for which screens are prewarmed and in what order
 * (docs/23_navegacao_e_lifecycle.md §8/§14). Adding a screen to the queue
 * means: 1) it's already wrapped in `PersistentScreen` with
 * `inactiveMode="materialized"`, 2) it's been audited per the doc's process
 * (no sensitive/transactional state, or that state has its own explicit
 * activation lifecycle — see AssessmentScreen/EditProfileScreen for the
 * non-sensitive pattern, and ChangePasswordScreen for the sensitive-data
 * variant: the *shell* is safe to prewarm because no password exists until
 * the user interacts, and every sensitive field is wiped on deactivation).
 * Don't add a screen here just to "cover" it — see the doc's per-screen
 * audit before extending this list.
 *
 * Order matters: screens prewarm strictly in this sequence, one
 * `requestIdleCallback` window at a time (see `usePrewarmQueue`) — it's not
 * a priority *hint*, it's the actual schedule. Ordered by navigation
 * likelihood: the other 2 tabs first, then the secondary screens reached
 * most directly from them, then the deeper Security sub-screens last.
 */
export const PREWARM_ROUTE_IDS = [
  'PROGRESS',
  'PROFILE',
  'SETTINGS',
  'SECURITY',
  'ASSESSMENT',
  'EDIT_PROFILE',
  'CONSISTENCY',
  'SUPPORT',
  'SUBSCRIPTION_CENTER',
  'CHANGE_PASSWORD',
] as const;

export type PrewarmRouteId = (typeof PREWARM_ROUTE_IDS)[number];
