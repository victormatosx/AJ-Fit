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
  readStoredLanguage,
  writeStoredLanguage,
  LANGUAGE_STORAGE_KEY,
} from '../languageStorage';

const mockGetItem = vi.mocked(AsyncStorage.getItem);
const mockSetItem = vi.mocked(AsyncStorage.setItem);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readStoredLanguage', () => {
  it('returns a valid supported language when present', async () => {
    mockGetItem.mockResolvedValueOnce('pt-BR');
    await expect(readStoredLanguage()).resolves.toBe('pt-BR');
    expect(mockGetItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY);
  });

  it('returns null when the key is unset', async () => {
    mockGetItem.mockResolvedValueOnce(null);
    await expect(readStoredLanguage()).resolves.toBeNull();
  });

  it('returns null for an unsupported string (silently discards it)', async () => {
    // Corrupted value from an old build or manual edit — must never leak
    // into the app as if it were valid.
    mockGetItem.mockResolvedValueOnce('fr');
    await expect(readStoredLanguage()).resolves.toBeNull();
  });

  it('returns null for an empty string', async () => {
    mockGetItem.mockResolvedValueOnce('');
    await expect(readStoredLanguage()).resolves.toBeNull();
  });

  it('returns null when AsyncStorage throws (bootstrap must survive)', async () => {
    mockGetItem.mockRejectedValueOnce(new Error('storage offline'));
    await expect(readStoredLanguage()).resolves.toBeNull();
  });
});

describe('writeStoredLanguage', () => {
  it('persists a valid supported language', async () => {
    mockSetItem.mockResolvedValueOnce(undefined);
    await writeStoredLanguage('en');
    expect(mockSetItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, 'en');
  });

  it.each(['pt-BR', 'en', 'es'] as const)(
    'accepts every supported language: %s',
    async (lang) => {
      mockSetItem.mockResolvedValueOnce(undefined);
      await writeStoredLanguage(lang);
      expect(mockSetItem).toHaveBeenLastCalledWith(LANGUAGE_STORAGE_KEY, lang);
    },
  );

  it('refuses to persist a value outside the language contract', async () => {
    // Guards a dynamic path (future remote sync casting Firestore data as
    // string) that could otherwise silently write "fr" to disk.
    await expect(
      writeStoredLanguage('fr' as unknown as 'en'),
    ).rejects.toThrow(/refuse to persist non-supported language/);
    expect(mockSetItem).not.toHaveBeenCalled();
  });
});
