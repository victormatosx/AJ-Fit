/**
 * Per-resource Firestore hard-delete functions — Fase 6 §13.
 *
 * Each function: one clear responsibility, one known path, idempotent
 * (missing/empty = success, never an error), independently testable.
 *
 * DELIBERATELY ABSENT from this file: anything touching
 * `users/{uid}/privateSecurity/*`. That subcollection holds the Photo
 * Vault's wrapped key material, and its destruction belongs to
 * `VAULT_KEY_DESTRUCTION` (Fase 1's point of no return), never to
 * `FIRESTORE_CLEANUP` — see `engine.ts`'s doc comment for the full
 * reasoning. This is also exactly why `deleteUserProfileDocument` below
 * uses a single, non-recursive `.delete()` on `users/{uid}` — a recursive
 * delete of that document would cascade into `privateSecurity` as a side
 * effect, silently duplicating (or racing) a different step's
 * responsibility.
 *
 * Also deliberately absent: Support V2 retained data/`couponRedemptions`
 * (policy v1: `RETAIN`, Fase 0/1 — never touched by this cleanup engine)
 * and `accountDeletions`/`accountDeletionLocks` (workflow control plane —
 * never touched by any resource-cleanup engine, ever, regardless of
 * policy).
 */

import {
  Timestamp,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';

import { db as defaultDb } from '../../lib/firebaseAdmin';
import {
  PUSH_INSTALLATIONS_COLLECTION,
  PUSH_TOKEN_OWNERS_COLLECTION,
  RELEASED_INSTALLATION_RETENTION_MS,
  USER_DEVICES_COLLECTION,
} from '../../pushDevices/schema';
import {
  NOTIFICATION_DISPATCHES_COLLECTION,
} from '../../notifications/schema';
import { DAILY_NOTIFICATION_USERS_COLLECTION } from '../../notifications/dailyRegistration';
import { DAILY_PRODUCT_WINDOWS_COLLECTION } from '../../notifications/dailyProductRateLimit';
import { NOTIFICATION_ACHIEVEMENT_MILESTONES_COLLECTION } from '../../notifications/achievementMilestones';
import { deleteCollectionDocuments } from './deleteCollectionDocuments';
import type { ResourceCleanupResult } from './types';

const USERS_COLLECTION = 'users';
const QUESTIONNAIRES_COLLECTION = 'questionnaires';
const ASSESSMENTS_COLLECTION = 'assessments';
const HEALTH_WEIGHT_SAMPLES_COLLECTION = 'healthWeightSamples';
export const NUTRITION_USER_RESOURCES = [
  'onboardingNutritionState', 'nutritionProfile', 'nutritionPlans', 'nutritionDailyLogs', 'nutritionRecipes',
  'nutritionFoods', 'nutritionPreferences', 'nutritionFavoriteMealOptions',
  'nutritionGenerationJobs', 'nutritionMealAlternatives', 'nutritionCatalogLogReceipts', 'nutritionDiaryProtocol', 'nutritionDiaryOperationReceipts',
] as const;
const PROGRESS_PHOTOS_COLLECTION = 'progressPhotos';
const WORKOUT_PROGRAMS_COLLECTION = 'workoutPrograms';
const WORKOUT_PROGRAM_STATE_COLLECTION = 'workoutProgramState';
const WORKOUT_EXECUTIONS_COLLECTION = 'workoutExecutions';
const WORKOUT_FINALIZATION_ATTEMPTS_COLLECTION = 'workoutFinalizationAttempts';
const WORKOUT_EXECUTION_STATE_COLLECTION = 'workoutExecutionState';
const WORKOUT_EXECUTION_OCCURRENCE_COUNTERS_COLLECTION = 'workoutExecutionOccurrenceCounters';
const EXERCISE_SUBSTITUTION_PREFERENCES_COLLECTION = 'exerciseSubstitutionPreferences';
const ENTITLEMENT_SIGNALS_COLLECTION = 'entitlementSignals';
const PROGRESSION_EVENTS_COLLECTION = 'progressionEvents';
const SCHEDULE_STATE_COLLECTION = 'scheduleState';
const SCHEDULE_EVENTS_COLLECTION = 'scheduleEvents';
const WORKOUT_LIFECYCLE_STATE_COLLECTION = 'workoutLifecycleState';
const TRAINING_CYCLES_COLLECTION = 'trainingCycles';
const PROGRAM_INSTANCES_COLLECTION = 'programInstances';
const WORKOUT_LIFECYCLE_EVENTS_COLLECTION = 'workoutLifecycleEvents';
const PENDING_EVOLUTIONS_COLLECTION = 'pendingEvolutions';
const WORKOUT_LIFECYCLE_AUTHORITY_GRANTS_COLLECTION = 'workoutLifecycleAuthorityGrants';
const WORKOUT_LIFECYCLE_TRUSTED_TELEMETRY_RECEIPTS_COLLECTION = 'workoutLifecycleTrustedTelemetryReceipts';

async function queryOwnedDocuments(
  collectionName: string,
  uid: string,
  db: Firestore,
  visit: (document: QueryDocumentSnapshot) => Promise<boolean>,
  ownerField = 'ownerUid',
): Promise<number> {
  let affected = 0;
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    let query: Query = db.collection(collectionName)
      .where(ownerField, '==', uid)
      .orderBy('__name__')
      .limit(100);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    for (const document of snapshot.docs) {
      if (await visit(document)) affected += 1;
    }
    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < 100) break;
  }
  return affected;
}

