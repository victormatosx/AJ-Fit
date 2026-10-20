/**
 * `FIRESTORE_CLEANUP` step executor — Fase 6.
 *
 * Runs user-resource deletes in dependency order (Fase 6 §10):
 * questionnaires → assessments → imported weights → progressPhotos → workoutPrograms/state → the `users/{uid}`
 * document itself, last. Reports the same `AccountDeletionStepOutcome`
 * shape every other step already reports through (Fase 1's `errors.ts`) —
 * no parallel result contract.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * VAULT_KEY_DESTRUCTION vs. FIRESTORE_CLEANUP — the boundary (Fase 6 §11/§12)
 * ═══════════════════════════════════════════════════════════════════════
 * `users/{uid}/privateSecurity/photoVault` holds the wrapped Photo Vault
 * key. Fase 1 already named `VAULT_KEY_DESTRUCTION` as its own step and as
 * THE point of no return for user data — deliberately ordered BEFORE
 * `FIRESTORE_CLEANUP` in `ACCOUNT_DELETION_STEP_NAMES`. This engine never
 * reads, deletes, or even references that path:
 *   - `deleteUserProfileDocument` (`resources.ts`) uses a single
 *     non-recursive `.delete()` on `users/{uid}`, which does NOT cascade
 *     into subcollections — `privateSecurity` survives it untouched.
 *   - No function in this file/module targets `privateSecurity` at all.
 * By the time `FIRESTORE_CLEANUP` runs (after `VAULT_KEY_DESTRUCTION` has
 * already succeeded, per the required step order), the vault document is
 * expected to already be gone — but this engine does not need to know or
 * verify that to do its own job correctly, and deliberately does not
 * duplicate that responsibility by attempting to delete it "just in case".
 * Two steps racing to delete the same resource, with two different retry/
 * idempotency assumptions, is exactly the kind of ambiguity Fase 6 §12
 * warned against.
 *
 * Idempotency: retrying this whole function after a partial failure is
 * always safe — every resource function is independently idempotent
 * (Fase 6 §17/§21), so re-running from the top only re-confirms
 * already-empty collections (`deletedCount: 0`) for whatever succeeded
 * before, and resumes real work only where it actually stopped. No
 * sub-state is persisted here for that reason — same design choice as
 * `accountAccessLock.ts` (Fase 5).
 */

import type { Firestore } from 'firebase-admin/firestore';

import { db as defaultDb } from '../../lib/firebaseAdmin';
import type { AccountDeletionStepOutcome, KnownErrorCode } from '../errors';
import {
  deleteProgressPhotoDocuments,
  deleteUserNotificationDispatches,
  deleteUserDailyNotificationRegistration,
  deleteUserEntitlementSignal,
  deleteUserNotificationProductWindows,
  deleteUserNotificationAchievementMilestones,
  deleteUserPushDevices,
  deleteUserPushTokenOwners,
  deleteUserAssessments,
  deleteUserHealthWeightSamples,
  deleteUserProfileDocument,
  deleteUserQuestionnaires,
  deleteUserNutritionResources,
  deleteUserWorkoutExecutions,
  deleteUserWorkoutFinalizationAttempts,
  deleteUserWorkoutDailyCompletions,
  deleteUserWorkoutExecutionState,
  deleteUserWorkoutExecutionOccurrenceCounters,
  deleteUserExerciseSubstitutionPreferences,
  deleteUserWorkoutLifecycleEvents,
  deleteUserWorkoutLifecycleAuthorityGrants,
  deleteUserWorkoutLifecycleTrustedTelemetryReceipts,
  deleteUserPendingEvolutions,
  deleteUserProgramInstances,
  deleteUserTrainingCycles,
  deleteUserWorkoutLifecycleState,
  deleteUserWorkoutPrograms,
  deleteUserWorkoutProgramState,
  deleteUserWorkoutProgramDescendants,
  releaseUserPushInstallations,
} from './resources';
import type { ResourceCleanupResult } from './types';

