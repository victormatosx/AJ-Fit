/**
 * `requireActiveAccount` — Fase 5 §15/§16.
 *
 * A reusable guard for NORMAL, user-facing callables (Photo Vault's
 * `createVault`/`recoverVaultKey` today — see the Fase 5 report for the
 * full classification of which callables need this and which must NEVER
 * get it):
 *
 *   - Normal user operations (this guard): reject once a deletion has been
 *     REQUESTED, regardless of which internal workflow status it is
 *     currently in (`REQUESTED`/`PROCESSING`/`RETRY_SCHEDULED`/`COMPLETED`/
 *     `FAILED_TERMINAL` — ALL of them mean "do not treat this account as
 *     active"; even `FAILED_TERMINAL` must not silently resume normal
 *     service for an account whose deletion may be partially executed).
 *   - `requestAccountDeletion` itself: must NEVER use this guard — its
 *     entire job is to work correctly WHEN a lock already exists (dedup —
 *     Fase 4). Applying this guard there would make the callable reject
 *     its own idempotent retry, which is exactly backwards.
 *   - The future deletion WORKER (Admin SDK, not a `request.auth`-bound
 *     callable at all): must never be subject to this guard either — it is
 *     the one thing that's SUPPOSED to keep operating on a locked account
 *     (Fase 5 §16).
 *
 * Existence of a lock document is deliberately the ONLY signal checked —
 * not its `status` field. This is a cheap `get()` (one document read by
 * doc-id, not a query) and fails closed: a uid with no lock at all is the
 * ONLY case treated as active.
 */

import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';

import { db as defaultDb } from '../lib/firebaseAdmin';
import { ACCOUNT_DELETION_LOCKS_COLLECTION } from './repository';

export async function requireActiveAccount(
  uid: string,
  db: Pick<Firestore, 'collection'> = defaultDb,
): Promise<void> {
  const snapshot = await db.collection(ACCOUNT_DELETION_LOCKS_COLLECTION).doc(uid).get();
  if (snapshot.exists) {
    throw new HttpsError(
      'failed-precondition',
      'This account has a pending account deletion request.',
    );
  }
}
