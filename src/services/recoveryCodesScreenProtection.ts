import * as ScreenCapture from 'expo-screen-capture';
import { Platform } from 'react-native';

import { logError } from '../lib/logger';

/**
 * Native visual protection for the screen that reveals recovery codes.
 *
 * WHY A SEPARATE KEY FROM THE PHOTO VAULT
 * ---------------------------------------
 * Expo's ScreenCapture reference-counts independent callers by key, so a
 * distinct key is what stops this screen's release from tearing down the Photo
 * Vault's protection (and vice versa) if the two are ever alive at once. This
 * mirrors the reasoning already documented in
 * `services/photoVaultScreenProtection.ts` — same API, same convention,
 * separate owner.
 *
 * WHY IT IS BEST-EFFORT
 * ---------------------
 * Screenshot prevention is a speed bump, not a security control: a second
 * device photographing the screen defeats it entirely, and Android
 * FLAG_SECURE/iOS overlays are unavailable on some surfaces. So a failure here
 * must NEVER block the user from seeing codes they need — losing access to
 * recovery codes is a far worse outcome than a screenshot being possible. The
 * failure is logged and the flow continues.
 */
const RECOVERY_CODES_SCREEN_CAPTURE_KEY = 'ajfit-mfa-recovery-codes';

const SCOPE = 'mfaRecovery:screenProtection';
const IOS_SWITCHER_BLUR_INTENSITY = 1;

let active = false;

/** Enables capture protection before plaintext codes are rendered. */
export async function activateRecoveryCodesScreenProtection(): Promise<void> {
  if (active) return;

  try {
    if (!(await ScreenCapture.isAvailableAsync())) return;

    await ScreenCapture.preventScreenCaptureAsync(RECOVERY_CODES_SCREEN_CAPTURE_KEY);

    if (Platform.OS === 'ios') {
      // Android's FLAG_SECURE already blanks the recent-apps preview; iOS
      // needs this separate overlay so the codes are not in the app switcher.
      await ScreenCapture.enableAppSwitcherProtectionAsync(IOS_SWITCHER_BLUR_INTENSITY);
    }

    active = true;
  } catch (err) {
    // Best effort by design — see the module doc.
    logError(SCOPE, err);
  }
}

/** Releases the protection once the codes are no longer on screen. */
export async function deactivateRecoveryCodesScreenProtection(): Promise<void> {
  if (!active) return;
  active = false;

  try {
    if (Platform.OS === 'ios') {
      await ScreenCapture.disableAppSwitcherProtectionAsync();
    }
    await ScreenCapture.allowScreenCaptureAsync(RECOVERY_CODES_SCREEN_CAPTURE_KEY);
  } catch (err) {
    logError(SCOPE, err);
  }
}