async function deleteUserDispatchHistory(uid: string, db: Firestore): Promise<number> {
  let deletedCount = 0;
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    let query: Query = db.collection(NOTIFICATION_DISPATCHES_COLLECTION)
      .where('uid', '==', uid)
      .orderBy('__name__')
      .limit(50);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    await Promise.all(snapshot.docs.map((document) => db.recursiveDelete(document.ref)));
    deletedCount += snapshot.size;
    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < 50) break;
  }
  return deletedCount;
}

function userDocRef(db: Firestore, uid: string) {
  return db.collection(USERS_COLLECTION).doc(uid);
}

export async function deleteUserQuestionnaires(
  uid: string,
  db: Firestore = defaultDb,
): Promise<ResourceCleanupResult> {
  const { deletedCount } = await deleteCollectionDocuments(
    userDocRef(db, uid).collection(QUESTIONNAIRES_COLLECTION),
  );
  return { resource: 'questionnaires', deletedCount, alreadyAbsent: deletedCount === 0 };
}

export async function deleteUserAssessments(
  uid: string,
  db: Firestore = defaultDb,
): Promise<ResourceCleanupResult> {
  const { deletedCount } = await deleteCollectionDocuments(
    userDocRef(db, uid).collection(ASSESSMENTS_COLLECTION),
  );
  return { resource: 'assessments', deletedCount, alreadyAbsent: deletedCount === 0 };
}

export async function deleteUserHealthWeightSamples(
  uid: string,
  db: Firestore = defaultDb,
): Promise<ResourceCleanupResult> {
  const { deletedCount } = await deleteCollectionDocuments(
    userDocRef(db, uid).collection(HEALTH_WEIGHT_SAMPLES_COLLECTION),
  );
  return { resource: 'healthWeightSamples', deletedCount, alreadyAbsent: deletedCount === 0 };
}

/**
 * `nutritionDailyLogs/{localDate}` nests `meals/{slot}` and, under each
 * meal, `meals/{slot}/items/{itemId}` — moved out of a flat array into
 * subcollections to stay under Firestore Rules' 1000-expression write
 * budget (round brief part 1 §6). `deleteCollectionDocuments` is
 * deliberately one-level-only (see this file's top/§349 comments), so it
 * would delete the day docs but silently orphan every meal/item nested
 * under them. `db.recursiveDelete` is safe here — unlike `users/{uid}`,
 * nothing under `nutritionDailyLogs` crosses the `privateSecurity`
 * ownership boundary — and mirrors `deleteUserDispatchHistory` above.
 */
