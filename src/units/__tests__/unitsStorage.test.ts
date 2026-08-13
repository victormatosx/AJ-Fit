import { beforeEach, describe, expect, it, vi } from 'vitest';

const localStore = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => localStore.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      localStore.set(key, value);
    }),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  readStoredUnitsPreference,
  subscribeStoredUnitsPreference,
  UNITS_PREFERENCE_STORAGE_KEY,
  writeStoredUnitsPreference,
} from '../unitsStorage';

beforeEach(() => {
  localStore.clear();
  vi.clearAllMocks();
});

describe('unitsStorage', () => {
  it.each(['system', 'metric', 'imperial'] as const)(
    'persists and reads %s',
    async (preference) => {
      await writeStoredUnitsPreference(preference);

      await expect(readStoredUnitsPreference()).resolves.toBe(preference);
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        UNITS_PREFERENCE_STORAGE_KEY,
        preference,
      );
    },
  );

  it('returns null when no preference is stored', async () => {
    await expect(readStoredUnitsPreference()).resolves.toBeNull();
  });

  it('ignores a corrupted stored value', async () => {
    localStore.set(UNITS_PREFERENCE_STORAGE_KEY, 'unknown');
    await expect(readStoredUnitsPreference()).resolves.toBeNull();
  });

  it('returns null when storage cannot be read', async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('offline'));
    await expect(readStoredUnitsPreference()).resolves.toBeNull();
  });

  it('rejects an invalid preference before writing', async () => {
    await expect(
      writeStoredUnitsPreference('invalid' as never),
    ).rejects.toThrow(/refuse to persist invalid preference/);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('notifies mounted consumers after local preference changes', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeStoredUnitsPreference(listener);

    await writeStoredUnitsPreference('imperial');
    expect(listener).toHaveBeenCalledWith('imperial');

    unsubscribe();
    await writeStoredUnitsPreference('metric');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
