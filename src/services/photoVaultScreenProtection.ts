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
let deactivation: Promise<void> | null = null;

/**
 * Enables screenshot/recording protection before private content is rendered.
 *
 * Android's implementation also sets FLAG_SECURE, which blanks the recent-apps
 * preview. iOS needs the separate app-switcher overlay in addition to capture
 * prevention, so both official Expo APIs are enabled there.
 */
export async function activatePhotoVaultScreenProtection(): Promise<void> {
  if (deactivation) await deactivation;
  if (active) return;
  if (activation) return activation;

  activation = (async () => {
    let stage = 'activate_available';
    let capturePrevented = false;
    let switcherAttempted = false;
    try {
      if (!(await ScreenCapture.isAvailableAsync())) {
        throw new PhotoVaultError('vaultScreenProtectionUnavailable');
      }

      stage = 'activate_prevent';
      await ScreenCapture.preventScreenCaptureAsync(PHOTO_VAULT_SCREEN_CAPTURE_KEY);
      capturePrevented = true;

      if (Platform.OS === 'ios') {
        stage = 'activate_switcher';
        switcherAttempted = true;
        await ScreenCapture.enableAppSwitcherProtectionAsync(IOS_SWITCHER_BLUR_INTENSITY);
      }

      active = true;
    } catch (error) {
      // If the iOS app-switcher step failed after capture prevention succeeded,
      // release both native protections before failing the unlock attempt.
      try {
        if (Platform.OS === 'ios' && switcherAttempted) {
          await ScreenCapture.disableAppSwitcherProtectionAsync();
        }
        if (capturePrevented) {
          await ScreenCapture.allowScreenCaptureAsync(PHOTO_VAULT_SCREEN_CAPTURE_KEY);
        }
      } catch {
        // Best effort. The app restart also clears Expo's capture locks.
      }

      const issue =
        error instanceof PhotoVaultError
          ? error.issue
          : 'vaultScreenProtectionFailed';
      logPhotoVaultIssue(SCOPE, issue, stage);
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
  if (deactivation) return deactivation;

  deactivation = (async () => {
    if (activation) {
      try {
        await activation;
      } catch {
        // Activation already logged and rolled itself back.
      }
    }

    if (!active) return;
    let stage = Platform.OS === 'ios' ? 'deactivate_switcher' : 'deactivate_allow';
    try {
      // Remove the app-switcher observer/overlay before restoring the keyed
      // screenshot hierarchy. On iOS the latter reparents the current window.
      if (Platform.OS === 'ios') {
        await ScreenCapture.disableAppSwitcherProtectionAsync();
      }
      stage = 'deactivate_allow';
      await ScreenCapture.allowScreenCaptureAsync(PHOTO_VAULT_SCREEN_CAPTURE_KEY);
      active = false;
    } catch {
      // Keep `active` true so a later safe foreground frame can retry. Marking
      // it false here used to strand a native overlay after one transient
      // failure, because every subsequent cleanup returned early.
      logPhotoVaultIssue(SCOPE, 'vaultScreenProtectionFailed', stage);
    }
  })();

  try {
    await deactivation;
  } finally {
    deactivation = null;
  }
}

/** Test seam. No native state or token-like value is exposed. */
export function isPhotoVaultScreenProtectionActive(): boolean {
  return active;
}
