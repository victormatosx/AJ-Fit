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
