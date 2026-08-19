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
