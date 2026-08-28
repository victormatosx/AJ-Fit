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
 * Deletes every `progressionEvents` subcollection nested under each of the
 * user's `workoutPrograms/{programId}` docs (Progression Engine V1,
 * docs/workout-lifecycle/04_PROGRESSION_ENGINE.md). Must run BEFORE
 * `deleteUserWorkoutPrograms` below — `deleteCollectionDocuments` is
 * deliberately one-level-only (see this file's top doc comment), so nothing
 * else would ever reach these nested docs once their parent program doc is
 * gone. Each program's own deletion is untouched by this function — it only
 * enumerates program ids (a small, per-user-bounded count) to reach their
 * `progressionEvents` subcollection.
 */
export async function deleteUserWorkoutProgressionEvents(
  uid: string,
  db: Firestore = defaultDb,
): Promise<ResourceCleanupResult> {
  const programsSnapshot = await userDocRef(db, uid).collection(WORKOUT_PROGRAMS_COLLECTION).get();
  let deletedCount = 0;
  for (const programDoc of programsSnapshot.docs) {
    const { deletedCount: perProgram } = await deleteCollectionDocuments(
      programDoc.ref.collection(PROGRESSION_EVENTS_COLLECTION),
    );
    deletedCount += perProgram;
  }
  return { resource: 'progressionEvents', deletedCount, alreadyAbsent: deletedCount === 0 };
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
