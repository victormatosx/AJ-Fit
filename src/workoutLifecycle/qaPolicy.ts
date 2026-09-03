import type { ProgressionPolicyMode } from '../progressionEngineV2/config';
import { getUserProfile } from '../services/userProfile';

/**
 * Reads the account's backend-set QA mode (`users/{uid}.metadata.
 * workoutLifecycleQaMode`). This is a READ ONLY mirror of the server's
 * decision — the client never sets this field (Firestore Rules'
 * `users/{userId}` update rule restricts client writes to
 * `metadata.updatedAt` only, so it can only be set by an admin via the
 * Firebase Console/Admin SDK) and the real authority
 * (`functions/src/workoutLifecycle/authorizeMutation.ts`,
 * `functions/src/workoutLifecycle/qaPolicy.ts`) resolves the same field
 * independently server-side for every EARN decision. This function only
 * lets the CLIENT's own local preview/candidate computation and the DEFER
 * window it writes match what the backend will accept.
 *
 * The two QA modes are mutually exclusive — this is a single-valued field,
 * never two independent booleans.
 *
 * docs/workout-lifecycle/v2/qa/
 */
export type WorkoutLifecycleQaMode = 'NORMAL' | 'QA_ACCELERATED' | 'QA_TRANSITION';

/**
 * Deprecated fallback: if `workoutLifecycleQaMode` is absent, the legacy
 * `metadata.workoutLifecycleQaAccelerated: true` boolean is still honored
 * as `QA_ACCELERATED` so no already-authorized QA account silently loses
 * its policy. Never infers `QA_TRANSITION` — that mode never existed under
 * the old boolean. See docs/workout-lifecycle/v2/qa/ for the migration note.
 */
export function qaModeFromMetadata(metadata: {
  workoutLifecycleQaMode?: unknown;
  workoutLifecycleQaAccelerated?: unknown;
} | null | undefined): WorkoutLifecycleQaMode {
  const raw = metadata?.workoutLifecycleQaMode;
  if (raw === 'ACCELERATED') return 'QA_ACCELERATED';
  if (raw === 'TRANSITION') return 'QA_TRANSITION';
  if (metadata?.workoutLifecycleQaAccelerated === true) return 'QA_ACCELERATED';
  return 'NORMAL';
}

export async function resolveWorkoutLifecycleQaMode(uid: string): Promise<WorkoutLifecycleQaMode> {
  const profile = await getUserProfile(uid);
  return qaModeFromMetadata(profile?.metadata);
}

/**
 * QA_TRANSITION never needs compressed time thresholds — it bypasses the
 * eligibility gate outright rather than racing through it faster, so it
 * always uses the real/NORMAL thresholds for anything that still consults
 * them locally (deferral window, quality bands).
 */
export function progressionPolicyModeFor(qaMode: WorkoutLifecycleQaMode): ProgressionPolicyMode {
  return qaMode === 'QA_ACCELERATED' ? 'QA_ACCELERATED' : 'NORMAL';
}

export async function resolveWorkoutLifecycleProgressionPolicy(uid: string): Promise<ProgressionPolicyMode> {
  return progressionPolicyModeFor(await resolveWorkoutLifecycleQaMode(uid));
}
