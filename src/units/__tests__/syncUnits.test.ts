import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  },
}));

vi.mock('../../lib/firebase', () => ({ db: { __brand: 'mock-db' } }));
vi.mock('../../lib/logError', () => ({ logError: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, collection: string, id: string) => ({
    path: `${collection}/${id}`,
  })),
  updateDoc: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __sentinel: 'serverTimestamp' })),
}));

import { updateDoc } from 'firebase/firestore';
import {
  PENDING_UNITS_STORAGE_KEY,
  type PendingUnitsSync,
} from '../pendingUnitsSync';
import { changeUnitsForUser, reconcileUnitsOnLoad } from '../syncUnits';
import { UNITS_PREFERENCE_STORAGE_KEY } from '../unitsStorage';

const mockUpdateDoc = vi.mocked(updateDoc);

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('changeUnitsForUser', () => {
  it('persists locally and updates only units plus updatedAt by dot notation', async () => {
    store.set(UNITS_PREFERENCE_STORAGE_KEY, 'system');
    mockUpdateDoc.mockResolvedValueOnce(undefined);

    const result = await changeUnitsForUser({ uid: 'alice', next: 'imperial' });
    await expect(result.remote).resolves.toEqual({ status: 'synced' });

    expect(store.get(UNITS_PREFERENCE_STORAGE_KEY)).toBe('imperial');
    expect(store.has(PENDING_UNITS_STORAGE_KEY)).toBe(false);
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { path: 'users/alice' },
      {
        'preferences.units': 'imperial',
        'metadata.updatedAt': { __sentinel: 'serverTimestamp' },
      },
    );
    const [, payload] = mockUpdateDoc.mock.calls[0]!;
    expect(payload).not.toHaveProperty('preferences');
    expect(payload).not.toHaveProperty('preferences.language');
    expect(payload).not.toHaveProperty('preferences.theme');
  });

  it('keeps the local value and pending record while offline', async () => {
    mockUpdateDoc.mockReturnValue(new Promise<void>(() => {}));

    const result = await changeUnitsForUser({ uid: 'alice', next: 'metric' });

    expect(store.get(UNITS_PREFERENCE_STORAGE_KEY)).toBe('metric');
    expect(JSON.parse(store.get(PENDING_UNITS_STORAGE_KEY)!)).toMatchObject({
      uid: 'alice',
      value: 'metric',
      attempts: 1,
    });
    expect(await Promise.race([
      result.remote,
      new Promise((resolve) => setTimeout(() => resolve('pending'), 20)),
    ])).toBe('pending');
  });

  it('rejects invalid values before local or remote writes', async () => {
    await expect(
      changeUnitsForUser({ uid: 'alice', next: 'uk' as never }),
    ).rejects.toThrow(/not a valid units preference/);
    expect(store.size).toBe(0);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

describe('reconcileUnitsOnLoad', () => {
  it('makes a valid remote preference authoritative on login', async () => {
    store.set(UNITS_PREFERENCE_STORAGE_KEY, 'metric');

    const result = await reconcileUnitsOnLoad({
      uid: 'alice',
      remoteUnits: 'imperial',
    });

    expect(result).toEqual({
      applied: 'remote-value',
      preference: 'imperial',
    });
    expect(store.get(UNITS_PREFERENCE_STORAGE_KEY)).toBe('imperial');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it.each([null, undefined, 'legacy-invalid'])(
    'uses system when the remote preference is absent or invalid: %s',
    async (remoteUnits) => {
      store.set(UNITS_PREFERENCE_STORAGE_KEY, 'imperial');
      const result = await reconcileUnitsOnLoad({ uid: 'alice', remoteUnits });
      expect(result).toEqual({
        applied: 'system-default',
        preference: 'system',
      });
      expect(store.get(UNITS_PREFERENCE_STORAGE_KEY)).toBe('system');
    },
  );

  it('retains a same-account pending value and retries it in background', async () => {
    const pending: PendingUnitsSync = {
      uid: 'alice',
      value: 'metric',
      createdAt: 1,
      attempts: 1,
    };
    store.set(PENDING_UNITS_STORAGE_KEY, JSON.stringify(pending));
    mockUpdateDoc.mockResolvedValueOnce(undefined);

    const result = await reconcileUnitsOnLoad({
      uid: 'alice',
      remoteUnits: 'imperial',
    });

    expect(result.applied).toBe('pending-value');
    expect(result.preference).toBe('metric');
    expect(store.get(UNITS_PREFERENCE_STORAGE_KEY)).toBe('metric');
    await expect(result.remote).resolves.toEqual({ status: 'synced' });
  });

  it("drops another account's pending value and applies the current account remote", async () => {
    const foreignPending: PendingUnitsSync = {
      uid: 'alice',
      value: 'metric',
      createdAt: 1,
      attempts: 2,
    };
    store.set(PENDING_UNITS_STORAGE_KEY, JSON.stringify(foreignPending));

    const result = await reconcileUnitsOnLoad({
      uid: 'bob',
      remoteUnits: 'imperial',
    });

    expect(result).toEqual({
      applied: 'remote-value',
      preference: 'imperial',
    });
    expect(store.has(PENDING_UNITS_STORAGE_KEY)).toBe(false);
    expect(store.get(UNITS_PREFERENCE_STORAGE_KEY)).toBe('imperial');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});
