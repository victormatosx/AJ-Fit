import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { db } from '../lib/firebase';
import { logError } from '../lib/logger';
import {
  isNotificationPreferenceKey,
  resolveNotificationPreference,
  type NotificationPreferenceKey,
  type NotificationPreferences,
} from '../types/notificationPreferences';

type RemoteErrorKind = 'permanent' | 'recoverable';

interface PendingMutation {
  mutationId: string;
  key: NotificationPreferenceKey;
  value: boolean;
  previousValue: boolean;
  createdAt: number;
  attempts: number;
}

type PendingMutations = Partial<Record<NotificationPreferenceKey, PendingMutation>>;

let storageQueue: Promise<void> = Promise.resolve();
let mutationSequence = 0;
const remoteQueues = new Map<string, Promise<void>>();
const uidGenerations = new Map<string, number>();

function generation(uid: string): number {
  return uidGenerations.get(uid) ?? 0;
}

function cacheKey(uid: string): string {
  return `ajfit.notification-preferences.v2:${uid}`;
}

function pendingKey(uid: string): string {
  return `ajfit.notification-preferences.pending.v2:${uid}`;
}

function classifyRemoteError(error: unknown): RemoteErrorKind {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
  return ['permission-denied', 'invalid-argument', 'unauthenticated'].includes(code)
    ? 'permanent'
    : 'recoverable';
}

function parsePreferences(raw: string | null): NotificationPreferences {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([key, entry]) =>
        isNotificationPreferenceKey(key) && typeof entry === 'boolean',
      ),
    );
  } catch {
    return {};
  }
}

function parsePending(raw: string | null): PendingMutations {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([key, entry]) => {
        if (!isNotificationPreferenceKey(key) || typeof entry !== 'object' || entry === null) {
          return false;
        }
        const pending = entry as Record<string, unknown>;
        return pending.key === key &&
          typeof pending.mutationId === 'string' &&
          typeof pending.value === 'boolean' &&
          typeof pending.previousValue === 'boolean' &&
          typeof pending.createdAt === 'number' &&
          Number.isFinite(pending.createdAt) &&
          typeof pending.attempts === 'number' &&
          Number.isSafeInteger(pending.attempts);
      }),
    ) as PendingMutations;
  } catch {
    return {};
  }
}

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

async function updateRemote(uid: string, changes: NotificationPreferences): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    ...Object.fromEntries(Object.entries(changes).map(([key, value]) =>
      [`preferences.notificationPreferences.${key}`, value])),
    'metadata.updatedAt': serverTimestamp(),
  });
}

function enqueueRemote<T>(uid: string, operation: () => Promise<T>): Promise<T> {
  const previous = remoteQueues.get(uid) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(() => undefined, () => undefined);
  remoteQueues.set(uid, tail);
  void tail.then(() => {
    if (remoteQueues.get(uid) === tail) remoteQueues.delete(uid);
  });
  return result;
}

async function mutateLocal(
  uid: string,
  mutation: (
    preferences: NotificationPreferences,
    pending: PendingMutations,
  ) => { preferences: NotificationPreferences; pending: PendingMutations },
): Promise<{ preferences: NotificationPreferences; pending: PendingMutations }> {
  return withStorage(async () => {
    const [cachedRaw, pendingRaw] = await Promise.all([
      AsyncStorage.getItem(cacheKey(uid)),
      AsyncStorage.getItem(pendingKey(uid)),
    ]);
    const next = mutation(parsePreferences(cachedRaw), parsePending(pendingRaw));
    await Promise.all([
      AsyncStorage.setItem(cacheKey(uid), JSON.stringify(next.preferences)),
      AsyncStorage.setItem(pendingKey(uid), JSON.stringify(next.pending)),
    ]);
    return next;
  });
}

export async function readStoredNotificationPreferences(
  uid: string,
): Promise<NotificationPreferences> {
  return withStorage(async () =>
    parsePreferences(await AsyncStorage.getItem(cacheKey(uid))),
  );
}

