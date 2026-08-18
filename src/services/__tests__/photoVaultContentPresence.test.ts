import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  values: new Map<string, string>(),
  getItem: vi.fn(async (key: string) => storage.values.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => {
    storage.values.set(key, value);
  }),
  removeItem: vi.fn(async (key: string) => {
    storage.values.delete(key);
  }),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: storage.getItem,
    setItem: storage.setItem,
    removeItem: storage.removeItem,
  },
}));

import {
  readPhotoVaultContentPresence,
  resetPhotoVaultContentPresenceForTesting,
  setPhotoVaultContentPresence,
  subscribeToPhotoVaultContentPresence,
} from '../photoVaultContentPresence';

const A = 'alice';
const B = 'bob';

beforeEach(() => {
  vi.clearAllMocks();
  storage.values.clear();
  resetPhotoVaultContentPresenceForTesting();
});

describe('uid-scoped persistence', () => {
  it('treats a missing cold-start value as false', async () => {
    await expect(readPhotoVaultContentPresence(A)).resolves.toBe(false);
  });

  it('persists exactly one literal boolean under the uid namespace', async () => {
    await setPhotoVaultContentPresence(A, true);

    expect(storage.setItem).toHaveBeenCalledWith(
      'ajfit-photo-vault-has-content-v1:alice',
      'true',
    );
    expect([...storage.values.values()]).toEqual(['true']);
  });

  it('isolates A from B and recovers A after a logout/login cycle', async () => {
    await setPhotoVaultContentPresence(A, true);
    await setPhotoVaultContentPresence(B, false);

    expect(await readPhotoVaultContentPresence(B)).toBe(false);
    // Logout removes neither namespace; signing A in again reads A's bit.
    expect(await readPhotoVaultContentPresence(A)).toBe(true);
    expect(storage.values.size).toBe(2);
  });

  it('encodes a uid instead of allowing it to alter the namespace shape', async () => {
    await setPhotoVaultContentPresence('tenant/user@example.com', true);

    expect([...storage.values.keys()]).toEqual([
      'ajfit-photo-vault-has-content-v1:tenant%2Fuser%40example.com',
    ]);
  });
});

describe('reconciliation and ordering', () => {
  it('supports false → true for the first confirmed photo', async () => {
    await setPhotoVaultContentPresence(A, false);
    await setPhotoVaultContentPresence(A, true);

    expect(await readPhotoVaultContentPresence(A)).toBe(true);
  });

  it('supports true → false after the confirmed last delete', async () => {
    await setPhotoVaultContentPresence(A, true);
    await setPhotoVaultContentPresence(A, false);

    expect(await readPhotoVaultContentPresence(A)).toBe(false);
  });

  it('serializes rapid writes so the last confirmed value wins', async () => {
    const first = setPhotoVaultContentPresence(A, true);
    const second = setPhotoVaultContentPresence(A, false);
    await Promise.all([first, second]);

    expect(await readPhotoVaultContentPresence(A)).toBe(false);
    expect(storage.setItem.mock.calls.map((call) => call[1])).toEqual([
      'true',
      'false',
    ]);
  });

  it('publishes the uid with the boolean and nothing from the gallery', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToPhotoVaultContentPresence(listener);

    await setPhotoVaultContentPresence(A, true);

    expect(listener).toHaveBeenCalledWith(A, true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('drops malformed storage instead of coercing it to true', async () => {
    const key = 'ajfit-photo-vault-has-content-v1:alice';
    storage.values.set(key, JSON.stringify({ count: 3 }));

    await expect(readPhotoVaultContentPresence(A)).resolves.toBe(false);
    expect(storage.removeItem).toHaveBeenCalledWith(key);
  });
});
