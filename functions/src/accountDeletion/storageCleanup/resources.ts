/**
 * Per-resource Storage hard-delete functions — Fase 7 §35.
 *
 * ALLOWLIST, not blacklist (Fase 7 §34): each function targets exactly ONE
 * hardcoded, known-deletable prefix under `users/{uid}/...`. There is no
 * function here — and none should ever be added — that accepts an
 * arbitrary path/prefix from a caller. `users/{uid}/support/*` (policy v1:
 * `RETAIN`) is never referenced anywhere in this file, which is itself the
 * proof it can never be swept: nothing here builds that prefix, so nothing
 * here can delete it.
 *
 * Independent of Firestore (Fase 7 §32/§46/§47): every function here finds
 * objects purely by listing the Storage prefix — never by reading a
 * `progressPhotos` Firestore document for a `storagePath` field. An object
 * whose Firestore metadata is already gone (Fase 6 already ran) is still
 * found and deleted; an object that was never created despite a Firestore
 * doc existing is simply not found (nothing to delete) — either order
 * works, by construction.
 */

import type { Storage } from 'firebase-admin/storage';

import { storage as defaultStorage } from '../../lib/firebaseAdmin';
import { deletePrefixObjects } from './deletePrefixObjects';
import type { StorageResourceCleanupResult } from './types';

const USERS_PREFIX = 'users';

export class InvalidUidError extends Error {
  constructor(uid: string) {
    super(`Invalid uid for Storage cleanup: ${JSON.stringify(uid)}`);
    this.name = 'InvalidUidError';
  }
}

/**
 * Defense-in-depth (Fase 7 §36): this module is backend-only and `uid`
 * always originates from the trusted workflow record, never client input —
 * but a prefix is still built by string interpolation, so this guards
 * against that ever concatenating into a path outside the intended
 * `users/{uid}/...` namespace (e.g. a `uid` containing `/` or `..`).
 */
function assertSafeUid(uid: string): void {
  if (!uid || uid !== uid.trim() || uid.includes('/') || uid.includes('..')) {
    throw new InvalidUidError(uid);
  }
}

function bucketFor(storage: Storage) {
  return storage.bucket();
}

/**
 * Deletes every object under `users/{uid}/profile/` — not just the single
 * object a stored `photoURL` might point to (Fase 7 §37): scanning the
 * whole prefix catches any object left there regardless of naming, rather
 * than assuming a single fixed filename is the only thing that could ever
 * exist at that path.
 */
export async function deleteUserAvatarObjects(
  uid: string,
  storage: Storage = defaultStorage,
): Promise<StorageResourceCleanupResult> {
  assertSafeUid(uid);
  const { deletedCount } = await deletePrefixObjects(bucketFor(storage), `${USERS_PREFIX}/${uid}/profile/`);
  return { resource: 'avatar', deletedCount, alreadyAbsent: deletedCount === 0 };
}

/**
 * Deletes every object under `users/{uid}/progressPhotos/` — both the full
 * ciphertext (`*.enc`) and thumbnail (`*.thumb.enc`) objects for every
 * asset, in one prefix scan (Fase 7 §38).
 */
export async function deleteUserProgressPhotoObjects(
  uid: string,
  storage: Storage = defaultStorage,
): Promise<StorageResourceCleanupResult> {
  assertSafeUid(uid);
  const { deletedCount } = await deletePrefixObjects(
    bucketFor(storage),
    `${USERS_PREFIX}/${uid}/progressPhotos/`,
  );
  return { resource: 'progressPhotos', deletedCount, alreadyAbsent: deletedCount === 0 };
}
