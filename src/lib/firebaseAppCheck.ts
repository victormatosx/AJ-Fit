import {
  CustomProvider,
  initializeAppCheck,
  type AppCheck,
} from 'firebase/app-check';
import type { FirebaseApp } from 'firebase/app';
import { Platform } from 'react-native';

import {
  getNativeAppCheckToken,
  isNativeAppCheckAvailable,
} from './nativeAppCheck';
import { errorClass, errorCode, logWarn } from './logger';

type AppCheckGlobal = typeof globalThis & {
  __ajFitFirebaseAppCheck?: AppCheck;
  FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
};

/**
 * DEV-only failure categorization — never changes behavior, only what gets
 * logged. `initializeFirebaseAppCheck`'s `CustomProvider.getToken` rethrows
 * the original error unchanged either way; the app-level `@firebase/auth`
 * "Error while retrieving App Check token" log (and the Functions SDK's own
 * `functions/unauthenticated`) still fire exactly as before. This just adds
 * a second, categorized log line — in `__DEV__` only, never in a shipped
 * build — so the failure reason is visible in the app's own log stream
 * instead of requiring the Xcode/device console for every diagnosis.
 *
 * Maps the real error codes this module and its native layer can throw:
 * - `ERR_APP_CHECK_MODULE_UNAVAILABLE` (modules/ajfit-app-check/index.ts) → MODULE_NOT_AVAILABLE
 * - `ERR_APP_CHECK_NOT_CONFIGURED` (AJFitAppCheckModule.swift)            → FIREBASE_NOT_CONFIGURED
 * - `ERR_APP_CHECK_TOKEN` (AJFitAppCheckModule.swift)                    → NATIVE_ERROR (message now carries the real NSError domain/code/description)
 * - `ERR_APP_CHECK_INVALID_TOKEN` (nativeAppCheck.ts)                    → TOKEN_REJECTED (native returned a malformed/expired contract)
 * - anything else                                                        → UNKNOWN
 */
function categorizeAppCheckFailure(error: unknown): string {
  switch (errorCode(error)) {
    case 'ERR_APP_CHECK_MODULE_UNAVAILABLE': return 'MODULE_NOT_AVAILABLE';
    case 'ERR_APP_CHECK_NOT_CONFIGURED': return 'FIREBASE_NOT_CONFIGURED';
    case 'ERR_APP_CHECK_TOKEN': return 'NATIVE_ERROR';
    case 'ERR_APP_CHECK_INVALID_TOKEN': return 'TOKEN_REJECTED';
    default: return 'UNKNOWN';
  }
}

/**
 * Connects the native attestation SDK to the same Firebase JS App used by
 * Auth, Firestore, Storage, and Functions. Firebase JS owns product headers;
 * AJ Fit never constructs X-Firebase-AppCheck manually.
 *
 * Native App Attest (iOS)/Play Integrity (Android) attestation is only
 * available through the real native module (`modules/ajfit-app-check`) —
 * which is legitimately absent in Expo Go and some dev-client builds. Before
 * this, that meant App Check stayed fully uninitialized in those
 * environments (`null`, below), so ANY callable declared
 * `enforceAppCheck: true` server-side (e.g. `confirmCommercialGate`) was
 * unconditionally unreachable there, surfacing as the misleading
 * `functions/unauthenticated`/`ERR_APP_CHECK_TOKEN` pair audited in the
 * onboarding-lifecycle report. In `__DEV__` only, when the native module is
 * unavailable, this now opts into Firebase App Check's own standard debug
 * mechanism (`FIREBASE_APPCHECK_DEBUG_TOKEN` — documented at
 * https://firebase.google.com/docs/app-check/web/debug-provider, and
 * equally supported by the JS SDK on React Native): setting it makes the SDK
 * bypass the configured provider and perform a debug-token exchange
 * instead, using a token registered in the Firebase Console for this
 * project. Production behavior (a real device with the native module
 * present) is completely untouched — this branch is never reached there.
 */
export function initializeFirebaseAppCheck(app: FirebaseApp): AppCheck | null {
  if (Platform.OS === 'web') return null;

  const shared = globalThis as AppCheckGlobal;
  if (shared.__ajFitFirebaseAppCheck) return shared.__ajFitFirebaseAppCheck;

  const nativeAvailable = isNativeAppCheckAvailable();
  // `typeof __DEV__ !== 'undefined'` guard matches the existing pattern in
  // `src/lib/photoVaultPerformance.ts` — Metro/RN injects the `__DEV__`
  // global at runtime; it does not exist under plain Node/Vitest.
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  if (!nativeAvailable && !isDev) return null;

  if (!nativeAvailable) {
    // Debug-token exchange only — never a bypass of `enforceAppCheck` on the
    // server, and never reachable in a production build (`__DEV__` gate
    // above). Requires a debug token to actually be registered for this
    // project in the Firebase Console; without one, calls still fail, but
    // now for a verifiable, documented reason instead of silently having no
    // App Check at all.
    shared.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }

  const provider = new CustomProvider({
    getToken: () => getNativeAppCheckToken(false).catch((error: unknown) => {
      if (isDev) {
        logWarn('app-check', 'native_token_fetch_failed', {
          category: categorizeAppCheckFailure(error),
          errorClass: errorClass(error),
          errorCode: errorCode(error) ?? 'UNCLASSIFIED',
          nativeAvailable,
        });
      }
      throw error;
    }),
  });

  const appCheck = initializeAppCheck(app, {
    provider,
    isTokenAutoRefreshEnabled: true,
  });
  shared.__ajFitFirebaseAppCheck = appCheck;
  return appCheck;
}
