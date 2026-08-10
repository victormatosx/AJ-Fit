import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const auth = { currentUser: null as null | {
    uid: string;
    email: string;
    emailVerified: boolean;
  } };
  const mfa = {
    enrolledFactors: [] as Array<{
      uid: string;
      factorId: string;
      displayName: string | null;
      enrollmentTime: string;
    }>,
    getSession: vi.fn(),
    enroll: vi.fn(),
  };
  const resolver = {
    hints: [] as Array<{
      uid: string;
      factorId: string;
      displayName: string | null;
      enrollmentTime: string;
    }>,
    session: {},
    resolveSignIn: vi.fn(),
  };
  return {
    auth,
    assertionForEnrollment: vi.fn(),
    assertionForSignIn: vi.fn(),
    generateSecret: vi.fn(),
    getResolver: vi.fn(() => resolver),
    mfa,
    multiFactor: vi.fn(() => mfa),
    resolver,
  };
});

vi.mock('firebase/auth', () => ({
  getMultiFactorResolver: mocks.getResolver,
  multiFactor: mocks.multiFactor,
  TotpMultiFactorGenerator: {
    FACTOR_ID: 'totp',
    assertionForEnrollment: mocks.assertionForEnrollment,
    assertionForSignIn: mocks.assertionForSignIn,
    generateSecret: mocks.generateSecret,
  },
}));

vi.mock('../../lib/firebase', () => ({ auth: mocks.auth }));

import {
  captureTotpMfaSignInPoc,
  clearPendingTotpMfaSignInPoc,
  finishTotpEnrollmentPoc,
  getEnrolledTotpFactorsPoc,
  resolveTotpMfaSignInPoc,
  startTotpEnrollmentPoc,
} from '../totpMfaPoc';

const totpFactor = {
  uid: 'totp-1',
  factorId: 'totp',
  displayName: 'AJ Fit Authenticator',
  enrollmentTime: 'Mon, 10 Aug 2026 12:00:00 GMT',
};

describe('TOTP MFA POC Firebase service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPendingTotpMfaSignInPoc();
    mocks.auth.currentUser = {
      uid: 'user-1',
      email: 'person@example.com',
      emailVerified: true,
    };
    mocks.mfa.enrolledFactors = [];
    mocks.mfa.getSession.mockResolvedValue({ session: 'opaque' });
    mocks.resolver.hints = [totpFactor];
    mocks.resolver.resolveSignIn.mockResolvedValue({ user: mocks.auth.currentUser });
    mocks.assertionForEnrollment.mockReturnValue({ factorId: 'totp' });
    mocks.assertionForSignIn.mockReturnValue({ factorId: 'totp' });
    mocks.generateSecret.mockResolvedValue({
      secretKey: 'IN_MEMORY_TEST_SECRET',
      hashingAlgorithm: 'SHA1',
      codeLength: 6,
      codeIntervalSeconds: 30,
      enrollmentCompletionDeadline: '2026-08-10T12:05:00.000Z',
      generateQrCodeUrl: vi.fn(
        () => 'otpauth://totp/AJ%20Fit:person%40example.com?secret=TEST',
      ),
    });
  });

  it('gets a session and generates an in-memory secret plus otpauth URI', async () => {
    const draft = await startTotpEnrollmentPoc();

    expect(mocks.multiFactor).toHaveBeenCalledWith(mocks.auth.currentUser);
    expect(mocks.mfa.getSession).toHaveBeenCalledOnce();
    expect(mocks.generateSecret).toHaveBeenCalledWith({ session: 'opaque' });
    expect(draft.secretKey).toBe('IN_MEMORY_TEST_SECRET');
    expect(draft.otpAuthUri).toMatch(/^otpauth:\/\//);
  });

  it('rejects enrollment before Firebase when email is unverified', async () => {
    mocks.auth.currentUser!.emailVerified = false;

    await expect(startTotpEnrollmentPoc()).rejects.toMatchObject({
      issue: 'emailUnverified',
    });
    expect(mocks.mfa.getSession).not.toHaveBeenCalled();
  });

  it('creates the enrollment assertion, enrolls and re-reads enrolledFactors', async () => {
    const draft = await startTotpEnrollmentPoc();
    mocks.mfa.enroll.mockImplementation(async () => {
      mocks.mfa.enrolledFactors = [totpFactor];
    });

    const factors = await finishTotpEnrollmentPoc(draft, '123456');

    expect(mocks.assertionForEnrollment).toHaveBeenCalledWith(
      draft.secret,
      '123456',
    );
    expect(mocks.mfa.enroll).toHaveBeenCalledWith(
      { factorId: 'totp' },
      'AJ Fit Authenticator',
    );
    expect(factors).toEqual([totpFactor]);
    expect(getEnrolledTotpFactorsPoc()).toEqual([totpFactor]);
  });

  it('captures the original MFA error and exposes only TOTP hint summaries', () => {
    mocks.resolver.hints = [
      { ...totpFactor, uid: 'phone-1', factorId: 'phone' },
      totpFactor,
    ];
    const error = { code: 'auth/multi-factor-auth-required', customData: {} };

    const challenge = captureTotpMfaSignInPoc(error);

    expect(mocks.getResolver).toHaveBeenCalledWith(mocks.auth, error);
    expect(challenge.hints).toEqual([totpFactor]);
  });

  it('creates a sign-in assertion and resolves the Firebase session', async () => {
    captureTotpMfaSignInPoc({
      code: 'auth/multi-factor-auth-required',
      customData: {},
    });

    const credential = await resolveTotpMfaSignInPoc('totp-1', '654321');

    expect(mocks.assertionForSignIn).toHaveBeenCalledWith('totp-1', '654321');
    expect(mocks.resolver.resolveSignIn).toHaveBeenCalledWith({ factorId: 'totp' });
    expect(credential).toEqual({ user: mocks.auth.currentUser });
  });

  it('keeps the resolver available after an incorrect code so the user can retry', async () => {
    const invalidCode = { code: 'auth/invalid-verification-code' };
    captureTotpMfaSignInPoc({
      code: 'auth/multi-factor-auth-required',
      customData: {},
    });
    mocks.resolver.resolveSignIn.mockRejectedValueOnce(invalidCode);

    await expect(
      resolveTotpMfaSignInPoc('totp-1', '111111'),
    ).rejects.toBe(invalidCode);
    mocks.resolver.resolveSignIn.mockResolvedValueOnce({ user: mocks.auth.currentUser });
    await expect(
      resolveTotpMfaSignInPoc('totp-1', '222222'),
    ).resolves.toEqual({ user: mocks.auth.currentUser });
  });

  it('rejects missing hints and non-TOTP hints without starting a session', () => {
    mocks.resolver.hints = [];
    expect(() => captureTotpMfaSignInPoc({})).toThrowError(
      expect.objectContaining({ issue: 'resolverWithoutHints' }),
    );

    mocks.resolver.hints = [{ ...totpFactor, factorId: 'phone' }];
    expect(() => captureTotpMfaSignInPoc({})).toThrowError(
      expect.objectContaining({ issue: 'totpFactorMissing' }),
    );
  });
});

