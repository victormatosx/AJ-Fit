/**
 * Persistence for the user's health-integration *intent* — Fase 1.
 *
 * Deliberately local-only (`AsyncStorage`, scoped per uid): no screen reads
 * this across devices yet, and `firestore.rules` would need a new allow-listed
 * field under `preferences` to accept a remote write (`preferences` currently
 * only allows `language`, `units`, `notificationPreferences` —
 * see `firestore.rules` around the `isVerifiedOwner` update rule). Adding
 * that is explicitly out of scope until a real UI (Fase 2) needs the value to
 * survive a reinstall or sync across devices. Until then:
 *
 * - **Stored locally**: the user's choice — `'not_configured' | 'enabled' | 'disabled'`.
 * - **Never stored anywhere**: any health sample (weight value, workout data),
 *   and no OS-reported authorization/grant snapshot (`healthIntegration.ts`
 *   queries those live, every time — they are not cached as fact).
 *
 * Logout/account-switch handling is intentionally asymmetric from
 * `notificationPreferences.ts`: that module's local cache is disposable
 * because Firestore is its real source of truth, so wiping it on logout is
 * safe — the next sign-in re-hydrates from the server. This module has no
 * server copy, so `clearHealthIntegrationSessionState` below only forgets the
 * **in-memory** hint; the persisted `AsyncStorage` value survives, so the
 * same uid finds its previous choice intact on its next sign-in.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { HealthConnectionIntent } from '../types/healthIntegration';

const DEFAULT_INTENT: HealthConnectionIntent = 'not_configured';

function cacheKey(uid: string): string {
  return `ajfit.health-integration.intent.v1:${uid}`;
}

function parseIntent(raw: string | null): HealthConnectionIntent {
  return raw === 'enabled' || raw === 'disabled' || raw === 'not_configured' ? raw : DEFAULT_INTENT;
}

// Single global FIFO queue serializing every AsyncStorage read/write this
// module performs, so two calls — for the same uid or different ones — never
// race on the underlying storage. Same primitive as `notificationPreferences.ts`.
let storageQueue: Promise<void> = Promise.resolve();

function withStorage<T>(operation: () => Promise<T>): Promise<T> {
  let resolveResult: (value: T) => void;
  let rejectResult: (cause: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  storageQueue = storageQueue.catch(() => undefined).then(async () => {
    try {
      resolveResult(await operation());
    } catch (cause) {
      rejectResult(cause);
    }
  });
  return result;
}

// In-memory only — lets a hook render the right value on its very first
// frame instead of starting from "not_configured" and popping once
// AsyncStorage resolves. Never a source of truth by itself, and never the
// only thing standing between one account's choice and another's: every read
// is already scoped by uid, so a stale entry for a logged-out uid can never
// surface as a different uid's answer. It is still cleared on logout
// (`clearHealthIntegrationSessionState`) purely so this map doesn't keep
// growing for every account that ever touched this device.
const lastKnownByUid = new Map<string, HealthConnectionIntent>();
const listenersByUid = new Map<string, Set<(intent: HealthConnectionIntent) => void>>();

export function subscribeToHealthIntegrationIntent(
  uid: string,
  listener: (intent: HealthConnectionIntent) => void,
): () => void {
  const listeners = listenersByUid.get(uid) ?? new Set();
  listeners.add(listener);
  listenersByUid.set(uid, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByUid.delete(uid);
  };
}

export function getLastKnownHealthIntegrationIntent(uid: string): HealthConnectionIntent | undefined {
  return lastKnownByUid.get(uid);
}

export async function readHealthIntegrationIntent(uid: string): Promise<HealthConnectionIntent> {
  const intent = await withStorage(async () => parseIntent(await AsyncStorage.getItem(cacheKey(uid))));
  lastKnownByUid.set(uid, intent);
  return intent;
}

/**
 * Persists the user's choice. A write started right before logout is allowed
 * to complete normally — it reflects a real decision the user made while
 * authenticated, and is exactly the value `preserve the previous account's
 * preference` means to keep around for their next sign-in. Two concurrent
 * writes for the same uid are serialized by `withStorage`'s FIFO queue, so
 * the result is always one of the two values, never a corrupted mix.
 */
export async function setHealthIntegrationIntent(
  uid: string,
  intent: HealthConnectionIntent,
): Promise<HealthConnectionIntent> {
  await withStorage(async () => {
    await AsyncStorage.setItem(cacheKey(uid), intent);
  });
  lastKnownByUid.set(uid, intent);
  listenersByUid.get(uid)?.forEach((listener) => listener(intent));
  return intent;
}

/**
 * Call on logout (see `signOutUser` in `services/auth.ts`, right next to the
 * equivalent notification-preferences cleanup). Forgets this uid's in-memory
 * hint only — the persisted `AsyncStorage` value is left untouched on
 * purpose, so this same uid finds its previous choice intact the next time
 * it signs in. Synchronous: it is a pure in-memory operation, nothing to await.
 */
export function clearHealthIntegrationSessionState(uid: string): void {
  lastKnownByUid.delete(uid);
  listenersByUid.delete(uid);
}
