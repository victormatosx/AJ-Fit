import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPlatform = vi.hoisted(() => ({ OS: 'ios' }));
vi.mock('react-native', () => ({ Platform: mockPlatform }));

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
  DEV_SUBSCRIPTION_OVERRIDE_STORAGE_KEY,
  readStoredDevSubscriptionOverride,
  writeStoredDevSubscriptionOverride,
} from '../subscriptionOverrideStorage';

const mockGetItem = vi.mocked(AsyncStorage.getItem);
const mockSetItem = vi.mocked(AsyncStorage.setItem);

function setDevFlags({ dev, optIn }: { dev: boolean; optIn: boolean }) {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = dev;
  process.env.EXPO_PUBLIC_ENABLE_DEV_SUBSCRIPTION_OVERRIDES = optIn ? '1' : '0';
}

beforeEach(() => {
  vi.clearAllMocks();
  setDevFlags({ dev: true, optIn: true });
});

describe('dev subscription override storage — allowed build', () => {
  it.each([
    [null, 'REAL'],
    ['REAL', 'REAL'],
    ['FREE', 'FREE'],
    ['PREMIUM_MONTHLY', 'PREMIUM_MONTHLY'],
    ['PREMIUM_ANNUAL', 'PREMIUM_ANNUAL'],
    ['TRIAL', 'TRIAL'],
    ['CANCELED_ACTIVE', 'CANCELED_ACTIVE'],
    ['EXPIRED', 'EXPIRED'],
    ['bogus-value', 'REAL'],
    ['{not-json', 'REAL'],
    ['', 'REAL'],
  ] as const)('resolves stored %j to %s', async (stored, expected) => {
    mockGetItem.mockResolvedValueOnce(stored);
    await expect(readStoredDevSubscriptionOverride()).resolves.toBe(expected);
    expect(mockGetItem).toHaveBeenCalledWith(DEV_SUBSCRIPTION_OVERRIDE_STORAGE_KEY);
  });

  it('falls back to REAL and logs when AsyncStorage read fails', async () => {
    const error = new Error('storage unavailable');
    mockGetItem.mockRejectedValueOnce(error);
    await expect(readStoredDevSubscriptionOverride()).resolves.toBe('REAL');
    expect(logError).toHaveBeenCalledWith('devSubscriptionOverrideStorage:read', error);
  });

  it('persists a valid state', async () => {
    mockSetItem.mockResolvedValueOnce(undefined);
    await writeStoredDevSubscriptionOverride('PREMIUM_ANNUAL');
    expect(mockSetItem).toHaveBeenCalledWith(
      DEV_SUBSCRIPTION_OVERRIDE_STORAGE_KEY,
      'PREMIUM_ANNUAL',
    );
  });

  it('refuses to persist an invalid state', async () => {
    await expect(
      writeStoredDevSubscriptionOverride('NOT_A_REAL_STATE' as never),
    ).rejects.toThrow(/refuse to persist invalid override/);
    expect(mockSetItem).not.toHaveBeenCalled();
  });
});

describe('dev subscription override storage — disallowed build (production guarantee)', () => {
  it('read never touches AsyncStorage and always resolves REAL, even with a stale premium value on disk', async () => {
    setDevFlags({ dev: false, optIn: false });
    await expect(readStoredDevSubscriptionOverride()).resolves.toBe('REAL');
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it('read ignores a value even if __DEV__ leaks true but the opt-in flag is off', async () => {
    setDevFlags({ dev: true, optIn: false });
    mockGetItem.mockResolvedValueOnce('PREMIUM_ANNUAL');
    await expect(readStoredDevSubscriptionOverride()).resolves.toBe('REAL');
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it('write is a silent no-op', async () => {
    setDevFlags({ dev: false, optIn: false });
    await writeStoredDevSubscriptionOverride('PREMIUM_ANNUAL');
    expect(mockSetItem).not.toHaveBeenCalled();
  });
});
