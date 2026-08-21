import {
  signInWithCredential,
  signInWithEmailAndPassword,
  linkWithCredential,
  fetchSignInMethodsForEmail,
  updateProfile,
  type AuthCredential,
  type User,
} from 'firebase/auth';

import { auth } from '../lib/firebase';
import { isMultiFactorAuthRequired } from '../lib/mfaTotp';
import { logAuthError, toAuthError } from './auth';
import { getGoogleCredential, isGoogleSigninAvailable } from './providers/google';
import { getAppleCredential, isAppleAuthAvailable } from './providers/apple';
import { SocialAuthCancelledError, type ProviderResult } from './providers/types';
import { createSingleFlight } from '../lib/singleFlight';

/**
 * Provider-agnostic social authentication. Screens call `signInWithProvider`
 * with a provider key — there is no Google/Apple branching in the UI. All
 * providers funnel through the same Firebase `signInWithCredential` path, the
 * same first-login provisioning, and the same account-linking handling.
 */

export type SocialProvider = 'google' | 'apple';

export { SocialAuthCancelledError, isAppleAuthAvailable, isGoogleSigninAvailable };

/** Firebase providerId ↔ friendly label used across the app. */
export const PROVIDER_LABELS: Record<string, string> = {
  'password': 'E-mail/Senha',
  'google.com': 'Google',
  'apple.com': 'Apple',
};

const PROVIDER_ID: Record<SocialProvider, string> = {
  google: 'google.com',
  apple: 'apple.com',
};

/** Registry: the ONLY place that knows which acquirer belongs to a provider. */
const acquireCredential: Record<SocialProvider, () => Promise<ProviderResult>> = {
  google: getGoogleCredential,
  apple: getAppleCredential,
};

/**
 * Raised when the incoming social credential belongs to an email that already
 * has an account with a different sign-in method. The UI uses this to guide the
 * user through linking (same UID, no duplicate account).
 */
export class AccountLinkingRequiredError extends Error {
  email: string;
  /** Existing sign-in methods for the email (e.g. ['password'], ['google.com']). */
  methods: string[];
  /** The provider the user just tried to use. */
  attempted: SocialProvider;

  constructor(email: string, methods: string[], attempted: SocialProvider) {
    super('account-exists-with-different-credential');
    this.name = 'AccountLinkingRequiredError';
    this.email = email;
    this.methods = methods;
    this.attempted = attempted;
  }
}

// The credential that failed with account-exists — held until linking completes.
let pendingCredential: AuthCredential | null = null;
let pendingMfaDisplayName: string | null = null;

// Google, Apple and account-linking all mutate the same Firebase Auth identity
// and share process-memory linking state. One common flight prevents two native
// provider sheets or two competing identity transitions from running together.
const socialIdentityFlight = createSingleFlight<User>();

async function applyDisplayName(user: User, displayName?: string | null) {
  if (!user.displayName && displayName?.trim()) {
    await updateProfile(user, { displayName: displayName.trim() });
  }
}

function errorCode(err: unknown): string {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : '';
}

/**
 * Signs in with a social provider. On success returns the Firebase user.
 * Throws `SocialAuthCancelledError` on cancel, or `AccountLinkingRequiredError`
 * when the email already exists under another provider.
 */
export function signInWithProvider(provider: SocialProvider): Promise<User> {
  return socialIdentityFlight.run(() => performSignInWithProvider(provider));
}

async function performSignInWithProvider(provider: SocialProvider): Promise<User> {
  let result: ProviderResult;
  try {
    result = await acquireCredential[provider]();
  } catch (err) {
    if (err instanceof SocialAuthCancelledError) throw err;
    logAuthError(`${provider}:credential`, err);
    throw toAuthError(err);
  }

  try {
    const { user } = await signInWithCredential(auth, result.credential);
    await applyDisplayName(user, result.displayName);
    return user;
  } catch (err) {
    if (errorCode(err) === 'auth/account-exists-with-different-credential') {
      pendingCredential = result.credential;
      pendingMfaDisplayName = null;
      const email =
        (typeof err === 'object' && err !== null && 'customData' in err
          ? (err as { customData?: { email?: string } }).customData?.email
          : '') ?? '';
      const methods = email ? await fetchSignInMethodsForEmail(auth, email) : [];
      throw new AccountLinkingRequiredError(email, methods, provider);
    }
    if (isMultiFactorAuthRequired(err)) {
      // Preserve the original Firebase error so getMultiFactorResolver can
      // continue this exact first-factor session without reopening Google or
      // Apple. Only the non-sensitive display name remains for post-MFA setup.
      pendingMfaDisplayName = result.displayName?.trim() || null;
      throw err;
    }
    logAuthError(`${provider}:firebase-sign-in`, err);
    throw toAuthError(err);
  }
}

