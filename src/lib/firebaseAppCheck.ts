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
};

/**
 * Connects the native attestation SDK to the same Firebase JS App used by
 * Auth, Firestore, Storage, and Functions. Firebase JS owns product headers;
 * AJ Fit never constructs X-Firebase-AppCheck manually.
 */
export function initializeFirebaseAppCheck(app: FirebaseApp): AppCheck | null {
  if (Platform.OS === 'web' || !isNativeAppCheckAvailable()) return null;

  const shared = globalThis as AppCheckGlobal;
  if (shared.__ajFitFirebaseAppCheck) return shared.__ajFitFirebaseAppCheck;

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
