import {
  getMultiFactorResolver,
  TotpMultiFactorGenerator,
  type MultiFactorError,
  type MultiFactorResolver,
} from 'firebase/auth';

import { auth } from '../lib/firebase';
import {
  getFirebaseErrorCode,
  isMultiFactorAuthRequired,
  selectTotpFactors,
  validateTotpCode,
} from '../lib/mfaTotp';
import { hasRecentAuth } from '../lib/recentAuth';
import {
  ReauthenticationCancelledError,
  ReauthenticationServiceError,
  reauthenticateCurrentUser,
  type ReauthenticationRequest,
} from './reauthentication';

/**
 * Client-side reauthentication for the "Excluir Conta" flow (Fase 2 —
 * contrato técnico only; no destructive account-deletion call exists here
 * or anywhere reachable from this module).
 *
 * This module composes THREE pieces of infrastructure that already exist
 * and are already tested elsewhere, rather than reimplementing any of them:
 *   - `reauthenticateCurrentUser` (`./reauthentication.ts`) — password/
 *     Google/Apple credential reauthentication, UID-mismatch protection,
 *     provider-linkage checks. UNCHANGED by this file.
 *   - The MFA/TOTP two-phase "attempt → maybe challenge → resolve" pattern
 *     already proven by `startTotpUnenrollment`/`finishTotpUnenrollment`
 *     (`./mfaTotp.ts`). This file mirrors that exact shape for account
 *     deletion instead of duplicating a parallel MFA implementation.
 *   - `hasRecentAuth` (`../lib/recentAuth.ts`) — the same freshness check
 *     already established for Photo Vault key recovery.
 *
 * What THIS file adds on top, specific to account deletion:
 *   1. A closed error taxonomy (`AccountDeletionReauthErrorCode`) so a
 *      future "Excluir Conta" screen never has to branch on raw Firebase
 *      error codes or on `ReauthenticationServiceError.issue` string values.
 *   2. An explicit, final UID re-check + forced ID token refresh
 *      immediately after reauthentication succeeds — see
 *      `finalizeReauthentication` below for why neither step can be assumed
 *      to already be covered "for free".
 */

// ── Error taxonomy ─────────────────────────────────────────────────────────

export type AccountDeletionReauthErrorCode =
  | 'USER_SIGNED_OUT'
  | 'IDENTITY_CHANGED'
  | 'PROVIDER_MISMATCH'
  | 'WRONG_PASSWORD'
  | 'PASSWORD_REQUIRED'
  | 'USER_CANCELLED'
  | 'RATE_LIMITED'
  | 'SESSION_EXPIRED'
  | 'NETWORK_ERROR'
  | 'MFA_CANCELLED'
  | 'MFA_INVALID_CODE'
  | 'REAUTH_FAILED';

/**
 * The only error type this module ever throws. Carries a closed `code`
 * only — never the underlying Firebase error, credential, token, or nonce
 * (see the module-level "never log/expose" list in
 * `docs/25_exclusao_de_conta_arquitetura.md`'s observability section,
 * which this mirrors for reauthentication-specific events).
 */
export class AccountDeletionReauthError extends Error {
  readonly code: AccountDeletionReauthErrorCode;

  constructor(code: AccountDeletionReauthErrorCode) {
    super(code);
    this.name = 'AccountDeletionReauthError';
    this.code = code;
  }
}

/** Maps any error `reauthenticateCurrentUser`/the MFA resolver can throw into the closed taxonomy above. */
function mapReauthError(error: unknown): AccountDeletionReauthError {
  if (error instanceof AccountDeletionReauthError) return error;

  if (error instanceof ReauthenticationCancelledError) {
    return new AccountDeletionReauthError('USER_CANCELLED');
  }

  if (error instanceof ReauthenticationServiceError) {
    switch (error.issue) {
      case 'userMissing':
        return new AccountDeletionReauthError('USER_SIGNED_OUT');
      case 'userMismatch':
        return new AccountDeletionReauthError('IDENTITY_CHANGED');
      case 'reauthProviderUnsupported':
        return new AccountDeletionReauthError('PROVIDER_MISMATCH');
      default:
        return new AccountDeletionReauthError('REAUTH_FAILED');
    }
  }

  switch (getFirebaseErrorCode(error)) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return new AccountDeletionReauthError('WRONG_PASSWORD');
    case 'auth/missing-password':
      return new AccountDeletionReauthError('PASSWORD_REQUIRED');
    case 'auth/password-provider-required':
    case 'auth/missing-email':
      return new AccountDeletionReauthError('PROVIDER_MISMATCH');
    case 'auth/user-mismatch':
      return new AccountDeletionReauthError('IDENTITY_CHANGED');
    case 'auth/no-current-user':
      return new AccountDeletionReauthError('USER_SIGNED_OUT');
    case 'auth/too-many-requests':
      return new AccountDeletionReauthError('RATE_LIMITED');
    case 'auth/requires-recent-login':
    case 'auth/user-token-expired':
    case 'auth/invalid-user-token':
      return new AccountDeletionReauthError('SESSION_EXPIRED');
    case 'auth/network-request-failed':
      return new AccountDeletionReauthError('NETWORK_ERROR');
    default:
      return new AccountDeletionReauthError('REAUTH_FAILED');
  }
}

