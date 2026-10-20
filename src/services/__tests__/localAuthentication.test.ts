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
//
// `getVaultAuthCapability` stays: it is informational reporting about the
// device, unrelated to the Vault's access gate, and nothing below depends on
// it to decide whether the gallery opens.

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

// ── Vault access gate ──────────────────────────────────────────────────────
//
// Product decision: opening the gallery no longer requires Face ID, a
// fingerprint, an iris scan or a device passcode. `authenticateForPhotoVault`
// is an unconditional success and never touches the native module — on any
// device profile, enrolled or not, protected or not.

describe('authenticateForPhotoVault', () => {
  it('always succeeds, regardless of device profile', async () => {
    expect(await authenticateForPhotoVault(PROMPT)).toEqual({ status: 'success' });
  });

  it('never opens a native prompt', async () => {
    await authenticateForPhotoVault(PROMPT);

    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it('never inspects the device capability to decide', async () => {
    await authenticateForPhotoVault(PROMPT);

    expect(mocks.hasHardware).not.toHaveBeenCalled();
    expect(mocks.isEnrolled).not.toHaveBeenCalled();
    expect(mocks.supportedTypes).not.toHaveBeenCalled();
    expect(mocks.enrolledLevel).not.toHaveBeenCalled();
  });

  it('succeeds on a completely unprotected device', async () => {
    device({ hardware: false, enrolled: false, types: [], level: LEVEL_NONE });

    expect(await authenticateForPhotoVault(PROMPT)).toEqual({ status: 'success' });
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it('succeeds on both platforms', async () => {
    device({ platform: 'ios' });
    expect(await authenticateForPhotoVault(PROMPT)).toEqual({ status: 'success' });

    device({ platform: 'android' });
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
