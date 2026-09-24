import {
  deleteUser,
  onAuthStateChanged,
  signInWithCredential,
  signInWithEmailAndPassword,
  linkWithCredential,
  fetchSignInMethodsForEmail,
  getAdditionalUserInfo,
  signOut,
  updateProfile,
  type AuthCredential,
  type User,
} from 'firebase/auth';

import { auth } from '../lib/firebase';
import { logAuthError, toAuthError } from './auth';
import { getGoogleCredential, isGoogleSigninAvailable } from './providers/google';
import { getAppleCredential, isAppleAuthAvailable } from './providers/apple';
import { SocialAuthCancelledError, type ProviderResult } from './providers/types';
import { createSingleFlight } from '../lib/singleFlight';
import { logInfo } from '../lib/logger';

/**
 * Provider-agnostic social authentication. Screens call `signInWithProvider`
 * with a provider key — there is no Google/Apple branching in the UI. All
 * providers funnel through the same Firebase `signInWithCredential` path, the
 * same first-login provisioning, and the same account-linking handling.
 */

export type SocialProvider = 'google' | 'apple';

export type SocialSignInResult = {
  user: User;
  /** Firebase's authoritative classification for this credential sign-in. */
  isNewUser: boolean;
};

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

// Google, Apple and account-linking all mutate the same Firebase Auth identity
// and share process-memory linking state. One common flight prevents two native
// provider sheets or two competing identity transitions from running together.
const socialIdentityFlight = createSingleFlight<SocialSignInResult | User>();

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
 * Bounded window this module waits, after `signInWithCredential` itself
 * rejects with `auth/network-request-failed`, for Firebase's OWN auth-state
 * machine to settle before concluding no session exists. Real incidents
 * (docs: 2026-09-24 orphaned-Google-account audit) show the identity
 * exchange can succeed server-side — Firebase creates/authenticates the
 * account and mints tokens — while the HTTP response carrying that outcome
 * back to this exact call is what gets lost; `auth.currentUser`/
 * `onAuthStateChanged` are Firebase's own live, authoritative view of
 * whether a session actually exists, entirely independent of whether THIS
 * promise resolved. Short enough to never make a genuine, total connection
 * failure (test scenario B) feel unresponsive.
 */
const NETWORK_FAILURE_RECONCILE_WINDOW_MS = 4000;

/**
 * Camada A (2026-09-24 orphaned-Google-account audit) — after a real
 * `auth/network-request-failed` from `signInWithCredential`, never assume
 * outright that no authentication occurred: Firebase's client SDK may still
 * be finishing internal token persistence, or may already have completed it
 * before this exact call's response was lost. `auth.currentUser` is
 * Firebase's own authoritative state, checked fresh here — never a UID
 * captured before the failed await. Resolves to `null` (never invents an
 * identity) when nothing appears within the bounded window.
 */
function reconcileAuthUserAfterNetworkFailure(): Promise<User | null> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise<User | null>((resolve) => {
    let settled = false;
    const finish = (value: User | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    const timer = setTimeout(() => finish(auth.currentUser), NETWORK_FAILURE_RECONCILE_WINDOW_MS);
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => finish(nextUser));
  });
}

/**
 * Signs in with a social provider. On success returns the Firebase user.
 * Throws `SocialAuthCancelledError` on cancel, or `AccountLinkingRequiredError`
 * when the email already exists under another provider.
 */
export function signInWithProvider(provider: SocialProvider): Promise<SocialSignInResult> {
  return socialIdentityFlight.run(
    () => performSignInWithProvider(provider),
  ) as Promise<SocialSignInResult>;
}

async function performSignInWithProvider(provider: SocialProvider): Promise<SocialSignInResult> {
  let result: ProviderResult;
  try {
    result = await acquireCredential[provider]();
  } catch (err) {
    if (err instanceof SocialAuthCancelledError) throw err;
    logAuthError(`${provider}:credential`, err);
    throw toAuthError(err);
  }

  // Baseline only — a guard to avoid ever misattributing a session that was
  // ALREADY there before this attempt to the reconciliation below. Never
  // used as the identity anything gets written under.
  const uidBeforeAttempt = auth.currentUser?.uid ?? null;

  try {
    const userCredential = await signInWithCredential(auth, result.credential);
    const { user } = userCredential;
    try {
      await applyDisplayName(user, result.displayName);
    } catch (displayNameError) {
      // A cosmetic profile update must not hide the UserCredential metadata
      // needed to classify and, when required, roll back a new identity.
      logAuthError(`${provider}:display-name`, displayNameError);
    }
    return {
      user,
      isNewUser: getAdditionalUserInfo(userCredential)?.isNewUser === true,
    };
  } catch (err) {
    if (errorCode(err) === 'auth/account-exists-with-different-credential') {
      pendingCredential = result.credential;
      const email =
        (typeof err === 'object' && err !== null && 'customData' in err
          ? (err as { customData?: { email?: string } }).customData?.email
          : '') ?? '';
      const methods = email ? await fetchSignInMethodsForEmail(auth, email) : [];
      throw new AccountLinkingRequiredError(email, methods, provider);
    }
    if (errorCode(err) === 'auth/network-request-failed') {
      const reconciled = await reconcileAuthUserAfterNetworkFailure();
      if (reconciled && reconciled.uid !== uidBeforeAttempt) {
        try {
          await applyDisplayName(reconciled, result.displayName);
        } catch (displayNameError) {
          logAuthError(`${provider}:display-name`, displayNameError);
        }
        logInfo('social-auth', 'network_failure_reconciled', { provider, uid: reconciled.uid });
        // Firebase's own `isNewUser` classification is unavailable here (no
        // `UserCredential` — the promise that would have carried it never
        // resolved). `isNewUser: false` is the SAFE default: it forces the
        // caller's own `getUserProfile` check rather than assuming "brand
        // new", so an account created by an EARLIER lost-response attempt is
        // still correctly recognized as needing provisioning, and
        // `rollbackIncompleteSocialIdentity` never deletes a real,
        // recoverable identity if eligibility fails downstream (it only
        // deletes when Firebase itself just reported `isNewUser: true`).
        return { user: reconciled, isNewUser: false };
      }
    }
    logAuthError(`${provider}:firebase-sign-in`, err);
    throw toAuthError(err);
  }
}

/**
 * Rolls back a federated identity that Firebase created before the app could
 * learn that legal acceptance was still missing. A first social sign-in is a
 * recent authentication, so `deleteUser` is the correct cleanup operation.
 * If deletion fails, signing out still prevents the incomplete identity from
 * becoming an app session; a later attempt remains gated by its missing
 * Firestore profile.
 */
export async function discardNewSocialIdentity(user: User): Promise<void> {
  try {
    await deleteUser(user);
  } catch (deletionError) {
    logAuthError('social-new-user:delete', deletionError);
    try {
      await signOut(auth);
    } catch (signOutError) {
      logAuthError('social-new-user:signout', signOutError);
    }
    throw toAuthError(deletionError);
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
  return socialIdentityFlight.run(
    () => performLinkingWithPassword(email, password),
  ) as Promise<User>;
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
  return socialIdentityFlight.run(
    () => performLinkingWithProvider(provider),
  ) as Promise<User>;
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
    logAuthError(`link:${provider}:firebase-sign-in`, err);
    throw toAuthError(err);
  }
}

/** Clears process-memory linking state when the flow is abandoned. */
export function clearPendingSocialAuthState(): void {
  pendingCredential = null;
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
