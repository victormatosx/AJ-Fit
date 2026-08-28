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

type AppCheckGlobal = typeof globalThis & {
  __ajFitFirebaseAppCheck?: AppCheck;
  FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
};

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
    getToken: () => getNativeAppCheckToken(false),
  });

  const appCheck = initializeAppCheck(app, {
    provider,
    isTokenAutoRefreshEnabled: true,
  });
  shared.__ajFitFirebaseAppCheck = appCheck;
  return appCheck;
}
