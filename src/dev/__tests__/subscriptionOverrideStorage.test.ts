import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPlatform = vi.hoisted(() => ({ OS: 'ios' }));
vi.mock('react-native', () => ({ Platform: mockPlatform }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    removeItem: vi.fn(),
  },
}));

vi.mock('../../lib/logger', () => ({
  logError: vi.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { logError } from '../../lib/logger';
import {
  clearLegacyStoredDevSubscriptionOverride,
  DEV_SUBSCRIPTION_OVERRIDE_STORAGE_KEY,
} from '../subscriptionOverrideStorage';

const mockRemoveItem = vi.mocked(AsyncStorage.removeItem);

function setDevFlags({ dev, optIn }: { dev: boolean; optIn: boolean }) {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = dev;
  process.env.EXPO_PUBLIC_ENABLE_DEV_SUBSCRIPTION_OVERRIDES = optIn ? '1' : '0';
}

beforeEach(() => {
  vi.clearAllMocks();
  setDevFlags({ dev: true, optIn: true });
});

describe('dev subscription override storage — allowed build', () => {
  it('removes the legacy device-wide key without reading it', async () => {
    mockRemoveItem.mockResolvedValueOnce(undefined);
    await clearLegacyStoredDevSubscriptionOverride();
    expect(mockRemoveItem).toHaveBeenCalledWith(DEV_SUBSCRIPTION_OVERRIDE_STORAGE_KEY);
  });

  it('logs and absorbs a legacy cleanup failure', async () => {
    const error = new Error('storage unavailable');
    mockRemoveItem.mockRejectedValueOnce(error);
    await expect(clearLegacyStoredDevSubscriptionOverride()).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith('devSubscriptionOverrideStorage:clearLegacy', error);
  });
});

describe('dev subscription override storage — disallowed build (production guarantee)', () => {
  it('never touches AsyncStorage', async () => {
    setDevFlags({ dev: false, optIn: false });
    await clearLegacyStoredDevSubscriptionOverride();
    expect(mockRemoveItem).not.toHaveBeenCalled();
  });

  it('also remains inert when __DEV__ is true but the opt-in flag is off', async () => {
    setDevFlags({ dev: true, optIn: false });
    await clearLegacyStoredDevSubscriptionOverride();
    expect(mockRemoveItem).not.toHaveBeenCalled();
  });
});
