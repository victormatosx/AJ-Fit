import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';

/**
 * Device-level authentication for the Photo Vault.
 *
 * This is NOT Firebase reauthentication. Firebase reauth proves account
 * ownership to the backend and is only needed to recover the Vault Key on a
 * new device (see services/photoVaultRecovery.ts). This module proves that
 * the person holding the unlocked phone right now is its owner, and it runs
 * every time the vault is opened.
 *
 * AJ Fit never implements its own PIN, password or pattern: authentication
 * is delegated entirely to the operating system.
 */

export type VaultAuthMechanism =
  | 'face'
  | 'fingerprint'
  | 'iris'
  | 'deviceCredential'
  | 'none';

export interface VaultAuthCapability {
  /** The device has authentication hardware or a secure lock screen. */
  available: boolean;
  /** Something the user can actually authenticate with is enrolled. */
  enrolled: boolean;
  /**
   * Mechanisms the OS reports for this device, in the order AJ Fit would
   * prefer them. Informational only — the OS decides which one the prompt
   * actually offers.
   */
  mechanisms: VaultAuthMechanism[];
  /** Strong biometrics (Class 3 / Face ID / Touch ID) are enrolled. */
  hasStrongBiometrics: boolean;
  /** A secure lock screen (PIN, pattern or password) is set. */
  hasDeviceCredential: boolean;
}

export type VaultAuthResult =
  | { status: 'success' }
  | { status: 'cancelled' }
  | { status: 'failed' }
  | { status: 'lockedOut' }
  | { status: 'notAvailable' }
  | { status: 'notEnrolled' }
  | { status: 'notConfigured' };

/**
 * Android only. `'weak'` (the library default) would accept Class 2
 * biometrics — typically 2D camera face unlock, which is defeated by a
 * photograph. Private photos do not warrant that, so only Class 3 is
 * accepted. A device whose only biometric is weak still authenticates, via
 * the device credential that stays in the allowed set below.
 */
const ANDROID_BIOMETRIC_SECURITY: LocalAuthentication.BiometricsSecurityLevel = 'strong';

function toMechanism(type: LocalAuthentication.AuthenticationType): VaultAuthMechanism {
  switch (type) {
    case LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION:
      return 'face';
    case LocalAuthentication.AuthenticationType.FINGERPRINT:
      return 'fingerprint';
    case LocalAuthentication.AuthenticationType.IRIS:
      return 'iris';
    default:
      return 'none';
  }
}

/** Product preference order: face, then fingerprint, then iris. */
const MECHANISM_ORDER = ['face', 'fingerprint', 'iris'] as const;

/**
 * Inspects what this device can actually authenticate with.
 *
 * Nothing is assumed from the platform: an iPhone is not assumed to have
 * Face ID, and an Android device is not assumed to have a fingerprint
 * reader. Everything is read from the OS.
 */
export async function getVaultAuthCapability(): Promise<VaultAuthCapability> {
  try {
    const [hasHardware, isEnrolled, types, level] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
      LocalAuthentication.getEnrolledLevelAsync(),
    ]);

    const detected = types.map(toMechanism);
    const mechanisms: VaultAuthMechanism[] = MECHANISM_ORDER.filter((m) =>
      detected.includes(m),
    );

    const hasStrongBiometrics =
      isEnrolled && level === LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG;
    // SECRET means a lock screen secret is set. Strong biometrics imply one
    // too, since Android and iOS both require a passcode to enrol biometrics.
    const hasDeviceCredential = level !== LocalAuthentication.SecurityLevel.NONE;

    if (hasDeviceCredential) mechanisms.push('deviceCredential');

    return {
      available: hasHardware || hasDeviceCredential,
      enrolled: isEnrolled || hasDeviceCredential,
      mechanisms: mechanisms.length > 0 ? mechanisms : ['none'],
      hasStrongBiometrics,
      hasDeviceCredential,
    };
  } catch {
    // Treat an unreadable capability as "cannot authenticate" — never as
    // permission to skip authentication.
    return {
      available: false,
      enrolled: false,
      mechanisms: ['none'],
      hasStrongBiometrics: false,
      hasDeviceCredential: false,
    };
  }
}

function mapError(error: LocalAuthentication.LocalAuthenticationError): VaultAuthResult {
  switch (error) {
    case 'user_cancel':
    case 'app_cancel':
    case 'system_cancel':
      return { status: 'cancelled' };
    case 'lockout':
      return { status: 'lockedOut' };
    case 'not_available':
      return { status: 'notAvailable' };
    case 'not_enrolled':
      return { status: 'notEnrolled' };
    case 'passcode_not_set':
      return { status: 'notConfigured' };
    default:
      // authentication_failed, unable_to_process, timeout, unknown, …
      return { status: 'failed' };
  }
}

export interface AuthenticateOptions {
  promptMessage: string;
  cancelLabel: string;
}

/**
 * Runs the OS authentication prompt.
 *
 * `disableDeviceFallback` is deliberately left at its default (`false`), and
 * that single choice is what implements the product's
 * face → fingerprint → device credential preference on both platforms:
 *
 *  - iOS: uses `LAPolicyDeviceOwnerAuthentication`, so the system shows
 *    Face ID or Touch ID (whichever that iPhone has) and falls back to the
 *    device passcode by itself after failed attempts.
 *  - Android: the module passes `BIOMETRIC_STRONG | DEVICE_CREDENTIAL` to
 *    `BiometricPrompt.setAllowedAuthenticators`, so the system offers the
 *    enrolled strong biometric and the lock-screen credential together.
 *
 * AJ Fit therefore never sequences prompts itself and never renders its own
 * "choose face or fingerprint" selector: the OS owns that decision, which is
 * both better UX and the only way to stay inside the platform's security
 * abstraction.
 */
export async function authenticateForPhotoVault(
  options: AuthenticateOptions,
): Promise<VaultAuthResult> {
  const capability = await getVaultAuthCapability();

  // No biometric and no lock screen: there is nothing secure to authenticate
  // against, so the vault must stay closed rather than open unprotected.
  if (!capability.available || !capability.enrolled) {
    return { status: capability.available ? 'notEnrolled' : 'notConfigured' };
  }

  let result: LocalAuthentication.LocalAuthenticationResult;
  try {
    result = await LocalAuthentication.authenticateAsync({
      promptMessage: options.promptMessage,
      cancelLabel: options.cancelLabel,
      // Never disabled: this is what enables the native passcode fallback.
      disableDeviceFallback: false,
      ...(Platform.OS === 'android'
        ? { biometricsSecurityLevel: ANDROID_BIOMETRIC_SECURITY, requireConfirmation: false }
        : {}),
    });
  } catch {
    return { status: 'failed' };
  }

  if (result.success) return { status: 'success' };
  return mapError(result.error);
}
