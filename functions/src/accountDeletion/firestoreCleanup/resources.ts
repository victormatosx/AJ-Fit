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
 * Also deliberately absent: `supportTickets`/`couponRedemptions` (policy
 * v1: `RETAIN`, Fase 0/1 — never touched by any engine while that holds)
 * and `accountDeletions`/`accountDeletionLocks` (workflow control plane —
 * never touched by any resource-cleanup engine, ever, regardless of
 * policy).
 */

import type { Firestore } from 'firebase-admin/firestore';

import { db as defaultDb } from '../../lib/firebaseAdmin';
import { deleteCollectionDocuments } from './deleteCollectionDocuments';
import type { ResourceCleanupResult } from './types';

const USERS_COLLECTION = 'users';
const QUESTIONNAIRES_COLLECTION = 'questionnaires';
const ASSESSMENTS_COLLECTION = 'assessments';
const PROGRESS_PHOTOS_COLLECTION = 'progressPhotos';
const WORKOUT_PROGRAMS_COLLECTION = 'workoutPrograms';
const WORKOUT_PROGRAM_STATE_COLLECTION = 'workoutProgramState';
const WORKOUT_EXECUTIONS_COLLECTION = 'workoutExecutions';
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
