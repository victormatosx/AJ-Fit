/**
 * `ACCOUNT_ACCESS_LOCK` step executor — Fase 5.
 *
 * Two Firebase Admin Auth calls, both idempotent by nature, which is why no
 * sub-state (`{authDisabled, refreshTokensRevoked}`) needs to be tracked in
 * the record at all — unlike Apple's provider revocation (Fase 3), neither
 * operation here consumes single-use material. Retrying this step after a
 * partial failure simply redoes whichever call(s) already succeeded, safely:
 *
 *   - `admin.auth().updateUser(uid, { disabled: true })` called twice just
 *     sets the same value twice.
 *   - `admin.auth().revokeRefreshTokens(uid)` called twice just re-stamps
 *     `validSince` to a later moment — still correct, never "undoes"
 *     anything.
 *
 * ORDER (Fase 5 §12, deliberate): disable BEFORE revoking refresh tokens.
 * If revoke then fails/times out, the account is still disabled — no NEW
 * sign-in can succeed in the meantime. Reversing the order would leave a
 * window where refresh tokens are revoked but the account can still be
 * signed into fresh (disable not yet applied), which is strictly worse.
 *
 * WHAT THIS STEP DOES NOT DO (Fase 5 §14 — read this before assuming the
 * step alone is sufficient): revoking refresh tokens does not invalidate an
 * ID token already in a client's hands before its normal ~1 hour expiry.
 * Blocking USE of such a token for private operations during that window is
 * `activeAccountGuard.ts` (backend callables) and the Firestore/Storage
 * Rules changes' job, not this step's.
 */

import type { Auth } from 'firebase-admin/auth';

import { auth as defaultAdminAuth } from '../lib/firebaseAdmin';
import type { AccountDeletionStepOutcome, KnownErrorCode } from './errors';

/**
 * Maps a Firebase Admin Auth error to the shared taxonomy. `auth/user-not-found`
 * is LOGICAL SUCCESS here (`ALREADY_DELETED`, reused rather than inventing a
 * new code): this step's objective — "this uid cannot use its old session to
 * authenticate" — is already satisfied if there is no Auth user at all.
 * Everything else defaults to retryable, since Admin Auth's own failure
 * modes for these two calls are overwhelmingly transient (network/quota),
 * and a wrongly-terminal classification here would block the ENTIRE
 * workflow at its very first step without ever getting another attempt.
 */
function classifyAdminAuthError(error: unknown): KnownErrorCode {
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
 * Runs one attempt of `ACCOUNT_ACCESS_LOCK` for `uid`. Never throws — always
 * resolves an `AccountDeletionStepOutcome`, exactly like
 * `providerRevocation/appleProviderRevocation.ts`'s `revokeAppleProvider`,
 * for the same reason: the (future) worker's step-completion machinery
 * (`steps.ts`'s `completeStepAttempt`) is the only place that turns an
 * outcome into a persisted status.
 */
export async function lockAccountAccess(
  uid: string,
  adminAuth: Pick<Auth, 'updateUser' | 'revokeRefreshTokens'> = defaultAdminAuth,
): Promise<AccountDeletionStepOutcome> {
  try {
    await adminAuth.updateUser(uid, { disabled: true });
  } catch (error) {
    return { kind: 'FAILED', code: classifyAdminAuthError(error) };
  }

  try {
    await adminAuth.revokeRefreshTokens(uid);
  } catch (error) {
    return { kind: 'FAILED', code: classifyAdminAuthError(error) };
  }

  return { kind: 'SUCCEEDED' };
}
