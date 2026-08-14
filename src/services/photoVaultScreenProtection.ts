import * as ScreenCapture from 'expo-screen-capture';
import { Platform } from 'react-native';

import { PhotoVaultError, logPhotoVaultIssue } from '../lib/photoVaultErrors';

/**
 * Native visual protection for the Photo Vault.
 *
 * The key is intentionally vault-specific: Expo ScreenCapture reference-counts
 * independent callers by key, so releasing the vault cannot accidentally
 * release a future protection owned by another sensitive area.
 */
export const PHOTO_VAULT_SCREEN_CAPTURE_KEY = 'ajfit-photo-vault';

const SCOPE = 'screenProtection';
const IOS_SWITCHER_BLUR_INTENSITY = 1;

let active = false;
let activation: Promise<void> | null = null;

/**
 * Enables screenshot/recording protection before private content is rendered.
 *
 * Android's implementation also sets FLAG_SECURE, which blanks the recent-apps
 * preview. iOS needs the separate app-switcher overlay in addition to capture
 * prevention, so both official Expo APIs are enabled there.
 */
export async function activatePhotoVaultScreenProtection(): Promise<void> {
  if (active) return;
  if (activation) return activation;

  activation = (async () => {
    try {
      if (!(await ScreenCapture.isAvailableAsync())) {
        throw new PhotoVaultError('vaultScreenProtectionUnavailable');
      }

      await ScreenCapture.preventScreenCaptureAsync(PHOTO_VAULT_SCREEN_CAPTURE_KEY);

      if (Platform.OS === 'ios') {
        await ScreenCapture.enableAppSwitcherProtectionAsync(IOS_SWITCHER_BLUR_INTENSITY);
      }

      active = true;
    } catch (error) {
      // If the iOS app-switcher step failed after capture prevention succeeded,
      // release our keyed capture lock before failing the unlock attempt.
      try {
        await ScreenCapture.allowScreenCaptureAsync(PHOTO_VAULT_SCREEN_CAPTURE_KEY);
      } catch {
        // Best effort. The app restart also clears Expo's capture locks.
      }

      const issue =
        error instanceof PhotoVaultError
          ? error.issue
          : 'vaultScreenProtectionFailed';
      logPhotoVaultIssue(SCOPE, issue);
      throw new PhotoVaultError(issue);
    } finally {
      activation = null;
    }
  })();

  return activation;
}
/**
 * Releases only the protection owned by the Photo Vault.
 *
 * Callers retain it while the app is backgrounded, even though the vault is
 * already locked, so a stale native snapshot can never be captured between
 * the lock and the first safe foreground frame.
 */
export async function deactivatePhotoVaultScreenProtection(): Promise<void> {
  if (activation) {
    try {
      await activation;
    } catch {
      // Activation already logged and rolled itself back.
    }
  }

  if (!active) return;
  active = false;

  try {
    await ScreenCapture.allowScreenCaptureAsync(PHOTO_VAULT_SCREEN_CAPTURE_KEY);
    if (Platform.OS === 'ios') {
      await ScreenCapture.disableAppSwitcherProtectionAsync();
    }
  } catch {
    // Locking and hiding content have already happened. A failed release is
    // privacy-safe (protection remains stricter), so log only a sanitized issue.
    logPhotoVaultIssue(SCOPE, 'vaultScreenProtectionFailed');
  }
}

/** Test seam. No native state or token-like value is exposed. */
export function isPhotoVaultScreenProtectionActive(): boolean {
  return active;
}
