import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const storage = new Map<string, string>();
  return {
    storage,
    updateDoc: vi.fn(async (_reference: unknown, _data: unknown): Promise<void> => {}),
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => mocks.storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { mocks.storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { mocks.storage.delete(key); }),
  },
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ path: 'users/uid' })),
  updateDoc: mocks.updateDoc,
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../lib/logger', () => ({ logError: vi.fn() }));

import {
  changeNotificationPreferenceForUser,
  changeNotificationPreferencesForUser,
  clearNotificationPreferenceState,
  readStoredNotificationPreferences,
  reconcilePendingNotificationPreferences,
} from '../notificationPreferences';

describe('notification preference client state', () => {
  beforeEach(() => {
    mocks.storage.clear();
    mocks.updateDoc.mockReset();
    mocks.updateDoc.mockResolvedValue(undefined);
  });

  it('preserves two simultaneous field updates independently', async () => {
    const [workouts, progress] = await Promise.all([
      changeNotificationPreferenceForUser({
        uid: 'uid-A',
        current: {},
        key: 'workoutsAndReminders',
        next: false,
      }),
      changeNotificationPreferenceForUser({
        uid: 'uid-A',
        current: {},
        key: 'progress',
        next: false,
      }),
    ]);
    await Promise.all([workouts.remote, progress.remote]);

    await expect(readStoredNotificationPreferences('uid-A')).resolves.toMatchObject({
      workoutsAndReminders: false,
      progress: false,
    });
  });

  it('persists all five categories in one Firestore update', async () => {
    const result = await changeNotificationPreferencesForUser({
      uid: 'uid-A', current: {}, changes: {
        workoutsAndReminders: false, evolutionAndAchievements: false,
        progress: false, subscription: false, support: false,
      },
    });
    await result.remote;
    expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
    expect(mocks.updateDoc.mock.calls[0]?.[1]).toMatchObject({
      'preferences.notificationPreferences.workoutsAndReminders': false,
      'preferences.notificationPreferences.evolutionAndAchievements': false,
      'preferences.notificationPreferences.progress': false,
      'preferences.notificationPreferences.subscription': false,
      'preferences.notificationPreferences.support': false,
    });
    expect(await readStoredNotificationPreferences('uid-A')).toEqual({
      workoutsAndReminders: false, evolutionAndAchievements: false,
      progress: false, subscription: false, support: false,
    });
  });

  it('returns optimistic local state without waiting for an offline Firestore promise', async () => {
    let release!: () => void;
    mocks.updateDoc.mockImplementationOnce(() =>
      new Promise<void>((resolve) => { release = resolve; }),
    );

    const result = await changeNotificationPreferenceForUser({
      uid: 'uid-A',
      current: { progress: true },
      key: 'progress',
      next: false,
    });

    expect(result.preferences.progress).toBe(false);
    expect(await readStoredNotificationPreferences('uid-A')).toMatchObject({ progress: false });
    release();
    await expect(result.remote).resolves.toEqual({ status: 'synced' });
  });

  it('rolls back only the field whose latest mutation failed permanently', async () => {
    mocks.updateDoc.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { code: 'permission-denied' }),
    );
    const result = await changeNotificationPreferenceForUser({
      uid: 'uid-A',
      current: { progress: true, workoutsAndReminders: false },
      key: 'progress',
      next: false,
    });

    await expect(result.remote).resolves.toEqual({
      status: 'rolled-back',
      reason: 'permanent',
    });
    await expect(readStoredNotificationPreferences('uid-A')).resolves.toEqual({
      progress: true,
      workoutsAndReminders: false,
    });
  });

  it('does not let an older remote completion clear a newer mutation', async () => {
    let resolveFirst!: () => void;
    mocks.updateDoc
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(undefined);

    const first = await changeNotificationPreferenceForUser({
      uid: 'uid-A',
      current: { progress: true },
      key: 'progress',
      next: false,
    });
    const second = await changeNotificationPreferenceForUser({
      uid: 'uid-A',
      current: { progress: false },
      key: 'progress',
      next: true,
    });
    resolveFirst();
    await expect(first.remote).resolves.toEqual({ status: 'superseded' });
    await expect(second.remote).resolves.toEqual({ status: 'synced' });
    await expect(readStoredNotificationPreferences('uid-A')).resolves.toMatchObject({
      progress: true,
    });
  });

  it('serializes rapid same-key writes so a delayed older write cannot win', async () => {
    let resolveFirst!: () => void;
    mocks.updateDoc.mockImplementationOnce(() =>
      new Promise<void>((resolve) => { resolveFirst = resolve; }));
    const first = await changeNotificationPreferenceForUser({
      uid: 'uid-A', current: {}, key: 'support', next: false,
    });
    const second = await changeNotificationPreferenceForUser({
      uid: 'uid-A', current: { support: false }, key: 'support', next: true,
    });
    expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
    resolveFirst();
    await Promise.all([first.remote, second.remote]);
    expect(mocks.updateDoc).toHaveBeenCalledTimes(2);
    expect(mocks.updateDoc.mock.calls[1]?.[1]).toMatchObject({
      'preferences.notificationPreferences.support': true,
    });
    expect(await readStoredNotificationPreferences('uid-A')).toMatchObject({ support: true });
  });

  it('keeps cache isolated per UID and clears it on logout/account switch', async () => {
    const a = await changeNotificationPreferenceForUser({
      uid: 'uid-A',
      current: {},
      key: 'progress',
      next: false,
    });
    const b = await changeNotificationPreferenceForUser({
      uid: 'uid-B',
      current: {},
      key: 'progress',
      next: true,
    });
    await Promise.all([a.remote, b.remote]);

    await clearNotificationPreferenceState('uid-A');
    await expect(readStoredNotificationPreferences('uid-A')).resolves.toEqual({});
    await expect(readStoredNotificationPreferences('uid-B')).resolves.toMatchObject({
      progress: true,
    });
  });

  it('does not restore a cleared account cache when an old request finishes late', async () => {
    let resolveOld!: () => void;
    mocks.updateDoc.mockImplementationOnce(() =>
      new Promise<void>((resolve) => { resolveOld = resolve; }));
    const old = await changeNotificationPreferenceForUser({
      uid: 'uid-A', current: {}, key: 'subscription', next: false,
    });
    await clearNotificationPreferenceState('uid-A');
    resolveOld();
    await old.remote;
    expect(await readStoredNotificationPreferences('uid-A')).toEqual({});
  });

  it('retries each offline field independently', async () => {
    mocks.updateDoc.mockRejectedValue(
      Object.assign(new Error('offline'), { code: 'unavailable' }),
    );
    const a = await changeNotificationPreferenceForUser({
      uid: 'uid-A',
      current: {},
      key: 'progress',
      next: false,
    });
    const b = await changeNotificationPreferenceForUser({
      uid: 'uid-A',
      current: {},
      key: 'workoutsAndReminders',
      next: false,
    });
    await Promise.all([a.remote, b.remote]);

    mocks.updateDoc.mockReset();
    mocks.updateDoc.mockResolvedValue(undefined);
    await reconcilePendingNotificationPreferences('uid-A');
    expect(mocks.updateDoc).toHaveBeenCalledTimes(2);
  });
});