async function deleteNutritionDailyLogsWithDescendants(uid: string, db: Firestore): Promise<number> {
  const collectionRef = userDocRef(db, uid).collection('nutritionDailyLogs');
  let deletedCount = 0;
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    let query: Query = collectionRef.orderBy('__name__').limit(50);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    await Promise.all(snapshot.docs.map((document) => db.recursiveDelete(document.ref)));
    deletedCount += snapshot.size;
    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < 50) break;
  }
  return deletedCount;
}

/** All Nutrition documents currently permitted under users/{uid}. */
export async function deleteUserNutritionResources(
  uid: string,
  db: Firestore = defaultDb,
): Promise<ResourceCleanupResult> {
  let deletedCount = 0;
  for (const collectionName of NUTRITION_USER_RESOURCES) {
    if (collectionName === 'nutritionDailyLogs') {
      deletedCount += await deleteNutritionDailyLogsWithDescendants(uid, db);
      continue;
    }
    const result = await deleteCollectionDocuments(userDocRef(db, uid).collection(collectionName));
    deletedCount += result.deletedCount;
  }
  deletedCount += await queryOwnedDocuments('nutritionAiOperations', uid, db, async (candidate) => {
    await candidate.ref.delete();
    return true;
  });
  const rateRef = db.collection('nutritionRateLimits').doc(uid);
  const rate = await rateRef.get();
  if (rate.exists) { await rateRef.delete(); deletedCount += 1; }
  return { resource: 'nutrition', deletedCount, alreadyAbsent: deletedCount === 0 };
}

/**
 * Deletes the Photo Vault metadata documents (`storagePath`/encryption
 * params pointers) under `users/{uid}/progressPhotos`. Never touches the
 * Storage objects those documents point to — that is Fase 7's job,
 * deliberately independent (Fase 7 §32/§55: Storage cleanup must never
 * depend on this Firestore metadata still existing).
 */
export async function deleteProgressPhotoDocuments(
  uid: string,
  db: Firestore = defaultDb,
): Promise<ResourceCleanupResult> {
  const { deletedCount } = await deleteCollectionDocuments(
    userDocRef(db, uid).collection(PROGRESS_PHOTOS_COLLECTION),
  );
  return { resource: 'progressPhotos', deletedCount, alreadyAbsent: deletedCount === 0 };
}

export async function deleteUserPushDevices(
  uid: string,
  db: Firestore = defaultDb,
): Promise<ResourceCleanupResult> {
  const { deletedCount } = await deleteCollectionDocuments(
    userDocRef(db, uid).collection(USER_DEVICES_COLLECTION),
  );
  return { resource: 'pushDevices', deletedCount, alreadyAbsent: deletedCount === 0 };
}

/**
 * Releases installation ownership transactionally. The owner/version/token
 * relation is re-read inside the transaction so a concurrent transfer to a
 * different account is never overwritten by deletion cleanup.
 */
export async function releaseUserPushInstallations(
  uid: string,
  db: Firestore = defaultDb,
): Promise<ResourceCleanupResult> {
  const now = Timestamp.now();
  const releasedCount = await queryOwnedDocuments(
    PUSH_INSTALLATIONS_COLLECTION,
    uid,
    db,
    async (candidate) => db.runTransaction(async (tx) => {
      const current = await tx.get(candidate.ref);
      const data = current.data();
      if (!data || data.ownerUid !== uid) return false;

      const tokenHash = typeof data.tokenHash === 'string' ? data.tokenHash : null;
      if (tokenHash) {
        const tokenRef = db.collection(PUSH_TOKEN_OWNERS_COLLECTION).doc(tokenHash);
        const token = await tx.get(tokenRef);
        if (
          token.data()?.ownerUid === uid &&
          token.data()?.installationId === candidate.id &&
          token.data()?.ownershipVersion === data.ownershipVersion
        ) {
          tx.delete(tokenRef);
        }
      }

      tx.set(candidate.ref, {
        ownerUid: null,
        tokenHash: null,
        nativeTokenHash: null,
        nativeTokenType: null,
        permissionStatus: 'not-determined',
        pushEnabled: false,
        disabledAt: now,
        releasedAt: now,
        leaseExpiresAt: now,
        expireAt: Timestamp.fromMillis(now.toMillis() + RELEASED_INSTALLATION_RETENTION_MS),
        updatedAt: now,
      }, { merge: true });
      return true;
    }),
  );
  return {
    resource: 'pushInstallations',
    deletedCount: releasedCount,
    alreadyAbsent: releasedCount === 0,
  };
}

