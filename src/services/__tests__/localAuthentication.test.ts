import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasHardware: vi.fn(),
  isEnrolled: vi.fn(),
  supportedTypes: vi.fn(),
  enrolledLevel: vi.fn(),
  authenticate: vi.fn(),
  platform: 'ios' as 'ios' | 'android',
}));

vi.mock('expo-local-authentication', () => ({
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  hasHardwareAsync: mocks.hasHardware,
  isEnrolledAsync: mocks.isEnrolled,
  supportedAuthenticationTypesAsync: mocks.supportedTypes,
  getEnrolledLevelAsync: mocks.enrolledLevel,
  authenticateAsync: mocks.authenticate,
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mocks.platform;
    },
  },
}));

import {
  authenticateForPhotoVault,
  getVaultAuthCapability,
} from '../localAuthentication';

const FINGERPRINT = 1;
const FACE = 2;
const IRIS = 3;
const LEVEL_NONE = 0;
const LEVEL_SECRET = 1;
const LEVEL_WEAK = 2;
const LEVEL_STRONG = 3;

const PROMPT = { promptMessage: 'Desbloqueie', cancelLabel: 'Cancelar' };

/** Configures a device profile. */
function device(opts: {
  hardware?: boolean;
  enrolled?: boolean;
  types?: number[];
  level?: number;
  platform?: 'ios' | 'android';
}) {
  mocks.hasHardware.mockResolvedValue(opts.hardware ?? true);
  mocks.isEnrolled.mockResolvedValue(opts.enrolled ?? true);
  mocks.supportedTypes.mockResolvedValue(opts.types ?? []);
  mocks.enrolledLevel.mockResolvedValue(opts.level ?? LEVEL_STRONG);
  mocks.platform = opts.platform ?? 'ios';
}

beforeEach(() => {
  vi.clearAllMocks();
  device({});
  mocks.authenticate.mockResolvedValue({ success: true });
});

// ── Capability detection ───────────────────────────────────────────────────

describe('getVaultAuthCapability', () => {
  it('detects Face ID on an iPhone that has it', async () => {
    device({ types: [FACE], level: LEVEL_STRONG });

    const capability = await getVaultAuthCapability();

    expect(capability.mechanisms).toContain('face');
    expect(capability.hasStrongBiometrics).toBe(true);
  });

  it('detects Touch ID on an iPhone that has it', async () => {
    device({ types: [FINGERPRINT], level: LEVEL_STRONG });

    const capability = await getVaultAuthCapability();

    expect(capability.mechanisms).toContain('fingerprint');
    expect(capability.mechanisms).not.toContain('face');
  });

  it('never assumes a platform implies a mechanism', async () => {
    // An iPhone with only a fingerprint reader, and an Android with only a
    // face sensor, must both be reported truthfully.
    device({ types: [FINGERPRINT], platform: 'ios' });
    expect((await getVaultAuthCapability()).mechanisms).toEqual([
      'fingerprint',
      'deviceCredential',
    ]);

    device({ types: [FACE], platform: 'android' });
    expect((await getVaultAuthCapability()).mechanisms).toEqual(['face', 'deviceCredential']);
  });

  it('orders multiple mechanisms face → fingerprint → iris', async () => {
    device({ types: [IRIS, FINGERPRINT, FACE], platform: 'android' });

    const capability = await getVaultAuthCapability();

    expect(capability.mechanisms).toEqual([
      'face',
      'fingerprint',
      'iris',
      'deviceCredential',
    ]);
  });

  it('reports a device credential when only a lock screen is set', async () => {
    device({ hardware: false, enrolled: false, types: [], level: LEVEL_SECRET });

    const capability = await getVaultAuthCapability();

    expect(capability.hasDeviceCredential).toBe(true);
    expect(capability.hasStrongBiometrics).toBe(false);
    expect(capability.enrolled).toBe(true);
    expect(capability.mechanisms).toEqual(['deviceCredential']);
  });

  it('does not count weak biometrics as strong', async () => {
    device({ types: [FACE], level: LEVEL_WEAK, platform: 'android' });

    const capability = await getVaultAuthCapability();

    expect(capability.hasStrongBiometrics).toBe(false);
  });

  it('reports a completely unprotected device', async () => {
    device({ hardware: false, enrolled: false, types: [], level: LEVEL_NONE });

    const capability = await getVaultAuthCapability();

    expect(capability).toMatchObject({
      available: false,
      enrolled: false,
      mechanisms: ['none'],
      hasStrongBiometrics: false,
      hasDeviceCredential: false,
    });
  });

  it('fails closed when the platform cannot be queried', async () => {
    mocks.hasHardware.mockRejectedValue(new Error('module unavailable'));

    const capability = await getVaultAuthCapability();

    // Unreadable capability is never permission to skip authentication.
    expect(capability.available).toBe(false);
    expect(capability.enrolled).toBe(false);
  });
});