// In-memory only (never persisted, never a source of truth) — a synchronous
// hint the Notification Settings screen uses to seed its very first render.
// Without it, that screen always starts from "unknown" and every switch
// visibly flips from the default-true fallback to the real value once
// AsyncStorage/Firestore resolve a render or two later. Warmed at app boot
// by `primeNotificationPreferencesCache` (called from
// `PushDeviceRegistrationRuntime`, well before the user can navigate in)
// and kept fresh by the screen's own Firestore listener, so a reopen within
// the same session is already correct on the first frame too.
const lastKnownPreferencesByUid = new Map<string, NotificationPreferences>();

export function getLastKnownNotificationPreferences(
  uid: string,
): NotificationPreferences | undefined {
  return lastKnownPreferencesByUid.get(uid);
}

export function recordLastKnownNotificationPreferences(
  uid: string,
  preferences: NotificationPreferences,
): void {
  lastKnownPreferencesByUid.set(uid, preferences);
}

export async function primeNotificationPreferencesCache(uid: string): Promise<void> {
  recordLastKnownNotificationPreferences(uid, await readStoredNotificationPreferences(uid));
}

export async function readPendingNotificationPreferences(uid: string): Promise<NotificationPreferences> {
  return withStorage(async () => Object.fromEntries(
    Object.entries(parsePending(await AsyncStorage.getItem(pendingKey(uid))))
      .map(([key, mutation]) => [key, mutation.value]),
  ));
}

export type NotificationPreferenceRemoteSyncOutcome =
  | { status: 'synced' }
  | { status: 'pending'; reason: 'recoverable' }
  | { status: 'rolled-back'; reason: 'permanent' }
  | { status: 'superseded' };

export interface ChangeNotificationPreferenceResult {
  preferences: NotificationPreferences;
  remote: Promise<NotificationPreferenceRemoteSyncOutcome>;
}

export async function changeNotificationPreferenceForUser(args: {
  uid: string;
  current: NotificationPreferences | undefined;
  key: NotificationPreferenceKey;
  next: boolean;
}): Promise<ChangeNotificationPreferenceResult> {
  return changeNotificationPreferencesForUser({
    uid: args.uid, current: args.current, changes: { [args.key]: args.next },
  });
}

/** One local transaction and one Firestore update for a master-switch action. */
export async function changeNotificationPreferencesForUser(args: {
  uid: string;
  current: NotificationPreferences | undefined;
  changes: NotificationPreferences;
}): Promise<ChangeNotificationPreferenceResult> {
  const entries = Object.entries(args.changes) as [NotificationPreferenceKey, boolean][];
  if (entries.length === 0 || entries.some(([key, value]) =>
    !isNotificationPreferenceKey(key) || typeof value !== 'boolean')) {
    throw new Error('invalid_notification_preference_changes');
  }
  const mutationId = `${Date.now()}:${++mutationSequence}`;
  const mutationGeneration = generation(args.uid);
  const local = await mutateLocal(args.uid, (cached, pending) => {
    const base = { ...cached, ...args.current };
    for (const [key, mutation] of Object.entries(pending) as [NotificationPreferenceKey, PendingMutation][]) {
      if (mutation) base[key] = mutation.value;
    }
    return {
      preferences: { ...base, ...args.changes },
      pending: entries.reduce<PendingMutations>((nextPending, [key, value]) => {
        nextPending[key] = {
          mutationId,
          key,
          value,
          previousValue: resolveNotificationPreference(base, key),
          createdAt: Date.now(),
          attempts: 1,
        };
        return nextPending;
      }, { ...pending }),
    };
  });

  const remote = enqueueRemote(args.uid, async (): Promise<NotificationPreferenceRemoteSyncOutcome> => {
    if (generation(args.uid) !== mutationGeneration) return { status: 'superseded' };
    try {
      await updateRemote(args.uid, args.changes);
      if (generation(args.uid) !== mutationGeneration) return { status: 'superseded' };
      const result = await mutateLocal(args.uid, (preferences, pending) => {
        const nextPending = { ...pending };
        for (const [key] of entries) {
          if (nextPending[key]?.mutationId === mutationId) delete nextPending[key];
        }
        return { preferences, pending: nextPending };
      });
      return entries.some(([key]) => result.pending[key]?.mutationId !== undefined)
        ? { status: 'superseded' } : { status: 'synced' };
    } catch (error) {
      if (generation(args.uid) !== mutationGeneration) return { status: 'superseded' };
      if (classifyRemoteError(error) === 'recoverable') {
        logError('notificationPreferences:remote_pending', error, {
          uid: args.uid,
          preferences: entries.map(([key]) => key),
        });
        return { status: 'pending', reason: 'recoverable' };
      }

      let rolledBack = false;
      await mutateLocal(args.uid, (preferences, pending) => {
        const nextPending = { ...pending };
        const nextPreferences = { ...preferences };
        for (const [key] of entries) {
          const mutation = nextPending[key];
          if (mutation?.mutationId !== mutationId) continue;
          rolledBack = true;
          nextPreferences[key] = mutation.previousValue;
          delete nextPending[key];
        }
        return {
          preferences: nextPreferences,
          pending: nextPending,
        };
      });
      logError('notificationPreferences:remote_rollback', error, {
        uid: args.uid,
        preferences: entries.map(([key]) => key),
      });
      return rolledBack
        ? { status: 'rolled-back', reason: 'permanent' }
        : { status: 'superseded' };
    }
  });

  return { preferences: local.preferences, remote };
}