// ── MFA challenge (mirrors TotpUnenrollmentChallenge's shape) ──────────────

export type AccountDeletionMfaHint = {
  /** Internal selection key. Never rendered or persisted. */
  uid: string;
  displayName: string | null;
};

export type AccountDeletionMfaChallenge = {
  readonly expectedUid: string;
  readonly hints: AccountDeletionMfaHint[];
  readonly resolver: MultiFactorResolver;
};

export type AccountDeletionReauthOutcome =
  | { status: 'completed'; uid: string; authTimeSeconds: number }
  | { status: 'challenge'; challenge: AccountDeletionMfaChallenge };

// ── Final UID check + forced token refresh ──────────────────────────────────

/**
 * The last line of defense before a caller may treat reauthentication as
 * good enough to invoke the (future) `requestAccountDeletion` callable.
 *
 * Two things happen here, deliberately as the FINAL step, not folded into
 * `reauthenticateCurrentUser` itself (which already does its own internal
 * UID checks, but those protect ITS OWN control flow, not this specific
 * call site's):
 *
 *   1. Re-checks `auth.currentUser?.uid === expectedUid` one more time,
 *      immediately before returning control to the caller. Fase 2 §14's
 *      threat: the Auth state could have changed between
 *      `reauthenticateCurrentUser` resolving and this function running (a
 *      concurrent sign-out/sign-in elsewhere in the app) — a race
 *      `reauthenticateCurrentUser`'s own internal check cannot see because
 *      it already returned.
 *
 *   2. Forces an ID token refresh (`user.getIdToken(true)`). This is NOT
 *      redundant with what `reauthenticateWithCredential`/the resulting
 *      sign-in already does internally — Fase 2 §7 asks this to be audited
 *      explicitly rather than assumed: the Firebase JS SDK updates its
 *      cached STS token as part of a successful
 *      `reauthenticateWithCredential`/password reauth, and that cached
 *      token IS what a later `getIdToken()` (including the one the Callable
 *      Functions SDK performs before invoking `requestAccountDeletion`)
 *      would normally return without a network round trip. Forcing a
 *      refresh here removes any dependency on that internal caching detail
 *      remaining true across SDK versions — it costs one extra network call
 *      at reauthentication time (not on every retry, since only THIS
 *      client-side call forces it) in exchange for never having to trust an
 *      unaudited assumption about token cache freshness at the security
 *      boundary. `getIdTokenResult`'s `authTime` is returned as safe,
 *      already-parsed telemetry — never the token itself.
 */
