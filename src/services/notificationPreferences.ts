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

async function updateRemote(
  uid: string,
  key: NotificationPreferenceKey,
  value: boolean,
): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    [`preferences.notificationPreferences.${key}`]: value,
    'metadata.updatedAt': serverTimestamp(),
  });
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
  const mutationId = `${Date.now()}:${++mutationSequence}`;
  const previousValue = resolveNotificationPreference(args.current, args.key);
  const local = await mutateLocal(args.uid, (cached, pending) => {
    const base = { ...args.current, ...cached };
    return {
      preferences: { ...base, [args.key]: args.next },
      pending: {
        ...pending,
        [args.key]: {
          mutationId,
          key: args.key,
          value: args.next,
          previousValue,
          createdAt: Date.now(),
          attempts: 1,
        },
      },
    };
  });

  const remote = (async (): Promise<NotificationPreferenceRemoteSyncOutcome> => {
    try {
      await updateRemote(args.uid, args.key, args.next);
      const result = await mutateLocal(args.uid, (preferences, pending) => {
        if (pending[args.key]?.mutationId !== mutationId) {
          return { preferences, pending };
        }
        const nextPending = { ...pending };
        delete nextPending[args.key];
        return { preferences, pending: nextPending };
      });
      return result.pending[args.key]
        ? { status: 'superseded' }
        : { status: 'synced' };
    } catch (error) {
      if (classifyRemoteError(error) === 'recoverable') {
        logError('notificationPreferences:remote_pending', error, {
          uid: args.uid,
          preference: args.key,
        });
        return { status: 'pending', reason: 'recoverable' };
      }

      let rolledBack = false;
      await mutateLocal(args.uid, (preferences, pending) => {
        if (pending[args.key]?.mutationId !== mutationId) {
          return { preferences, pending };
        }
        rolledBack = true;
        const nextPending = { ...pending };
        delete nextPending[args.key];
        return {
          preferences: { ...preferences, [args.key]: previousValue },
          pending: nextPending,
        };
      });
      logError('notificationPreferences:remote_rollback', error, {
        uid: args.uid,
        preference: args.key,
      });
      return rolledBack
        ? { status: 'rolled-back', reason: 'permanent' }
        : { status: 'superseded' };
    }
  })();

  return { preferences: local.preferences, remote };
}

export async function reconcilePendingNotificationPreferences(uid: string): Promise<void> {
  const pending = await withStorage(async () =>
    parsePending(await AsyncStorage.getItem(pendingKey(uid))),
  );
  await Promise.all(Object.values(pending).filter(
    (value): value is PendingMutation => value !== undefined,
  ).map(async (mutation) => {
    try {
      await updateRemote(uid, mutation.key, mutation.value);
      await mutateLocal(uid, (preferences, latest) => {
        if (latest[mutation.key]?.mutationId !== mutation.mutationId) {
          return { preferences, pending: latest };
        }
        const next = { ...latest };
        delete next[mutation.key];
        return { preferences, pending: next };
      });
    } catch (error) {
      if (classifyRemoteError(error) === 'permanent') {
        await mutateLocal(uid, (preferences, latest) => {
          if (latest[mutation.key]?.mutationId !== mutation.mutationId) {
            return { preferences, pending: latest };
          }
          const next = { ...latest };
          delete next[mutation.key];
          return {
            preferences: {
              ...preferences,
              [mutation.key]: mutation.previousValue,
            },
            pending: next,
          };
        });
      } else {
        await mutateLocal(uid, (preferences, latest) => ({
          preferences,
          pending: latest[mutation.key]?.mutationId === mutation.mutationId
            ? {
                ...latest,
                [mutation.key]: {
                  ...mutation,
                  attempts: mutation.attempts + 1,
                },
              }
            : latest,
        }));
      }
      logError('notificationPreferences:reconcile', error, {
        uid,
        preference: mutation.key,
      });
    }
  }));
}

export async function clearNotificationPreferenceState(uid: string): Promise<void> {
  await withStorage(async () => {
    await Promise.all([
      AsyncStorage.removeItem(cacheKey(uid)),
      AsyncStorage.removeItem(pendingKey(uid)),
    ]);
  }).catch((error) => {
    logError('notificationPreferences:clear', error, { uid });
  });
}
