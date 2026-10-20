import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Device-level authentication for the Photo Vault.
 *
 * This is NOT Firebase reauthentication. Firebase reauth proves account
 * ownership to the backend and is only needed to recover the Vault Key on a
 * new device (see services/photoVaultRecovery.ts).
 *
 * AJ Fit never implements its own PIN, password or pattern: authentication
 * is delegated entirely to the operating system. Product decision: opening
 * the gallery no longer requires an OS authentication step at all, so
 * `authenticateForPhotoVault` below is an unconditional success — the Vault
 * Key, encryption and Firebase isolation it guarded are untouched.
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

export interface AuthenticateOptions {
  promptMessage: string;
  cancelLabel: string;
}

/**
 * Gate for opening the Photo Vault.
 *
 * Product decision: the gallery opens directly, with no OS authentication
 * prompt (Face ID, Touch ID, fingerprint or device passcode) and no
 * in-app password. `options` is accepted only so the lock state machine
 * that calls this does not need its own conditional — nothing here reads
 * it or shows a native prompt.
 */
export async function authenticateForPhotoVault(
  _options: AuthenticateOptions,
): Promise<VaultAuthResult> {
  return { status: 'success' };
}