// ── Native prompt configuration ────────────────────────────────────────────

describe('prompt configuration', () => {
  it('never disables the device fallback', async () => {
    await authenticateForPhotoVault(PROMPT);

    // This single flag is what gives Face ID → passcode on iOS and
    // BIOMETRIC | DEVICE_CREDENTIAL on Android.
    expect(mocks.authenticate.mock.calls[0]![0]).toMatchObject({
      disableDeviceFallback: false,
    });
  });

  it('requires strong biometrics on Android', async () => {
    device({ types: [FACE], platform: 'android' });

    await authenticateForPhotoVault(PROMPT);

    // 'weak' would accept 2D camera face unlock, defeated by a photograph.
    expect(mocks.authenticate.mock.calls[0]![0]).toMatchObject({
      biometricsSecurityLevel: 'strong',
    });
  });

  it('does not send Android-only options on iOS', async () => {
    device({ platform: 'ios' });

    await authenticateForPhotoVault(PROMPT);

    expect(mocks.authenticate.mock.calls[0]![0]).not.toHaveProperty(
      'biometricsSecurityLevel',
    );
  });

  it('opens exactly one native prompt per call', async () => {
    await authenticateForPhotoVault(PROMPT);

    // No app-built sequencing of face → fingerprint → credential.
    expect(mocks.authenticate).toHaveBeenCalledTimes(1);
  });
});

// ── Results ────────────────────────────────────────────────────────────────

describe('authentication results', () => {
  it('reports success', async () => {
    expect(await authenticateForPhotoVault(PROMPT)).toEqual({ status: 'success' });
  });

  it.each([
    ['user_cancel', 'cancelled'],
    ['app_cancel', 'cancelled'],
    ['system_cancel', 'cancelled'],
    ['lockout', 'lockedOut'],
    ['not_available', 'notAvailable'],
    ['not_enrolled', 'notEnrolled'],
    ['passcode_not_set', 'notConfigured'],
    ['authentication_failed', 'failed'],
    ['unable_to_process', 'failed'],
    ['timeout', 'failed'],
    ['unknown', 'failed'],
    ['user_fallback', 'failed'],
  ])('maps %s onto %s', async (error, expected) => {
    mocks.authenticate.mockResolvedValue({ success: false, error });

    expect(await authenticateForPhotoVault(PROMPT)).toEqual({ status: expected });
  });

  it('treats a thrown module error as a failure, never a success', async () => {
    mocks.authenticate.mockRejectedValue(new Error('boom'));

    expect(await authenticateForPhotoVault(PROMPT)).toEqual({ status: 'failed' });
  });

  it('does not log native authentication results or localized payloads', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    mocks.authenticate.mockResolvedValue({
      success: false,
      error: 'unknown: 999, native localized details',
    });

    try {
      await authenticateForPhotoVault(PROMPT);
      expect(info).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
    }
  });
});

// ── Devices without a usable mechanism ─────────────────────────────────────

