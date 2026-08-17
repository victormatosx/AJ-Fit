import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: 'ios',
  available: vi.fn(),
  prevent: vi.fn(),
  allow: vi.fn(),
  enableSwitcher: vi.fn(),
  disableSwitcher: vi.fn(),
  logError: vi.fn(),
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

vi.mock('../../lib/logger', () => ({ logError: mocks.logError }));

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

  it('removes the iOS switcher overlay before restoring the capture hierarchy', async () => {
    await activatePhotoVaultScreenProtection();
    await deactivatePhotoVaultScreenProtection();

    expect(mocks.disableSwitcher.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.allow.mock.invocationCallOrder[0]!,
    );
  });

  it('keeps native ownership active after a failed release so foreground can retry', async () => {
    await activatePhotoVaultScreenProtection();
    mocks.disableSwitcher.mockRejectedValueOnce(new Error('transitioning controller'));

    await deactivatePhotoVaultScreenProtection();

    expect(isPhotoVaultScreenProtectionActive()).toBe(true);
    expect(mocks.allow).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith(
      'photoVault:screenProtection',
      expect.objectContaining({ message: 'vaultScreenProtectionFailed' }),
      {
        issue: 'vaultScreenProtectionFailed',
        providerCode: 'deactivate_switcher',
      },
    );

    await deactivatePhotoVaultScreenProtection();
    expect(isPhotoVaultScreenProtectionActive()).toBe(false);
    expect(mocks.allow).toHaveBeenCalledWith(PHOTO_VAULT_SCREEN_CAPTURE_KEY);
  });

  it('also retries when keyed capture release fails after the switcher overlay is removed', async () => {
    await activatePhotoVaultScreenProtection();
    mocks.allow.mockRejectedValueOnce(new Error('window still transitioning'));

    await deactivatePhotoVaultScreenProtection();
    expect(isPhotoVaultScreenProtectionActive()).toBe(true);
    expect(mocks.logError).toHaveBeenCalledWith(
      'photoVault:screenProtection',
      expect.objectContaining({ message: 'vaultScreenProtectionFailed' }),
      {
        issue: 'vaultScreenProtectionFailed',
        providerCode: 'deactivate_allow',
      },
    );

    await deactivatePhotoVaultScreenProtection();
    expect(isPhotoVaultScreenProtectionActive()).toBe(false);
    expect(mocks.allow).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent native releases', async () => {
    await activatePhotoVaultScreenProtection();
    let finishDisable: () => void = () => {};
    mocks.disableSwitcher.mockReturnValueOnce(
      new Promise<void>((resolve) => { finishDisable = resolve; }),
    );

    const first = deactivatePhotoVaultScreenProtection();
    const second = deactivatePhotoVaultScreenProtection();
    await Promise.resolve();
    expect(mocks.disableSwitcher).toHaveBeenCalledTimes(1);

    finishDisable();
    await Promise.all([first, second]);
    expect(mocks.allow).toHaveBeenCalledTimes(1);
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
    expect(mocks.allow).not.toHaveBeenCalled();
    expect(mocks.disableSwitcher).not.toHaveBeenCalled();
  });

  it('does not request screenshot-detection permissions', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/photoVaultScreenProtection.ts', 'utf8');

    expect(source).not.toContain('requestPermissionsAsync');
    expect(source).not.toContain('READ_MEDIA_IMAGES');
    expect(source).not.toContain('addScreenshotListener');
  });
});
