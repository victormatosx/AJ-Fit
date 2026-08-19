import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
  },
}));

vi.mock('../../lib/logger', () => ({
  logError: vi.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { logError } from '../../lib/logger';
import {
  readStoredThemePreference,
  THEME_PREFERENCE_STORAGE_KEY,
  writeStoredThemePreference,
} from '../themeStorage';

const mockGetItem = vi.mocked(AsyncStorage.getItem);
const mockSetItem = vi.mocked(AsyncStorage.setItem);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('theme preference storage', () => {
  it.each([
    [null, 'dark'],
    ['dark', 'dark'],
    ['light', 'light'],
    ['system', 'dark'],
    ['automatic', 'dark'],
    ['unknown', 'dark'],
    ['{not-json', 'dark'],
    ['', 'dark'],
  ] as const)('resolves stored %j to %s', async (stored, expected) => {
    mockGetItem.mockResolvedValueOnce(stored);

    await expect(readStoredThemePreference()).resolves.toBe(expected);
    expect(mockGetItem).toHaveBeenCalledWith(THEME_PREFERENCE_STORAGE_KEY);
  });

  it('falls back to Dark and logs when AsyncStorage read fails', async () => {
    const error = new Error('storage unavailable');
    mockGetItem.mockRejectedValueOnce(error);

    await expect(readStoredThemePreference()).resolves.toBe('dark');
    expect(logError).toHaveBeenCalledWith('themeStorage:read', error);
  });

  it.each(['dark', 'light'] as const)('persists only the literal %s', async (mode) => {
    mockSetItem.mockResolvedValueOnce(undefined);

    await writeStoredThemePreference(mode);

    expect(mockSetItem).toHaveBeenCalledWith(THEME_PREFERENCE_STORAGE_KEY, mode);
  });

  it('refuses legacy or invalid values before touching disk', async () => {
    await expect(
      writeStoredThemePreference('system' as never),
    ).rejects.toThrow(/refuse to persist invalid preference/);
    expect(mockSetItem).not.toHaveBeenCalled();
  });
});