describe('devices without a usable mechanism', () => {
  it('never prompts on a completely unprotected device', async () => {
    device({ hardware: false, enrolled: false, types: [], level: LEVEL_NONE });

    const result = await authenticateForPhotoVault(PROMPT);

    expect(result).toEqual({ status: 'notConfigured' });
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it('reports notEnrolled when hardware exists but nothing is set up', async () => {
    device({ hardware: true, enrolled: false, types: [FACE], level: LEVEL_NONE });

    const result = await authenticateForPhotoVault(PROMPT);

    expect(result).toEqual({ status: 'notEnrolled' });
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it('still authenticates when only a lock screen credential exists', async () => {
    device({ hardware: false, enrolled: false, types: [], level: LEVEL_SECRET });

    const result = await authenticateForPhotoVault(PROMPT);

    expect(result).toEqual({ status: 'success' });
    expect(mocks.authenticate).toHaveBeenCalledTimes(1);
  });
});

// ── Platform scenarios ─────────────────────────────────────────────────────

describe('iOS scenarios', () => {
  it('A: Face ID enrolled → authenticates', async () => {
    device({ types: [FACE], level: LEVEL_STRONG, platform: 'ios' });

    expect(await authenticateForPhotoVault(PROMPT)).toEqual({ status: 'success' });
  });

  it('B: Touch ID enrolled → authenticates', async () => {
    device({ types: [FINGERPRINT], level: LEVEL_STRONG, platform: 'ios' });

    expect(await authenticateForPhotoVault(PROMPT)).toEqual({ status: 'success' });
  });

  it('C: biometrics not enrolled but a passcode is set → the OS uses it', async () => {
    device({ hardware: true, enrolled: false, types: [FACE], level: LEVEL_SECRET });

    expect(await authenticateForPhotoVault(PROMPT)).toEqual({ status: 'success' });
  });

  it('D: user cancels → cancelled', async () => {
    device({ types: [FACE], platform: 'ios' });
    mocks.authenticate.mockResolvedValue({ success: false, error: 'user_cancel' });

    expect(await authenticateForPhotoVault(PROMPT)).toEqual({ status: 'cancelled' });
  });

  it('E: biometrics locked out → the native result is respected', async () => {
    device({ types: [FACE], platform: 'ios' });
    mocks.authenticate.mockResolvedValue({ success: false, error: 'lockout' });

    // No attempt to work around the lockout.
    expect(await authenticateForPhotoVault(PROMPT)).toEqual({ status: 'lockedOut' });
    expect(mocks.authenticate).toHaveBeenCalledTimes(1);
  });
});

describe('Android scenarios', () => {
  it('A: strong face biometrics → authenticates', async () => {
    device({ types: [FACE], level: LEVEL_STRONG, platform: 'android' });

    expect(await authenticateForPhotoVault(PROMPT)).toEqual({ status: 'success' });
  });

  it('B: fingerprint → authenticates', async () => {
    device({ types: [FINGERPRINT], level: LEVEL_STRONG, platform: 'android' });

    expect(await authenticateForPhotoVault(PROMPT)).toEqual({ status: 'success' });
  });

  it('C: face and fingerprint → one native prompt, no app-built selector', async () => {
    device({ types: [FACE, FINGERPRINT], level: LEVEL_STRONG, platform: 'android' });

    await authenticateForPhotoVault(PROMPT);

    expect(mocks.authenticate).toHaveBeenCalledTimes(1);
  });

  it('D: fingerprint only → authenticates', async () => {
    device({ types: [FINGERPRINT], level: LEVEL_STRONG, platform: 'android' });

    expect(await authenticateForPhotoVault(PROMPT)).toEqual({ status: 'success' });
  });

  it('E: no biometrics but a device credential → native fallback is used', async () => {
    device({ hardware: false, enrolled: false, types: [], level: LEVEL_SECRET, platform: 'android' });

    expect(await authenticateForPhotoVault(PROMPT)).toEqual({ status: 'success' });
    expect(mocks.authenticate.mock.calls[0]![0]).toMatchObject({
      disableDeviceFallback: false,
    });
  });

  it('F: no biometrics and no credential → stays unauthenticated', async () => {
    device({ hardware: false, enrolled: false, types: [], level: LEVEL_NONE, platform: 'android' });

    expect(await authenticateForPhotoVault(PROMPT)).toEqual({ status: 'notConfigured' });
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it('G: weak-only face unlock still authenticates via the device credential', async () => {
    // Class 2 face is excluded by biometricsSecurityLevel: 'strong', but the
    // credential stays in the allowed set, so the user is not locked out.
    device({ types: [FACE], level: LEVEL_WEAK, enrolled: true, platform: 'android' });

    const capability = await getVaultAuthCapability();
    expect(capability.hasStrongBiometrics).toBe(false);
    expect(capability.hasDeviceCredential).toBe(true);

    expect(await authenticateForPhotoVault(PROMPT)).toEqual({ status: 'success' });
  });
});

// ── No home-grown authentication ───────────────────────────────────────────

describe('no home-grown authentication', () => {
  it('never implements a PIN, password or pattern of its own', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/localAuthentication.ts', 'utf8');

    expect(source).not.toMatch(/\bsetPin\b|\bverifyPin\b|\bstorePassword\b/);
    expect(source).not.toContain('SecureStore');
    expect(source).not.toContain('AsyncStorage');
  });

  it('never logs a biometric result or credential', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/localAuthentication.ts', 'utf8');

    expect(source).not.toContain('console.');
  });
});