/**
 * Completes a pending link by re-authenticating with the existing email/password
 * account and attaching the pending social credential to the SAME user.
 */
export function completeLinkingWithPassword(
  email: string,
  password: string,
): Promise<User> {
  return socialIdentityFlight.run(() => performLinkingWithPassword(email, password));
}

async function performLinkingWithPassword(
  email: string,
  password: string,
): Promise<User> {
  try {
    const { user } = await signInWithEmailAndPassword(auth, email.trim(), password);
    if (pendingCredential) {
      const { user: linkedUser } = await linkWithCredential(user, pendingCredential);
      pendingCredential = null;
      return linkedUser;
    }
    return user;
  } catch (err) {
    if (isMultiFactorAuthRequired(err)) throw err;
    logAuthError('link:password', err);
    throw toAuthError(err);
  }
}

/**
 * Completes a pending link by re-authenticating with another social provider
 * (the one that owns the email) and attaching the pending credential.
 */
export function completeLinkingWithProvider(
  provider: SocialProvider,
): Promise<User> {
  return socialIdentityFlight.run(() => performLinkingWithProvider(provider));
}

async function performLinkingWithProvider(
  provider: SocialProvider,
): Promise<User> {
  let result: ProviderResult;
  try {
    result = await acquireCredential[provider]();
  } catch (err) {
    if (err instanceof SocialAuthCancelledError) throw err;
    logAuthError(`link:${provider}:credential`, err);
    throw toAuthError(err);
  }
  try {
    const { user } = await signInWithCredential(auth, result.credential);
    await applyDisplayName(user, result.displayName);
    if (pendingCredential) {
      const { user: linkedUser } = await linkWithCredential(user, pendingCredential);
      pendingCredential = null;
      return linkedUser;
    }
    return user;
  } catch (err) {
    if (isMultiFactorAuthRequired(err)) {
      pendingMfaDisplayName = result.displayName?.trim() || null;
      throw err;
    }
    logAuthError(`link:${provider}:firebase-sign-in`, err);
    throw toAuthError(err);
  }
}

/**
 * Finishes the non-authentication work that follows a social first factor.
 * `resolveSignIn` itself remains authoritative for authentication; this only
 * restores the existing display-name/linking behavior after MFA completes.
 */
export async function finalizeSocialSignInAfterMfa(
  user: User,
  linkPending: boolean,
): Promise<User> {
  try {
    await applyDisplayName(user, pendingMfaDisplayName);
    pendingMfaDisplayName = null;
    if (linkPending && pendingCredential) {
      const { user: linkedUser } = await linkWithCredential(user, pendingCredential);
      pendingCredential = null;
      return linkedUser;
    }
    return user;
  } catch (err) {
    // The resolver/session/credentials are intentionally never logged.
    logAuthError('mfa:finalize-social', err);
    throw toAuthError(err);
  }
}

/** Clears all process-memory state when linking or MFA is abandoned. */
export function clearPendingSocialAuthState(): void {
  pendingCredential = null;
  pendingMfaDisplayName = null;
}

/** Maps a methods list to the social provider key (for OAuth→OAuth linking). */
export function socialProviderFromMethods(
  methods: string[],
): SocialProvider | null {
  if (methods.includes(PROVIDER_ID.google)) return 'google';
  if (methods.includes(PROVIDER_ID.apple)) return 'apple';
  return null;
}

/** Linked providerIds for a user, e.g. ['password','google.com']. */
export function getLinkedProviders(user: User): string[] {
  return user.providerData.map((p) => p.providerId);
}