/** Deletes orphan token claims only while they are still owned by this UID. */
export async function deleteUserPushTokenOwners(
  uid: string,
  db: Firestore = defaultDb,
): Promise<ResourceCleanupResult> {
  const deletedCount = await queryOwnedDocuments(
    PUSH_TOKEN_OWNERS_COLLECTION,
    uid,
    db,
    async (candidate) => db.runTransaction(async (tx) => {
      const current = await tx.get(candidate.ref);
      if (current.data()?.ownerUid !== uid) return false;
      tx.delete(candidate.ref);
      return true;
    }),
  );
  return { resource: 'pushTokenOwners', deletedCount, alreadyAbsent: deletedCount === 0 };
}

export async function deleteUserNotificationDispatches(
  uid: string,
  db: Firestore = defaultDb,
): Promise<ResourceCleanupResult> {
  const deletedCount = await deleteUserDispatchHistory(uid, db);
  return {
    resource: 'notificationDispatches',
    deletedCount,
    alreadyAbsent: deletedCount === 0,
  };
}

export async function deleteUserDailyNotificationRegistration(
  uid: string,
  db: Firestore = defaultDb,
): Promise<ResourceCleanupResult> {
  const ref = db.collection(DAILY_NOTIFICATION_USERS_COLLECTION).doc(uid);
  const snapshot = await ref.get();
  if (snapshot.exists) await ref.delete();
  return {
    resource: 'dailyNotificationRegistration',
    deletedCount: snapshot.exists ? 1 : 0,
    alreadyAbsent: !snapshot.exists,
  };
}

/** Deletes the backend-written realtime entitlement invalidation signal. */
export async function deleteUserEntitlementSignal(
  uid: string,
  db: Firestore = defaultDb,
): Promise<ResourceCleanupResult> {
  const ref = db.collection(ENTITLEMENT_SIGNALS_COLLECTION).doc(uid);
  const snapshot = await ref.get();
  if (snapshot.exists) await ref.delete();
  return {
    resource: 'entitlementSignal',
    deletedCount: snapshot.exists ? 1 : 0,
    alreadyAbsent: !snapshot.exists,
  };
}

export async function deleteUserNotificationProductWindows(
  uid: string,
  db: Firestore = defaultDb,
): Promise<ResourceCleanupResult> {
  const deletedCount = await queryOwnedDocuments(
    DAILY_PRODUCT_WINDOWS_COLLECTION,
    uid,
    db,
    async (candidate) => {
      await candidate.ref.delete();
      return true;
    },
    'uid',
  );
  return {
    resource: 'notificationProductWindows',
    deletedCount,
    alreadyAbsent: deletedCount === 0,
  };
}

export async function deleteUserNotificationAchievementMilestones(
  uid: string,
  db: Firestore = defaultDb,
): Promise<ResourceCleanupResult> {
  const deletedCount = await queryOwnedDocuments(
    NOTIFICATION_ACHIEVEMENT_MILESTONES_COLLECTION,
    uid,
    db,
    async (candidate) => {
      await candidate.ref.delete();
      return true;
    },
    'uid',
  );
  return {
    resource: 'notificationAchievementMilestones',
    deletedCount,
    alreadyAbsent: deletedCount === 0,
  };
}

/**
 * Deletes every known subcollection nested under each of the user's
 * `workoutPrograms/{programId}` docs. Must run BEFORE
 * `deleteUserWorkoutPrograms` below — `deleteCollectionDocuments` is
 * deliberately one-level-only (see this file's top doc comment), so nothing
 * else would ever reach these nested docs once their parent program doc is
 * gone. The explicit allowlist avoids recursive deletion crossing the
 * `privateSecurity` ownership boundary documented above while covering both
 * V1 progression history and the schedule engine's state/event ledger.
 */
