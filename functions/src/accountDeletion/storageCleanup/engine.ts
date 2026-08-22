/**
 * `STORAGE_CLEANUP` step executor — Fase 7.
 *
 * Runs the allowlisted resource deletes (`resources.ts`) and reports the
 * same `AccountDeletionStepOutcome` shape every other step already reports
 * through — no parallel result contract, same as Fase 6's
 * `firestoreCleanup/engine.ts`.
 *
 * Photo Vault relationship (Fase 7 §39): `VAULT_KEY_DESTRUCTION` makes the
 * ciphertext this engine deletes cryptographically UNREADABLE (Fase 1's
 * point of no return); this engine then makes it PHYSICALLY ABSENT. Two
 * different, complementary guarantees — this engine's job is unconditional
 * physical deletion, and it runs identically whether or not the key was
 * destroyed first (tested).
 *
 * Idempotency: same design as Fase 6 — no sub-state persisted. Every
 * resource function is independently idempotent (missing prefix = 0
 * objects = success), so retrying this whole function after a partial
 * failure only re-confirms already-empty prefixes and resumes real work
 * wherever it actually stopped.
 */

import type { Storage } from 'firebase-admin/storage';

import { storage as defaultStorage } from '../../lib/firebaseAdmin';
import type { AccountDeletionStepOutcome, KnownErrorCode } from '../errors';
import { deleteUserAvatarObjects, deleteUserProgressPhotoObjects } from './resources';
import type { StorageResourceCleanupResult } from './types';

/**
 * Maps a Cloud Storage (Admin SDK / `@google-cloud/storage`) error to the
 * shared taxonomy. GCS errors carry an HTTP-like numeric `.code` — a third
 * mapping table, alongside Admin Auth's string codes
 * (`accountAccessLock.ts`) and Firestore's gRPC codes
 * (`firestoreCleanup/engine.ts`) — same shared `KnownErrorCode` vocabulary,
 * never a parallel one. Unrecognized codes default to retryable, same
 * reasoning as the other two engines.
 */
function classifyStorageError(error: unknown): KnownErrorCode {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code: unknown }).code
      : undefined;

  switch (code) {
    case 429:
      return 'RESOURCE_EXHAUSTED';
    case 500:
    case 503:
      return 'UNAVAILABLE';
    case 403:
      return 'MISSING_REQUIRED_CONFIGURATION';
    case 400:
      return 'INVALID_CONTRACT';
    default:
      return 'INTERNAL_TRANSIENT';
  }
}

export async function runStorageCleanup(
  uid: string,
  options: {
    storage?: Storage;
    onResourceCompleted?: (result: StorageResourceCleanupResult) => void;
  } = {},
): Promise<AccountDeletionStepOutcome> {
  const storage = options.storage ?? defaultStorage;

  const steps: Array<(uid: string, storage: Storage) => Promise<StorageResourceCleanupResult>> = [
    deleteUserAvatarObjects,
    deleteUserProgressPhotoObjects,
  ];

  try {
    for (const step of steps) {
      const result = await step(uid, storage);
      options.onResourceCompleted?.(result);
    }
  } catch (error) {
    return { kind: 'FAILED', code: classifyStorageError(error) };
  }

  return { kind: 'SUCCEEDED' };
}