/**
 * Maps a Firestore Admin SDK error to the shared taxonomy. Firestore/gRPC
 * errors carry a numeric `.code` (gRPC status codes), not the string codes
 * Admin Auth uses (`accountAccessLock.ts`) — a different provider, a
 * different mapping table, same shared `KnownErrorCode` vocabulary.
 * Unrecognized codes default to retryable (`INTERNAL_TRANSIENT`), same
 * reasoning as `accountAccessLock.ts`: a wrongly-terminal classification
 * here would stop the whole step on its very first unexpected error,
 * without ever getting a further attempt.
 */
function classifyFirestoreError(error: unknown): KnownErrorCode {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code: unknown }).code
      : undefined;

  switch (code) {
    case 4: // DEADLINE_EXCEEDED
      return 'TIMEOUT';
    case 14: // UNAVAILABLE
      return 'UNAVAILABLE';
    case 8: // RESOURCE_EXHAUSTED
      return 'RESOURCE_EXHAUSTED';
    case 7: // PERMISSION_DENIED
      return 'MISSING_REQUIRED_CONFIGURATION';
    case 3: // INVALID_ARGUMENT
      return 'INVALID_CONTRACT';
    default:
      return 'INTERNAL_TRANSIENT';
  }
}

export interface FirestoreCleanupSummary {
  resources: ResourceCleanupResult[];
}

/**
 * Runs the full Firestore cleanup for `uid`. Never throws — always
 * resolves an `AccountDeletionStepOutcome`. `onResourceCompleted`, if
 * given, is called once per resource as it finishes (safe, non-PII
 * summary only) — the future worker uses this for observability
 * (`account_deletion_firestore_resource_completed`, Fase 6 report), never
 * required for correctness.
 */
export async function runFirestoreCleanup(
  uid: string,
  options: { db?: Firestore; onResourceCompleted?: (result: ResourceCleanupResult) => void } = {},
): Promise<AccountDeletionStepOutcome> {
  const db = options.db ?? defaultDb;

  const steps: Array<(uid: string, db: Firestore) => Promise<ResourceCleanupResult>> = [
    deleteUserQuestionnaires,
    deleteUserAssessments,
    deleteUserHealthWeightSamples,
    deleteUserNutritionResources,
    deleteProgressPhotoDocuments,
    // Disable private raw-token ownership first. Every registry mutation
    // re-checks ownerUid transactionally, preserving concurrent transfers.
    deleteUserPushTokenOwners,
    releaseUserPushInstallations,
    deleteUserPushDevices,
    deleteUserNotificationDispatches,
    deleteUserNotificationProductWindows,
    deleteUserNotificationAchievementMilestones,
    deleteUserDailyNotificationRegistration,
    deleteUserEntitlementSignal,
    // Must run before deleteUserWorkoutPrograms — it enumerates program ids
    // to reach the explicit allowlist of nested collections, which a
    // one-level-only delete of the parent docs would otherwise orphan.
    deleteUserWorkoutProgramDescendants,
    deleteUserWorkoutLifecycleEvents,
    deleteUserWorkoutLifecycleAuthorityGrants,
    deleteUserWorkoutLifecycleTrustedTelemetryReceipts,
    deleteUserPendingEvolutions,
    deleteUserProgramInstances,
    deleteUserTrainingCycles,
    deleteUserWorkoutLifecycleState,
    deleteUserWorkoutPrograms,
    deleteUserWorkoutProgramState,
    deleteUserExerciseSubstitutionPreferences,
    deleteUserWorkoutExecutionState,
    deleteUserWorkoutExecutionOccurrenceCounters,
    deleteUserWorkoutFinalizationAttempts,
  deleteUserWorkoutDailyCompletions,
    deleteUserWorkoutExecutions,
    // Always last — see this module's doc comment on why `users/{uid}`
    // must be deleted only after its deletable subcollections.
    deleteUserProfileDocument,
  ];

  try {
    for (const step of steps) {
      const result = await step(uid, db);
      options.onResourceCompleted?.(result);
    }
  } catch (error) {
    return { kind: 'FAILED', code: classifyFirestoreError(error) };
  }

  return { kind: 'SUCCEEDED' };
}
