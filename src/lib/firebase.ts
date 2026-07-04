import { Platform } from 'react-native';
import { initializeApp, getApps, getApp, type FirebaseOptions } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  type Auth,
  type Persistence,
} from 'firebase/auth';
import * as firebaseAuth from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Centralized Firebase setup for AJ Fit.
 *
 * Config is read from Expo public env vars (see .env.example). Values are
 * inlined at build time for any key prefixed with EXPO_PUBLIC_.
 *
 * Note: we intentionally do NOT initialize Firebase Analytics here — it is a
 * browser-only module and would break the native (iOS/Android) bundle.
 */
const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

if (!firebaseConfig.apiKey) {
  throw new Error(
    'Firebase não configurado: defina as variáveis EXPO_PUBLIC_FIREBASE_* no arquivo .env ' +
      '(veja .env.example) e reinicie o servidor com `npx expo start -c`.',
  );
}

// Reuse the existing app across Fast Refresh reloads to avoid duplicate-init errors.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/**
 * `getReactNativePersistence` only exists in the React Native build of
 * firebase/auth (resolved by Metro via the "react-native" export condition),
 * so it is absent from the default type declarations. We reach it through the
 * module namespace with a narrow local type instead of an untyped ts-ignore.
 */
const getReactNativePersistence = (
  firebaseAuth as unknown as {
    getReactNativePersistence?: (storage: unknown) => Persistence;
  }
).getReactNativePersistence;

function createAuth(): Auth {
  // On web, the default persistence (IndexedDB/localStorage) is the right choice.
  if (Platform.OS === 'web' || !getReactNativePersistence) {
    return getAuth(app);
  }

  // On native, persist the session in AsyncStorage so users stay logged in.
  // initializeAuth throws if auth was already initialized (Fast Refresh);
  // fall back to the existing instance in that case.
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(app);
  }
}

export const auth = createAuth();

/**
 * Firestore instance — official source of truth for system data
 * (docs/12_seguranca_geral_do_app.md §4).
 *
 * NOTE: full offline persistence for Firestore on React Native is not covered
 * by the Firebase JS SDK (IndexedDB-only) and is registered as pending in
 * docs/08_log_de_evolucao.md. The default in-memory cache still serves reads
 * during a session, but durable offline-first (docs/02 §3.5) needs an
 * architecture decision (e.g. @react-native-firebase native SDK).
 */
export const db: Firestore = getFirestore(app);

export { app };
