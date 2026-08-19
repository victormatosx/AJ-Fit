import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { GoogleAuthProvider } from 'firebase/auth';
import { GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID, assertGoogleConfig } from '../authConfig';
import {
  ProviderCredentialError,
  SocialAuthCancelledError,
  type ProviderResult,
} from './types';

/**
 * The Google Sign-In native module is loaded LAZILY (dynamic import) instead of
 * a top-level static import. Reason: the library calls
 * `TurboModuleRegistry.getEnforcing('RNGoogleSignin')` during module
 * evaluation, which throws when the native module is absent (Expo Go, or a
 * development build created before the package was added). A static import
 * would crash the whole app at startup; the lazy load defers (and catches)
 * that so Google simply reports itself unavailable instead.
 *
 * The fix for actually USING Google is a fresh dev/EAS build:
 *   npx expo run:ios | run:android   (or `eas build --profile development`).
 */
type GoogleSigninModule = typeof import('@react-native-google-signin/google-signin');

let cached: GoogleSigninModule | null = null;
let configured = false;

/**
 * Probes for the native module WITHOUT triggering `getEnforcing` (which throws).
 * Works on both the new architecture (TurboModuleRegistry) and the old one
 * (NativeModules). When absent, we must never import the JS wrapper, because
 * its module-evaluation calls `getEnforcing` and crashes.
 */
function nativeModulePresent(): boolean {
  try {
    if (TurboModuleRegistry.get?.('RNGoogleSignin') != null) return true;
  } catch {
    // ignore and fall through to the legacy check
  }
  return NativeModules?.RNGoogleSignin != null;
}

async function loadGoogleSignin(): Promise<GoogleSigninModule | null> {
  if (cached) return cached;
  if (!nativeModulePresent()) return null; // avoid the getEnforcing crash entirely
  try {
    cached = await import('@react-native-google-signin/google-signin');
    return cached;
  } catch {
    return null; // native module not in the binary
  }
}

function configure(g: GoogleSigninModule) {
  if (configured) return;
  assertGoogleConfig();
  type GoogleSigninConfig = Parameters<typeof g.GoogleSignin.configure>[0] & {
    iosClientId?: string;
  };
  const config: GoogleSigninConfig = {
    webClientId: GOOGLE_WEB_CLIENT_ID, // required so Firebase can verify the id token
  };
  if (Platform.OS === 'ios') {
    config.iosClientId = GOOGLE_IOS_CLIENT_ID;
  }
  g.GoogleSignin.configure(config);
  configured = true;
}

/** Whether the native Google module is present in the current binary. */
export async function isGoogleSigninAvailable(): Promise<boolean> {
  return (await loadGoogleSignin()) !== null;
}

/**
 * Opens the native Google sign-in sheet and returns a Firebase credential.
 * Throws `SocialAuthCancelledError` when the user cancels, or a clear error when
 * the native module is missing (needs a development build).
 */
export async function getGoogleCredential(): Promise<ProviderResult> {
  const g = await loadGoogleSignin();
  if (!g) {
    throw new ProviderCredentialError('providerUnavailable');
  }
  configure(g);
  try {
    if (Platform.OS === 'android') {
      await g.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }
    const response = await g.GoogleSignin.signIn();

    if (!g.isSuccessResponse(response)) {
      throw new SocialAuthCancelledError(); // response.type === 'cancelled'
    }

    const { idToken, user } = response.data;
    if (!idToken) {
      throw new ProviderCredentialError('identityTokenMissing');
    }

    return {
      credential: GoogleAuthProvider.credential(idToken),
      displayName: user.name ?? null,
    };
  } catch (err) {
    if (err instanceof SocialAuthCancelledError) throw err;
    if (g.isErrorWithCode(err) && err.code === g.statusCodes.SIGN_IN_CANCELLED) {
      throw new SocialAuthCancelledError();
    }
    if (g.isErrorWithCode(err) && err.code === g.statusCodes.IN_PROGRESS) {
      throw new ProviderCredentialError('providerBusy');
    }
    if (
      g.isErrorWithCode(err) &&
      err.code === g.statusCodes.PLAY_SERVICES_NOT_AVAILABLE
    ) {
      throw new ProviderCredentialError('providerUnavailable');
    }
    throw err;
  }
}

/**
 * Fase 3 — account deletion provider revocation. Outcome-based (never
 * throws): callers (`src/services/accountDeletionProviderRevocation.ts`)
 * report this outcome to the backend rather than treat a failure as fatal
 * to the whole deletion — see `functions/src/accountDeletion/
 * providerRevocation/googleProviderRevocation.ts`'s doc comment for the
 * full architecture decision this implements.
 */
export type GoogleRevokeAccessOutcome = 'revoked' | 'unavailable' | 'failed';

/**
 * `revokeAccess()` is documented (this library's own GitHub issue history,
 * checked during Fase 3) to sometimes never resolve on iOS. A bare `await`
 * here would hang the whole account-deletion flow indefinitely; this
 * timeout guarantees a definite outcome regardless of the native side's
 * behavior. A `'failed'` outcome from a timeout is safe to retry — it does
 * not mean Google's grant is still live, only that this attempt could not
 * confirm it was revoked.
 */
const REVOKE_ACCESS_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Revokes AJ Fit's OAuth grant on the user's Google account (distinct from
 * `signOut`, which only clears the local session — see the module doc
 * comment in `googleProviderRevocation.ts` for the full citation). Requires
 * an active Google SDK session on the device; the library has no silent
 * (non-interactive) re-establishment path in this codebase today, so if
 * `revokeAccess()` fails with no session available, this falls back to one
 * INTERACTIVE `getGoogleCredential()` sign-in (the same native sheet the
 * user already knows from login/reauth) before retrying revoke once. This
 * is deliberate, not a silent surprise: a user whose Fase 2 reauthentication
 * happened to use a different linked provider (password/Apple) would
 * otherwise never get a chance to re-establish the Google session
 * `revokeAccess()` needs.
 */
export async function revokeGoogleAccess(): Promise<GoogleRevokeAccessOutcome> {
  const g = await loadGoogleSignin();
  if (!g) return 'unavailable';
  configure(g);

  try {
    await withTimeout(g.GoogleSignin.revokeAccess(), REVOKE_ACCESS_TIMEOUT_MS);
    return 'revoked';
  } catch {
    // No active Google SDK session, a transient library error, or our own
    // timeout — all treated the same way here: try to establish a fresh
    // session once, then retry revoke exactly once.
  }

  try {
    await getGoogleCredential();
  } catch {
    return 'failed';
  }

  try {
    await withTimeout(g.GoogleSignin.revokeAccess(), REVOKE_ACCESS_TIMEOUT_MS);
    return 'revoked';
  } catch {
    return 'failed';
  }
}
