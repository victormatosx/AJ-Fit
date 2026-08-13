import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: 'ios',
  available: vi.fn(),
  prevent: vi.fn(),
  allow: vi.fn(),
  enableSwitcher: vi.fn(),
  disableSwitcher: vi.fn(),
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mocks.platform;
    },
  },
}));

vi.mock('expo-screen-capture', () => ({
  isAvailableAsync: mocks.available,
  preventScreenCaptureAsync: mocks.prevent,
  allowScreenCaptureAsync: mocks.allow,
  enableAppSwitcherProtectionAsync: mocks.enableSwitcher,
  disableAppSwitcherProtectionAsync: mocks.disableSwitcher,
}));

import {
  PHOTO_VAULT_SCREEN_CAPTURE_KEY,
  activatePhotoVaultScreenProtection,
  deactivatePhotoVaultScreenProtection,
  isPhotoVaultScreenProtectionActive,
} from '../photoVaultScreenProtection';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.platform = 'ios';
  mocks.available.mockResolvedValue(true);
  mocks.prevent.mockResolvedValue(undefined);
  mocks.allow.mockResolvedValue(undefined);
  mocks.enableSwitcher.mockResolvedValue(undefined);
  mocks.disableSwitcher.mockResolvedValue(undefined);
});

afterEach(async () => {
  await deactivatePhotoVaultScreenProtection();
});

describe('Photo Vault screen protection', () => {
  it('enables capture blocking and iOS app-switcher protection', async () => {
    await activatePhotoVaultScreenProtection();

    expect(mocks.prevent).toHaveBeenCalledWith(PHOTO_VAULT_SCREEN_CAPTURE_KEY);
    expect(mocks.enableSwitcher).toHaveBeenCalledWith(1);
    expect(isPhotoVaultScreenProtectionActive()).toBe(true);
  });

  it('uses Android FLAG_SECURE through capture blocking without an iOS call', async () => {
    mocks.platform = 'android';

    await activatePhotoVaultScreenProtection();

    expect(mocks.prevent).toHaveBeenCalledWith(PHOTO_VAULT_SCREEN_CAPTURE_KEY);
    expect(mocks.enableSwitcher).not.toHaveBeenCalled();
  });

  it('releases only its own keyed protection', async () => {
    await activatePhotoVaultScreenProtection();
    await deactivatePhotoVaultScreenProtection();

    expect(mocks.allow).toHaveBeenCalledWith(PHOTO_VAULT_SCREEN_CAPTURE_KEY);
    expect(mocks.disableSwitcher).toHaveBeenCalledTimes(1);
    expect(isPhotoVaultScreenProtectionActive()).toBe(false);
  });

  it('fails closed and rolls capture blocking back when iOS overlay setup fails', async () => {
    mocks.enableSwitcher.mockRejectedValue(new Error('native failure'));

    await expect(activatePhotoVaultScreenProtection()).rejects.toMatchObject({
      issue: 'vaultScreenProtectionFailed',
    });

    expect(mocks.allow).toHaveBeenCalledWith(PHOTO_VAULT_SCREEN_CAPTURE_KEY);
    expect(isPhotoVaultScreenProtectionActive()).toBe(false);
  });

  it('does not activate when the native API is unavailable', async () => {
    mocks.available.mockResolvedValue(false);

    await expect(activatePhotoVaultScreenProtection()).rejects.toMatchObject({
      issue: 'vaultScreenProtectionUnavailable',
    });
    expect(mocks.prevent).not.toHaveBeenCalled();
  });

  it('does not request screenshot-detection permissions', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/photoVaultScreenProtection.ts', 'utf8');

    expect(source).not.toContain('requestPermissionsAsync');
    expect(source).not.toContain('READ_MEDIA_IMAGES');
    expect(source).not.toContain('addScreenshotListener');
  });
});