export async function deleteUserWorkoutProgramDescendants(
  uid: string,
  db: Firestore = defaultDb,
): Promise<ResourceCleanupResult> {
  const programsSnapshot = await userDocRef(db, uid).collection(WORKOUT_PROGRAMS_COLLECTION).get();
  let deletedCount = 0;
  for (const programDoc of programsSnapshot.docs) {
    for (const collectionName of [
      PROGRESSION_EVENTS_COLLECTION,
      SCHEDULE_STATE_COLLECTION,
      SCHEDULE_EVENTS_COLLECTION,
    ]) {
      const { deletedCount: perCollection } = await deleteCollectionDocuments(
        programDoc.ref.collection(collectionName),
      );
      deletedCount += perCollection;
    }
  }
  return { resource: 'workoutProgramDescendants', deletedCount, alreadyAbsent: deletedCount === 0 };
}

export async function deleteUserWorkoutPrograms(
  uid: string,
  db: Firestore = defaultDb,
): Promise<ResourceCleanupResult> {
  const { deletedCount } = await deleteCollectionDocuments(
    userDocRef(db, uid).collection(WORKOUT_PROGRAMS_COLLECTION),
  );
  return { resource: 'workoutPrograms', deletedCount, alreadyAbsent: deletedCount === 0 };
}

export async function deleteUserWorkoutProgramState(
  uid: string,
  db: Firestore = defaultDb,
): Promise<ResourceCleanupResult> {
  const { deletedCount } = await deleteCollectionDocuments(
    userDocRef(db, uid).collection(WORKOUT_PROGRAM_STATE_COLLECTION),
  );
  return { resource: 'workoutProgramState', deletedCount, alreadyAbsent: deletedCount === 0 };
}

/**
 * Deletes `users/{uid}/workoutExecutions` — Workout Execution & History V1
 * (docs/workout-lifecycle/09_WORKOUT_EXECUTION_AND_HISTORY.md). Top-level
 * per-user collection (not nested under `workoutPrograms/{programId}`), so a
 * single one-level delete here covers every execution regardless of which
 * program it belongs to — no need to enumerate programs first.
 */
export async function deleteUserWorkoutExecutions(
  uid: string,
  db: Firestore = defaultDb,
): Promise<ResourceCleanupResult> {
  const { deletedCount } = await deleteCollectionDocuments(
    userDocRef(db, uid).collection(WORKOUT_EXECUTIONS_COLLECTION),
  );
  return { resource: 'workoutExecutions', deletedCount, alreadyAbsent: deletedCount === 0 };
}

export function deleteUserWorkoutFinalizationAttempts(uid: string, db: Firestore = defaultDb) {
  return deleteWorkoutLifecycleCollection(
    uid,
    WORKOUT_FINALIZATION_ATTEMPTS_COLLECTION,
    'workoutFinalizationAttempts',
    db,
  );
}

export function deleteUserWorkoutExecutionState(uid: string, db: Firestore = defaultDb) {
  return deleteWorkoutLifecycleCollection(
    uid,
    WORKOUT_EXECUTION_STATE_COLLECTION,
    'workoutExecutionState',
    db,
  );
}

/**
 * 2026-10 (agenda livre multiple-sessions-per-day): one tiny counter doc per
 * (programInstanceId, sessionIndex, scheduledLocalDate) triple, allocated
 * only when a `flexible` schedule needs a 2nd+ same-day occurrence (see
 * `src/services/workoutExecutions.ts`'s `startOrResumeWorkoutExecution`).
 * Same per-user, single-purpose shape as `workoutExecutionState` above —
 * must be deleted the same way, or it survives account deletion as an
 * orphan.
 */
