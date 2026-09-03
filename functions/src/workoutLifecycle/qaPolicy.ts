import type { Firestore } from 'firebase-admin/firestore';
import type { ProgressionPolicyMode } from './prescriptionEngine/progressionEngineV2/config';

/**
 * The ONLY authority for which QA mode an account has. Mirrors
 * `requireAdminUid`'s read of `users/{uid}.metadata`
 * (functions/src/attribution/adminAuth.ts) — same document, same "re-read
 * on every call via the Admin SDK, never trust the client" shape. There is
 * no client-writable path to this field: `firestore.rules`' `users/{userId}`
 * update rule restricts client updates to `metadata.updatedAt` only, so
 * `workoutLifecycleQaMode` can only be set by an admin via the Firebase
 * Console or Admin SDK (docs/workout-lifecycle/v2/qa/).
 *
 * The two QA modes are mutually exclusive by construction — this is a
 * single-valued field, never two independent booleans. `ACCELERATED` and
 * `TRANSITION` can never both be true for the same account.
 */
export type WorkoutLifecycleQaMode = 'NORMAL' | 'QA_ACCELERATED' | 'QA_TRANSITION';

async function readMetadata(uid: string, firestore: Firestore): Promise<Record<string, unknown> | undefined> {
  const snapshot = await firestore.collection('users').doc(uid).get();
  const metadata = snapshot.data()?.metadata;
  return metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : undefined;
}

/**
 * Resolves the account's QA mode from `users/{uid}.metadata.
 * workoutLifecycleQaMode` (`'ACCELERATED' | 'TRANSITION'`, absent = NORMAL).
 *
 * Deprecated fallback: if the new field is absent, the legacy
 * `metadata.workoutLifecycleQaAccelerated: true` boolean (Fase QA_ACCELERATED
 * original rollout) is still honored as `QA_ACCELERATED` — no account that
 * relied on the old field silently loses its QA authorization. The old
 * field never implies `QA_TRANSITION` (it never existed under that name).
 * Once every QA account has been migrated to the new field, this fallback
 * branch should be deleted (see docs/workout-lifecycle/v2/qa/ — "Legacy
 * boolean deprecation").
 */
export async function resolveWorkoutLifecycleQaMode(uid: string, firestore: Firestore): Promise<WorkoutLifecycleQaMode> {
  const metadata = await readMetadata(uid, firestore);
  const raw = metadata?.workoutLifecycleQaMode;
  if (raw === 'ACCELERATED') return 'QA_ACCELERATED';
  if (raw === 'TRANSITION') return 'QA_TRANSITION';
  if (metadata?.workoutLifecycleQaAccelerated === true) return 'QA_ACCELERATED';
  return 'NORMAL';
}

/**
 * QA_TRANSITION never needs compressed time thresholds — it bypasses the
 * eligibility gate outright (`authoritativeEarnedFact`) rather than racing
 * through it faster, so it always uses the real/NORMAL thresholds for
 * anything that still consults them (quality bands, partial-session floor).
 */
export function progressionPolicyModeFor(qaMode: WorkoutLifecycleQaMode): ProgressionPolicyMode {
  return qaMode === 'QA_ACCELERATED' ? 'QA_ACCELERATED' : 'NORMAL';
}
