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
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import {
  assertFullyIsolated,
  connectAjFitEmulators,
  emulatorPlan,
} from './firebaseEmulator';
import { initializeFirebaseAppCheck } from './firebaseAppCheck';
import { secureAuthStorage } from './secureAuthStorage';
import { logError } from './logger';

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

// App Check is attached to this exact JS app before product instances are
// created. It remains optional in Expo Go/web, where the local native module
// is intentionally unavailable; enforcement stays disabled until both mobile
// providers have passed real-device validation.
export const appCheck = initializeFirebaseAppCheck(app);

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

  // On native, persist the session in AsyncStorage (via secureAuthStorage,
  // which encrypts every value with AES-256-GCM — see
  // docs/12_seguranca_geral_do_app.md §16) so users stay logged in.
  // initializeAuth throws if auth was already initialized (Fast Refresh);
  // fall back to the existing instance in that case.
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(secureAuthStorage),
    });
  } catch (err) {
    // Expected on Fast Refresh (auth already initialized). Logged because the
    // fallback `getAuth(app)` below does NOT persist sessions across
    // restarts — if this fires on a cold start, persistence silently breaks.
    logError('firebase:initializeAuth-fallback', err);
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
export const storage: FirebaseStorage = getStorage(app);

/**
 * HOMOLOGATION MODE — development only, opt-in, all-or-nothing.
 *
 * `__DEV__` is inlined as the literal `false` by Metro for production
 * bundles, so this entire block — and `./firebaseEmulator` with it — is dead
 * code that never ships in a Release/TestFlight/App Store build. Absent
 * `EXPO_PUBLIC_AJFIT_EMULATOR_HOST` the plan is `null` and nothing is
 * touched: the default stays the real project.
 *
 * Functions is redirected through `getFunctions(app, 'us-central1')` rather
 * than by importing `./firebaseFunctions`: the SDK caches one instance per
 * (app, region), so this IS the object that module exports, and wiring it
 * here guarantees the redirect even if no code path imports that module
 * first. The other order would leave a window where Firestore is already
 * isolated while a callable still reaches production.
 *
 * Any failure throws on purpose (`assertFullyIsolated`). A half-connected app
 * is the single outcome that could touch real data, so it must be
 * unreachable rather than merely unlikely.
 */
if (__DEV__) {
  const plan = emulatorPlan(process.env as Record<string, string | undefined>);
  if (plan) {
    connectAjFitEmulators(plan, { auth, db, functions: getFunctions(app, 'us-central1') });
    assertFullyIsolated();
    // eslint-disable-next-line no-console
    console.warn(
      `[AJ Fit] MODO HOMOLOGACAO: Auth, Firestore e Functions no Emulator ${plan.host}. ` +
        'Nenhum dado de producao e lido ou escrito.',
    );
  }
}

export { app };
