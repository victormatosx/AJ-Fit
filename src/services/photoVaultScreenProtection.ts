import * as ScreenCapture from 'expo-screen-capture';
import { Platform } from 'react-native';

import { PhotoVaultError, logPhotoVaultIssue } from '../lib/photoVaultErrors';

/**
 * Native app-switcher privacy for the Photo Vault (iOS only).
 *
 * This does NOT block screenshots or screen recording — the user may capture
 * their own private photos intentionally, on both platforms. The only thing
 * this covers is the OS recent-apps preview: on iOS, `enableAppSwitcherProtectionAsync`
 * is a separate native API from screenshot/recording prevention, so it can be
 * kept without blocking capture. On Android, the equivalent recent-apps
 * blanking is a side effect of `FLAG_SECURE`, the SAME flag that blocks
 * screenshots — there is no separate Android API for one without the other,
 * so Android has no app-switcher protection here.
 */

const SCOPE = 'screenProtection';
const IOS_SWITCHER_BLUR_INTENSITY = 1;

let active = false;
let activation: Promise<void> | null = null;
let deactivation: Promise<void> | null = null;

/** Enables the iOS app-switcher blur before private content is rendered. No-op on Android. */
export async function activatePhotoVaultScreenProtection(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  if (deactivation) await deactivation;
  if (active) return;
  if (activation) return activation;

  activation = (async () => {
    try {
      if (!(await ScreenCapture.isAvailableAsync())) {
        throw new PhotoVaultError('vaultScreenProtectionUnavailable');
      }

      await ScreenCapture.enableAppSwitcherProtectionAsync(IOS_SWITCHER_BLUR_INTENSITY);
      active = true;
    } catch (error) {
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

/** Releases the iOS app-switcher blur. No-op on Android. */
export async function deactivatePhotoVaultScreenProtection(): Promise<void> {
  if (Platform.OS !== 'ios') return;
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
    try {
      await ScreenCapture.disableAppSwitcherProtectionAsync();
      active = false;
    } catch {
      // Keep `active` true so a later safe foreground frame can retry.
      logPhotoVaultIssue(SCOPE, 'vaultScreenProtectionFailed');
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