export async function reconcilePendingNotificationPreferences(uid: string): Promise<void> {
  const reconciliationGeneration = generation(uid);
  await enqueueRemote(uid, async () => {
    if (generation(uid) !== reconciliationGeneration) return;
    const pending = await withStorage(async () =>
      parsePending(await AsyncStorage.getItem(pendingKey(uid))),
    );
    const groups = new Map<string, PendingMutation[]>();
    for (const mutation of Object.values(pending)) {
      if (!mutation) continue;
      groups.set(mutation.mutationId, [...(groups.get(mutation.mutationId) ?? []), mutation]);
    }
    for (const mutations of groups.values()) {
      if (generation(uid) !== reconciliationGeneration) return;
      const changes = Object.fromEntries(mutations.map((mutation) =>
        [mutation.key, mutation.value])) as NotificationPreferences;
    try {
      await updateRemote(uid, changes);
      if (generation(uid) !== reconciliationGeneration) return;
      await mutateLocal(uid, (preferences, latest) => {
        const next = { ...latest };
        for (const mutation of mutations) {
          if (next[mutation.key]?.mutationId === mutation.mutationId) delete next[mutation.key];
        }
        return { preferences, pending: next };
      });
    } catch (error) {
      if (generation(uid) !== reconciliationGeneration) return;
      if (classifyRemoteError(error) === 'permanent') {
        await mutateLocal(uid, (preferences, latest) => {
          const next = { ...latest };
          const rolledBack = { ...preferences };
          for (const mutation of mutations) {
            if (next[mutation.key]?.mutationId !== mutation.mutationId) continue;
            rolledBack[mutation.key] = mutation.previousValue;
            delete next[mutation.key];
          }
          return {
            preferences: rolledBack,
            pending: next,
          };
        });
      } else {
        await mutateLocal(uid, (preferences, latest) => ({
          preferences,
          pending: mutations.reduce<PendingMutations>((next, mutation) => {
            if (next[mutation.key]?.mutationId === mutation.mutationId) {
              next[mutation.key] = { ...mutation, attempts: mutation.attempts + 1 };
            }
            return next;
          }, { ...latest }),
        }));
      }
      logError('notificationPreferences:reconcile', error, {
        uid,
        preferences: mutations.map((mutation) => mutation.key),
      });
    }
    }
  });
}

export async function clearNotificationPreferenceState(uid: string): Promise<void> {
  uidGenerations.set(uid, generation(uid) + 1);
  lastKnownPreferencesByUid.delete(uid);
  await withStorage(async () => {
    await Promise.all([
      AsyncStorage.removeItem(cacheKey(uid)),
      AsyncStorage.removeItem(pendingKey(uid)),
    ]);
  }).catch((error) => {
    logError('notificationPreferences:clear', error, { uid });
  });
}