export function deleteUserWorkoutExecutionOccurrenceCounters(uid: string, db: Firestore = defaultDb) {
  return deleteWorkoutLifecycleCollection(
    uid,
    WORKOUT_EXECUTION_OCCURRENCE_COUNTERS_COLLECTION,
    'workoutExecutionOccurrenceCounters',
    db,
  );
}

export function deleteUserExerciseSubstitutionPreferences(uid: string, db: Firestore = defaultDb) {
  return deleteWorkoutLifecycleCollection(
    uid,
    EXERCISE_SUBSTITUTION_PREFERENCES_COLLECTION,
    'exerciseSubstitutionPreferences',
    db,
  );
}

async function deleteWorkoutLifecycleCollection(
  uid: string,
  collectionName: string,
  resource: string,
  db: Firestore,
): Promise<ResourceCleanupResult> {
  const { deletedCount } = await deleteCollectionDocuments(
    userDocRef(db, uid).collection(collectionName),
  );
  return { resource, deletedCount, alreadyAbsent: deletedCount === 0 };
}

export function deleteUserWorkoutLifecycleEvents(uid: string, db: Firestore = defaultDb) {
  return deleteWorkoutLifecycleCollection(uid, WORKOUT_LIFECYCLE_EVENTS_COLLECTION, 'workoutLifecycleEvents', db);
}

export function deleteUserProgramInstances(uid: string, db: Firestore = defaultDb) {
  return deleteWorkoutLifecycleCollection(uid, PROGRAM_INSTANCES_COLLECTION, 'programInstances', db);
}

export function deleteUserTrainingCycles(uid: string, db: Firestore = defaultDb) {
  return deleteWorkoutLifecycleCollection(uid, TRAINING_CYCLES_COLLECTION, 'trainingCycles', db);
}

export function deleteUserWorkoutLifecycleState(uid: string, db: Firestore = defaultDb) {
  return deleteWorkoutLifecycleCollection(uid, WORKOUT_LIFECYCLE_STATE_COLLECTION, 'workoutLifecycleState', db);
}

/** Fase 4 — an earned-but-not-yet-active transition must never survive account deletion. */
export function deleteUserPendingEvolutions(uid: string, db: Firestore = defaultDb) {
  return deleteWorkoutLifecycleCollection(uid, PENDING_EVOLUTIONS_COLLECTION, 'pendingEvolutions', db);
}

/** Short-lived backend-issued capability documents are user data too. */
export function deleteUserWorkoutLifecycleAuthorityGrants(uid: string, db: Firestore = defaultDb) {
  return deleteWorkoutLifecycleCollection(
    uid,
    WORKOUT_LIFECYCLE_AUTHORITY_GRANTS_COLLECTION,
    'workoutLifecycleAuthorityGrants',
    db,
  );
}

export function deleteUserWorkoutLifecycleTrustedTelemetryReceipts(uid: string, db: Firestore = defaultDb) {
  return deleteWorkoutLifecycleCollection(
    uid,
    WORKOUT_LIFECYCLE_TRUSTED_TELEMETRY_RECEIPTS_COLLECTION,
    'workoutLifecycleTrustedTelemetryReceipts',
    db,
  );
}

/**
 * Deletes `users/{uid}` itself — the profile/preferences/metadata/
 * subscription/attribution document. A single, non-recursive `.delete()`:
 * Firestore allows deleting a document that still has subcollections
 * nested under it (they simply become reachable only by direct path, never
 * cascaded) — exactly the behavior this needs, since `privateSecurity`
 * must survive this call untouched. Ordered LAST by `engine.ts` (Fase 6
 * §10): subcollections are cleared first, so a reader who does encounter a
 * lingering `users/{uid}` mid-cleanup never sees a parent with children
 * already gone silently out from under it.
 */
export async function deleteUserProfileDocument(
  uid: string,
  db: Firestore = defaultDb,
): Promise<ResourceCleanupResult> {
  const ref = userDocRef(db, uid);
  const snapshot = await ref.get();
  const existed = snapshot.exists;
  if (existed) {
    await ref.delete();
  }
  return { resource: 'userProfile', deletedCount: existed ? 1 : 0, alreadyAbsent: !existed };
}
