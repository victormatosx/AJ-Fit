import {
  reauthenticateWithCredential,
  type AuthCredential,
} from 'firebase/auth';

import { auth } from '../lib/firebase';
import { getReauthenticationProviders } from '../lib/authProviders';
import { hasRecentAuth } from '../lib/recentAuth';
import { getAppleCredentialForAccountDeletion } from './providers/apple';
import { SocialAuthCancelledError } from './providers/types';
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
 *     Google credential reauthentication, UID-mismatch protection,
 *     provider-linkage checks. UNCHANGED by this file. Apple is handled
 *     separately below (Fase 16) — see that section's doc comment for why.
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
 *   3. Fase 16 (Apple prompt consolidation — see
 *      `docs/25_exclusao_de_conta_arquitetura.md`'s Fase 16 section): for
 *      Apple specifically, this module captures the `authorizationCode`
 *      Apple's REST revoke needs from the SAME native sign-in call that
 *      proves Firebase recent-auth — never a second `AppleAuthentication
 *      .signInAsync()`. `AccountDeletionReauthOutcome`'s `completed` variant
 *      carries an OPTIONAL `appleAuthorizationCode`, populated ONLY on the
 *      Apple path — `reauthenticateCurrentUser` (password/Google, and every
 *      OTHER caller of that shared function — including Photo Vault — never
 *      sees or produces this field. This keeps the
 *      blast radius of Fase 16 to this one file's Apple-specific code path.
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
  | 'REAUTH_FAILED';

function getFirebaseErrorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
}

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

/** Maps reauthentication errors into the closed taxonomy above. */
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

export type AccountDeletionReauthOutcome = {
  status: 'completed';
  uid: string;
  authTimeSeconds: number;
  /** Present only when `provider: 'apple'` produced it. Single-use; the caller must consume it or discard it, never persist it. */
  appleAuthorizationCode?: string;
};

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
 *
 * Fase 16 EXCEPTION: for an Apple-linked account this ALWAYS resolves
 * `true`, regardless of session freshness. Recent-auth freshness has no
 * bearing on whether a fresh Apple `authorizationCode` is available — that
 * material is single-use and ~5-minute-lived by Apple's own contract, so
 * "the Firebase session happens to still be fresh" can never substitute for
 * capturing it. Since Fase 16 made this module the ONLY place Apple
 * material is ever captured (the orchestrator no longer opens Apple itself
 * — see `accountDeletionOrchestrator.ts`), skipping the reauth step for an
 * Apple-linked account would leave the confirm step with no material to
 * send at all. Password/Google are UNCHANGED — still governed purely by
 * `hasRecentAuth`.
 */
export function needsAccountDeletionReauthentication(): Promise<boolean> {
  const user = auth.currentUser;
  if (user && getReauthenticationProviders(user).includes('apple')) {
    return Promise.resolve(true);
  }
  return hasRecentAuth(user).then((fresh) => !fresh);
}

/**
 * Fase 16 — the Apple-specific reauthentication path. ONE call to
 * `getAppleCredentialForAccountDeletion()` (the ONLY function in this
 * codebase that reads `authorizationCode` off a native Apple result —
 * `apple.native.ts`'s doc comment) yields BOTH the Firebase credential
 * (`identityToken` + the SAME `rawNonce` sent to Apple, exactly like
 * `getAppleCredential` builds for every other Apple sign-in in this app —
 * `apple.native.ts`'s `performAppleSignIn` is the single nonce-generation
 * site, unchanged) AND the `authorizationCode` the backend later exchanges
 * for revocation. This function then does its own `reauthenticateWithCredential`
 * (never delegating to `reauthenticateCurrentUser`, which would need to
 * either discard `authorizationCode` or leak it into the shared Photo Vault
 * contract — Fase 16 §3) with the SAME uid-consistency guards
 * `reauthenticateCurrentUser` already applies for every other provider.
 */
async function startAppleAccountDeletionReauthentication(
  expectedUid: string,
): Promise<AccountDeletionReauthOutcome> {
  const initialUser = auth.currentUser;
  if (!initialUser || initialUser.uid !== expectedUid) {
    throw new AccountDeletionReauthError(initialUser ? 'IDENTITY_CHANGED' : 'USER_SIGNED_OUT');
  }
  if (!getReauthenticationProviders(initialUser).includes('apple')) {
    throw new AccountDeletionReauthError('PROVIDER_MISMATCH');
  }

  let credential: AuthCredential;
  let authorizationCode: string;
  try {
    const result = await getAppleCredentialForAccountDeletion();
    credential = result.credential;
    authorizationCode = result.authorizationCode;
  } catch (error) {
    if (error instanceof SocialAuthCancelledError) {
      throw new AccountDeletionReauthError('USER_CANCELLED');
    }
    // ProviderCredentialError (missing identityToken/authorizationCode) or
    // any other native-layer failure — never a commit-eligible outcome, and
    // never SESSION_EXPIRED (this has nothing to do with Firebase recent-auth).
    throw new AccountDeletionReauthError('REAUTH_FAILED');
  }

  // The sheet can stay open long enough for the session to change
  // underneath it — same threat `reauthenticateCurrentUser` guards against
  // for every other provider (`reauthentication.ts`).
  const afterSheetUser = auth.currentUser;
  if (!afterSheetUser || afterSheetUser.uid !== expectedUid) {
    throw new AccountDeletionReauthError(afterSheetUser ? 'IDENTITY_CHANGED' : 'USER_SIGNED_OUT');
  }

  try {
    const result = await reauthenticateWithCredential(afterSheetUser, credential);
    if (result.user.uid !== expectedUid) {
      throw new AccountDeletionReauthError('IDENTITY_CHANGED');
    }
  } catch (error) {
    if (error instanceof AccountDeletionReauthError) throw error;
    throw mapReauthError(error);
  }

  const finalized = await finalizeReauthentication(expectedUid);
  return finalized.status === 'completed' ? { ...finalized, appleAuthorizationCode: authorizationCode } : finalized;
}

/**
 * Reauthenticates for the account-deletion flow. Captures `expectedUid`
 * BEFORE any
 * `await`, per Fase 2 §14 — the provider sheet (Google/Apple) or the
 * password reauth call can each take an arbitrary amount of time, during
 * which the app's Auth state must not be trusted to still be the same user.
 */
export async function startAccountDeletionReauthentication(
  request: ReauthenticationRequest,
): Promise<AccountDeletionReauthOutcome> {
  const expectedUid = auth.currentUser?.uid ?? null;
  if (!expectedUid) throw new AccountDeletionReauthError('USER_SIGNED_OUT');

  if (request.provider === 'apple') {
    return startAppleAccountDeletionReauthentication(expectedUid);
  }

  try {
    const reauthenticated = await reauthenticateCurrentUser(request);
    if (reauthenticated.uid !== expectedUid) {
      throw new AccountDeletionReauthError('IDENTITY_CHANGED');
    }
    return await finalizeReauthentication(expectedUid);
  } catch (error) {
    throw mapReauthError(error);
  }
}