async function finalizeReauthentication(expectedUid: string): Promise<AccountDeletionReauthOutcome> {
  const current = auth.currentUser;
  if (!current || current.uid !== expectedUid) {
    throw new AccountDeletionReauthError(current ? 'IDENTITY_CHANGED' : 'USER_SIGNED_OUT');
  }

  const result = await current.getIdTokenResult(true);
  const authTimeMs = Date.parse(result.authTime);

  return {
    status: 'completed',
    uid: expectedUid,
    authTimeSeconds: Number.isNaN(authTimeMs) ? 0 : Math.floor(authTimeMs / 1000),
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Whether the current session is fresh enough that a recent-auth-gated
 * backend call is likely to be accepted WITHOUT prompting the user again.
 *
 * This is the decision point for Fase 2 §16 (never silently chosen): the
 * policy adopted here is Option B — "if the session already satisfies
 * recent-auth, don't force a redundant reauthentication prompt" — matching
 * the existing, already-shipped precedent for Photo Vault key recovery
 * (`src/services/photoVault.ts`'s `hasRecentAuth`/`ensureVaultKey`, which
 * only prompts when `!hasRecentAuth()`). Consistency with an established
 * pattern for another sensitive operation was preferred over inventing a
 * stricter "always reauthenticate" rule specific to deletion, for which no
 * concrete threat beyond what recent-auth already mitigates was identified
 * — see `docs/25_exclusao_de_conta_arquitetura.md`'s Fase 2 addendum. A
 * future "Excluir Conta" screen calls this first; only when it resolves
 * `false` does it need to invoke `startAccountDeletionReauthentication`.
 */
export function needsAccountDeletionReauthentication(): Promise<boolean> {
  return hasRecentAuth(auth.currentUser).then((fresh) => !fresh);
}

/**
 * Starts (or completes, when no second factor is required) reauthentication
 * for the account-deletion flow. Captures `expectedUid` BEFORE any
 * `await`, per Fase 2 §14 — the provider sheet (Google/Apple) or the
 * password reauth call can each take an arbitrary amount of time, during
 * which the app's Auth state must not be trusted to still be the same user.
 */
export async function startAccountDeletionReauthentication(
  request: ReauthenticationRequest,
): Promise<AccountDeletionReauthOutcome> {
  const expectedUid = auth.currentUser?.uid ?? null;
  if (!expectedUid) throw new AccountDeletionReauthError('USER_SIGNED_OUT');

  try {
    const reauthenticated = await reauthenticateCurrentUser(request, {
      preserveMultiFactorError: true,
    });
    if (reauthenticated.uid !== expectedUid) {
      throw new AccountDeletionReauthError('IDENTITY_CHANGED');
    }
    return await finalizeReauthentication(expectedUid);
  } catch (error) {
    if (!isMultiFactorAuthRequired(error)) throw mapReauthError(error);

    const resolver = getMultiFactorResolver(auth, error as MultiFactorError);
    const totpHints = selectTotpFactors(resolver.hints);
    if (totpHints.length === 0) {
      throw new AccountDeletionReauthError('REAUTH_FAILED');
    }

    return {
      status: 'challenge',
      challenge: {
        expectedUid,
        resolver,
        hints: totpHints.map((hint) => ({
          uid: hint.uid,
          displayName: hint.displayName ?? null,
        })),
      },
    };
  }
}

/**
 * Resolves a second-factor challenge returned by
 * `startAccountDeletionReauthentication`. Mirrors
 * `finishTotpUnenrollment`'s validation order exactly (uid re-check before
 * touching the resolver, code format validated before calling Firebase).
 */
export async function finishAccountDeletionReauthentication(
  challenge: AccountDeletionMfaChallenge,
  hintUid: string,
  code: string,
): Promise<AccountDeletionReauthOutcome> {
  const current = auth.currentUser;
  if (!current) throw new AccountDeletionReauthError('USER_SIGNED_OUT');
  if (current.uid !== challenge.expectedUid) {
    throw new AccountDeletionReauthError('IDENTITY_CHANGED');
  }

  const normalizedCode = code.trim();
  // validateTotpCode only ever returns 'codeRequired' | 'codeNonNumeric' |
  // 'codeLength' | null (src/lib/mfaTotp.ts) — every non-null outcome maps
  // to the same client-facing code here.
  if (validateTotpCode(normalizedCode)) {
    throw new AccountDeletionReauthError('MFA_INVALID_CODE');
  }

  const hint = challenge.hints.find((candidate) => candidate.uid === hintUid);
  if (!hint) throw new AccountDeletionReauthError('MFA_INVALID_CODE');

  try {
    const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, normalizedCode);
    const credential = await challenge.resolver.resolveSignIn(assertion);
    if (credential.user.uid !== challenge.expectedUid) {
      throw new AccountDeletionReauthError('IDENTITY_CHANGED');
    }
  } catch (error) {
    if (error instanceof AccountDeletionReauthError) throw error;
    if (getFirebaseErrorCode(error) === 'auth/invalid-verification-code') {
      throw new AccountDeletionReauthError('MFA_INVALID_CODE');
    }
    throw mapReauthError(error);
  }

  return finalizeReauthentication(challenge.expectedUid);
}
