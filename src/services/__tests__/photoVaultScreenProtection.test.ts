import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: 'ios',
  available: vi.fn(),
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
  enableAppSwitcherProtectionAsync: mocks.enableSwitcher,
  disableAppSwitcherProtectionAsync: mocks.disableSwitcher,
}));

vi.mock('../../lib/logger', () => ({ logError: mocks.logError }));

import {
  activatePhotoVaultScreenProtection,
  deactivatePhotoVaultScreenProtection,
  isPhotoVaultScreenProtectionActive,
} from '../photoVaultScreenProtection';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.platform = 'ios';
  mocks.available.mockResolvedValue(true);
  mocks.enableSwitcher.mockResolvedValue(undefined);
  mocks.disableSwitcher.mockResolvedValue(undefined);
});
afterEach(async () => {
  await deactivatePhotoVaultScreenProtection();
});

/**
 * Screenshot/recording are never blocked by this module — see the file's own
 * doc comment. These tests only cover the iOS app-switcher preview blur,
 * which is the one thing that remains here.
 */
describe('Photo Vault screen protection (iOS app-switcher blur only)', () => {
  it('enables only the iOS app-switcher blur, nothing else', async () => {
    await activatePhotoVaultScreenProtection();

    expect(mocks.enableSwitcher).toHaveBeenCalledWith(1);
    expect(isPhotoVaultScreenProtectionActive()).toBe(true);
  });

  it('is a no-op on Android: no native call is made at all', async () => {
    mocks.platform = 'android';

    await activatePhotoVaultScreenProtection();

    expect(mocks.available).not.toHaveBeenCalled();
    expect(mocks.enableSwitcher).not.toHaveBeenCalled();
    expect(isPhotoVaultScreenProtectionActive()).toBe(false);

    await deactivatePhotoVaultScreenProtection();
    expect(mocks.disableSwitcher).not.toHaveBeenCalled();
  });

  it('releases the iOS app-switcher blur', async () => {
    await activatePhotoVaultScreenProtection();
    await deactivatePhotoVaultScreenProtection();

    expect(mocks.disableSwitcher).toHaveBeenCalledTimes(1);
    expect(isPhotoVaultScreenProtectionActive()).toBe(false);
  });

  it('keeps native ownership active after a failed release so foreground can retry', async () => {
    await activatePhotoVaultScreenProtection();
    mocks.disableSwitcher.mockRejectedValueOnce(new Error('transitioning controller'));

    await deactivatePhotoVaultScreenProtection();

    expect(isPhotoVaultScreenProtectionActive()).toBe(true);
    expect(mocks.logError).toHaveBeenCalledWith(
      'photoVault:screenProtection',
      expect.objectContaining({ message: 'vaultScreenProtectionFailed' }),
      { issue: 'vaultScreenProtectionFailed' },
    );

    await deactivatePhotoVaultScreenProtection();
    expect(isPhotoVaultScreenProtectionActive()).toBe(false);
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
    expect(isPhotoVaultScreenProtectionActive()).toBe(false);
  });

  it('fails closed when the iOS overlay setup fails', async () => {
    mocks.enableSwitcher.mockRejectedValue(new Error('native failure'));

    await expect(activatePhotoVaultScreenProtection()).rejects.toMatchObject({
      issue: 'vaultScreenProtectionFailed',
    });

    expect(isPhotoVaultScreenProtectionActive()).toBe(false);
  });

  it('does not activate when the native API is unavailable', async () => {
    mocks.available.mockResolvedValue(false);

    await expect(activatePhotoVaultScreenProtection()).rejects.toMatchObject({
      issue: 'vaultScreenProtectionUnavailable',
    });
    expect(mocks.enableSwitcher).not.toHaveBeenCalled();
  });

  it('never calls a screenshot/recording capture API — screenshots and recording stay allowed', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/photoVaultScreenProtection.ts', 'utf8');

    expect(source).not.toContain('preventScreenCaptureAsync');
    expect(source).not.toContain('allowScreenCaptureAsync');
    expect(source).not.toContain('requestPermissionsAsync');
    expect(source).not.toContain('READ_MEDIA_IMAGES');
    expect(source).not.toContain('addScreenshotListener');

    await activatePhotoVaultScreenProtection();
    expect(mocks.available).toHaveBeenCalled();
    // Only the switcher call is made — nothing that could block capture.
    expect(mocks.enableSwitcher).toHaveBeenCalledTimes(1);
  });
});
