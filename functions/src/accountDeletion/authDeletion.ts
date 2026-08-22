/**
 * `AUTH_DELETION` step executor — Fase 10.
 *
 * Last step in the canonical order (`types.ts`'s `ACCOUNT_DELETION_STEP_NAMES`):
 * `ACCOUNT_ACCESS_LOCK → PROVIDER_REVOCATION → VAULT_KEY_DESTRUCTION →
 * FIRESTORE_CLEANUP → STORAGE_CLEANUP → RETAINED_DATA_PROCESSING →
 * REVENUECAT_PROCESSING → AUTH_DELETION`. Deliberately last: Firebase Auth
 * remains a useful identity anchor for reconciliation/retries while every
 * earlier step runs — deleting it early would remove that anchor while
 * cleanup could still be incomplete (Fase 10 §3).
 *
 * Single responsibility (Fase 10 §6): removes the Firebase Auth user, and
 * NOTHING else. It never touches Firestore/Storage/Vault/Support/Coupon/
 * RevenueCat/provider links/native subscriptions/client state — every one of
 * those is another step's job.
 *
 * Architecture mirrors `accountAccessLock.ts`'s `lockAccountAccess` exactly:
 * a single Admin Auth call, a local error classifier reusing the shared
 * taxonomy, `Pick<Auth, ...>` dependency injection, never throws — always
 * resolves an `AccountDeletionStepOutcome`.
 *
 * Deliberately NO `getUser(uid)` pre-check (Fase 10 §18): `deleteUser`
 * already reports `auth/user-not-found` when there is nothing to delete,
 * and that IS this step's logical-success case (§15) — an extra `getUser`
 * call would only add a second network round trip and a TOCTOU window
 * (another process could delete the user between the check and the delete)
 * for no additional safety.
 */

import type { Auth } from 'firebase-admin/auth';

import { auth as defaultAdminAuth } from '../lib/firebaseAdmin';
import type { AccountDeletionStepOutcome, KnownErrorCode } from './errors';
import { nextRunnableStep } from './steps';
import type { AccountDeletionPolicy, AccountDeletionStepName, AccountDeletionStepRecord } from './types';

/**
 * Maps a Firebase Admin Auth `deleteUser` error to the shared taxonomy.
 * `auth/user-not-found` is LOGICAL SUCCESS (`ALREADY_DELETED`, same code
 * `accountAccessLock.ts` reuses for the same reason, Fase 10 §15): this
 * step's objective — "this Firebase Auth user does not exist" — is already
 * satisfied. Everything else defaults to retryable, matching
 * `accountAccessLock.ts`'s own reasoning: Admin Auth's failure modes for a
 * single write call are overwhelmingly transient network/quota conditions,
 * and a wrongly-terminal classification here would permanently block the
 * very last step of the workflow without ever getting another attempt.
 */
function classifyAuthDeletionError(error: unknown): KnownErrorCode {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  if (code === 'auth/user-not-found') return 'ALREADY_DELETED';
  if (code === 'auth/internal-error' || code === 'auth/network-request-failed') {
    return 'UNAVAILABLE';
  }
  if (code === 'auth/invalid-uid' || code === 'auth/project-not-found') {
    return 'MISSING_REQUIRED_CONFIGURATION';
  }
  return 'INTERNAL_TRANSIENT';
}

/**
 * Runs one attempt of `AUTH_DELETION` for `uid`. `uid` must come exclusively
 * from the deletion workflow's own trusted context (the record's `uid`
 * field, itself always `request.auth.uid` at creation time — Fase 10 §8) —
 * this function has no client-facing entry point of its own and must never
 * be wired to one that accepts an arbitrary caller-supplied uid.
 *
 * Does NOT decide whether it is safe to run yet — see `canRunAuthDeletion`.
 * Does NOT write the global workflow status to `COMPLETED` (Fase 10 §24) —
 * that remains the state machine's job (`stateMachine.ts`) once every
 * required step, including this one, reaches an acceptable-for-completion
 * status.
 */
export async function executeAuthDeletion(
  uid: string,
  adminAuth: Pick<Auth, 'deleteUser'> = defaultAdminAuth,
): Promise<AccountDeletionStepOutcome> {
  try {
    await adminAuth.deleteUser(uid);
  } catch (error) {
    return { kind: 'FAILED', code: classifyAuthDeletionError(error) };
  }

  return { kind: 'SUCCEEDED' };
}

/**
 * Whether `AUTH_DELETION` is allowed to run right now, given the record's
 * current step statuses. Fase 10 §9: reuses `steps.ts`'s existing
 * `nextRunnableStep` — the SAME dependency-ordering logic every other step
 * already obeys — instead of re-deriving "are all earlier required steps
 * terminal-acceptable" by hand. `nextRunnableStep` walks
 * `ACCOUNT_DELETION_STEP_ORDER` and returns the first NOT-yet-acceptable
 * required step; `AUTH_DELETION` (last in that order) can only be the
 * result once every earlier required step is `SUCCEEDED`/
 * `SKIPPED_BY_POLICY` (Fase 10 §10: `SKIPPED_BY_POLICY` — e.g.
 * `REVENUECAT_PROCESSING` under policy v1's `SKIP` — counts as terminal-
 * acceptable, exactly like every other step; policy-driven inaction is not
 * "cleanup incomplete").
 *
 * A worker (not built in this phase) would call this immediately before
 * `executeAuthDeletion` — this function never touches Firestore itself, it
 * only classifies a step-status snapshot the caller already has.
 */
export function canRunAuthDeletion(
  policy: AccountDeletionPolicy,
  steps: Readonly<Record<AccountDeletionStepName, AccountDeletionStepRecord>>,
): boolean {
  return nextRunnableStep(policy, steps) === 'AUTH_DELETION';
}
