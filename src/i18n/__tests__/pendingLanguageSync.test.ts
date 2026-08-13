import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  readPendingLanguageSync,
  writePendingLanguageSync,
  clearPendingLanguageSync,
  PENDING_LANGUAGE_STORAGE_KEY,
  type PendingLanguageSync,
} from '../pendingLanguageSync';

const mockGetItem = vi.mocked(AsyncStorage.getItem);
const mockSetItem = vi.mocked(AsyncStorage.setItem);
const mockRemoveItem = vi.mocked(AsyncStorage.removeItem);

const VALID: PendingLanguageSync = {
  uid: 'alice',
  value: 'en',
  createdAt: 1_722_000_000_000,
  attempts: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readPendingLanguageSync', () => {
  it('returns null when nothing is stored', async () => {
    mockGetItem.mockResolvedValueOnce(null);
    await expect(readPendingLanguageSync()).resolves.toBeNull();
    expect(mockGetItem).toHaveBeenCalledWith(PENDING_LANGUAGE_STORAGE_KEY);
  });

  it('returns the record when valid', async () => {
    mockGetItem.mockResolvedValueOnce(JSON.stringify(VALID));
    await expect(readPendingLanguageSync()).resolves.toEqual(VALID);
  });

  it('returns null and clears the key when JSON is corrupted', async () => {
    mockGetItem.mockResolvedValueOnce('{ not json');
    mockRemoveItem.mockResolvedValueOnce(undefined);
    await expect(readPendingLanguageSync()).resolves.toBeNull();
    expect(mockRemoveItem).toHaveBeenCalledWith(PENDING_LANGUAGE_STORAGE_KEY);
  });

  it.each([
    ['missing uid', { value: 'en', createdAt: 1, attempts: 0 }],
    ['empty uid', { uid: '', value: 'en', createdAt: 1, attempts: 0 }],
    ['unsupported language', { uid: 'x', value: 'fr', createdAt: 1, attempts: 0 }],
    ['non-integer attempts', { uid: 'x', value: 'en', createdAt: 1, attempts: 1.5 }],
    ['negative attempts', { uid: 'x', value: 'en', createdAt: 1, attempts: -1 }],
    ['non-finite createdAt', { uid: 'x', value: 'en', createdAt: NaN, attempts: 0 }],
    ['non-string uid', { uid: 42, value: 'en', createdAt: 1, attempts: 0 }],
  ])('returns null and clears the key for invalid shape: %s', async (_label, payload) => {
    mockGetItem.mockResolvedValueOnce(JSON.stringify(payload));
    mockRemoveItem.mockResolvedValueOnce(undefined);
    await expect(readPendingLanguageSync()).resolves.toBeNull();
    expect(mockRemoveItem).toHaveBeenCalledWith(PENDING_LANGUAGE_STORAGE_KEY);
  });

  it('returns null (never throws) when AsyncStorage read fails', async () => {
    mockGetItem.mockRejectedValueOnce(new Error('storage offline'));
    await expect(readPendingLanguageSync()).resolves.toBeNull();
    expect(mockRemoveItem).not.toHaveBeenCalled();
  });
});

describe('writePendingLanguageSync', () => {
  it('persists a valid record as JSON', async () => {
    mockSetItem.mockResolvedValueOnce(undefined);
    await writePendingLanguageSync(VALID);
    expect(mockSetItem).toHaveBeenCalledWith(
      PENDING_LANGUAGE_STORAGE_KEY,
      JSON.stringify(VALID),
    );
  });

  it('refuses to persist a record failing the shape guard', async () => {
    // Belt-and-suspenders: TS keeps unions out, this catches dynamic paths
    // (future remote-sync code casting through `unknown`).
    await expect(
      writePendingLanguageSync({
        ...VALID,
        value: 'fr' as unknown as PendingLanguageSync['value'],
      }),
    ).rejects.toThrow(/refuse to persist invalid record/);
    expect(mockSetItem).not.toHaveBeenCalled();
  });
});

describe('clearPendingLanguageSync', () => {
  it('removes the key', async () => {
    mockRemoveItem.mockResolvedValueOnce(undefined);
    await clearPendingLanguageSync();
    expect(mockRemoveItem).toHaveBeenCalledWith(PENDING_LANGUAGE_STORAGE_KEY);
  });

  it('never throws (best-effort cleanup) even if removeItem rejects', async () => {
    mockRemoveItem.mockRejectedValueOnce(new Error('boom'));
    await expect(clearPendingLanguageSync()).resolves.toBeUndefined();
  });
});
