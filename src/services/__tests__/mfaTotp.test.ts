import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestUser = {
  uid: string;
  email: string;
  emailVerified: boolean;
  reload: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => {
  const auth = { currentUser: null as TestUser | null };
  const mfa = {
    enrolledFactors: [] as Array<{
      uid: string;
      factorId: string;
      displayName: string | null;
      enrollmentTime: string;
    }>,
    enroll: vi.fn(),
    getSession: vi.fn(),
    unenroll: vi.fn(),
  };
  const resolver = {
    hints: [] as typeof mfa.enrolledFactors,
    resolveSignIn: vi.fn(),
  };
  return {
    assertionForEnrollment: vi.fn(),
    assertionForSignIn: vi.fn(),
    auth,
    generateSecret: vi.fn(),
    getResolver: vi.fn(() => resolver),
    mfa,
    multiFactor: vi.fn(() => mfa),
    reauthenticate: vi.fn(),
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
vi.mock('../reauthentication', () => ({
  reauthenticateCurrentUser: mocks.reauthenticate,
}));

import {
  clearTotpSignInChallenge,
  finishTotpEnrollment,
  finishTotpUnenrollment,
  refreshTotpFactors,
  resolveTotpSignIn,
  startTotpEnrollment,
  startTotpEnrollmentWithPassword,
  startTotpSignInChallenge,
  startTotpUnenrollment,
  startTotpUnenrollmentWithPassword,
} from '../mfaTotp';

const totpFactor = {
  uid: 'totp-1',
  factorId: 'totp',
  displayName: 'AJ Fit Authenticator',
  enrollmentTime: 'Mon, 10 Aug 2026 12:00:00 GMT',
};
const nonTotpFactor = { ...totpFactor, uid: 'phone-1', factorId: 'phone' };

describe('production TOTP service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTotpSignInChallenge();
    const user: TestUser = {
      uid: 'user-1',
      email: 'person@example.com',
      emailVerified: true,
      reload: vi.fn().mockResolvedValue(undefined),
    };
    mocks.auth.currentUser = user;
    mocks.mfa.enrolledFactors = [];
    mocks.mfa.getSession.mockResolvedValue({ session: 'opaque' });
    mocks.reauthenticate.mockResolvedValue(user);
    mocks.assertionForEnrollment.mockReturnValue({ kind: 'enrollment' });
    mocks.assertionForSignIn.mockReturnValue({ kind: 'sign-in' });
    mocks.generateSecret.mockResolvedValue({
      secretKey: 'IN_MEMORY_TEST_SECRET',
      enrollmentCompletionDeadline: '2999-08-10T12:05:00.000Z',
      generateQrCodeUrl: vi.fn(() => 'otpauth://totp/AJ%20Fit:test?secret=TEST'),
    });
    mocks.mfa.enroll.mockImplementation(async () => {
      mocks.mfa.enrolledFactors = [totpFactor];
    });
    mocks.mfa.unenroll.mockImplementation(async () => {
      mocks.mfa.enrolledFactors = [];
    });
    mocks.resolver.hints = [totpFactor];
    mocks.resolver.resolveSignIn.mockResolvedValue({ user });
  });

  it('derives disabled/enabled status by filtering only enrolled TOTP factors', async () => {
    mocks.mfa.enrolledFactors = [nonTotpFactor];
    await expect(refreshTotpFactors()).resolves.toEqual([]);
    mocks.mfa.enrolledFactors = [nonTotpFactor, totpFactor];
    await expect(refreshTotpFactors()).resolves.toEqual([totpFactor]);
  });

  it('reauthenticates before generating an in-memory secret and official URI', async () => {
    const draft = await startTotpEnrollmentWithPassword('current-password');
    expect(mocks.reauthenticate).toHaveBeenCalledWith({
      provider: 'password',
      password: 'current-password',
    });
    expect(mocks.mfa.getSession).toHaveBeenCalledOnce();
    expect(draft.secretKey).toBe('IN_MEMORY_TEST_SECRET');
    expect(draft.otpAuthUri).toMatch(/^otpauth:\/\//);
  });

  it.each(['google', 'apple'] as const)(
    '%s-only enrollment reauthenticates before generating the same TOTP secret',
    async (provider) => {
      const draft = await startTotpEnrollment({ provider });
      expect(mocks.reauthenticate).toHaveBeenCalledWith({ provider });
      expect(mocks.mfa.getSession).toHaveBeenCalledOnce();
      expect(mocks.generateSecret).toHaveBeenCalledOnce();
      expect(draft.userUid).toBe('user-1');
    },
  );

  it('does not return a secret if the current user changes during generation', async () => {
    mocks.generateSecret.mockImplementationOnce(async () => {
      mocks.auth.currentUser = {
        uid: 'user-2',
        email: 'other@example.com',
        emailVerified: true,
        reload: vi.fn(),
      };
      return {
        secretKey: 'DO_NOT_EXPOSE',
        enrollmentCompletionDeadline: '2999-08-10T12:05:00.000Z',
        generateQrCodeUrl: vi.fn(() => 'otpauth://do-not-expose'),
      };
    });

    await expect(
      startTotpEnrollment({ provider: 'google' }),
    ).rejects.toMatchObject({ issue: 'userMismatch' });
  });

  it('does not generate or enroll anything when federated reauth fails', async () => {
    const error = { issue: 'reauthFailed' };
    mocks.reauthenticate.mockRejectedValueOnce(error);
    await expect(
      startTotpEnrollment({ provider: 'google' }),
    ).rejects.toBe(error);
    expect(mocks.mfa.getSession).not.toHaveBeenCalled();
    expect(mocks.generateSecret).not.toHaveBeenCalled();
    expect(mocks.mfa.enroll).not.toHaveBeenCalled();
  });

  it('requires a verified email after reauthentication', async () => {
    mocks.auth.currentUser!.emailVerified = false;
    await expect(startTotpEnrollmentWithPassword('current-password')).rejects.toMatchObject({
      issue: 'emailUnverified',
    });
    expect(mocks.mfa.getSession).not.toHaveBeenCalled();
  });

  it('enrolls a valid code and refreshes the real factor list', async () => {
    const draft = await startTotpEnrollmentWithPassword('current-password');
    await expect(finishTotpEnrollment(draft, '123456')).resolves.toEqual([totpFactor]);
    expect(mocks.assertionForEnrollment).toHaveBeenCalledWith(draft.secret, '123456');
    expect(mocks.mfa.enroll).toHaveBeenCalledWith(
      { kind: 'enrollment' },
      'AJ Fit Authenticator',
    );
  });

  it('never silently adds another TOTP factor', async () => {
    mocks.mfa.enrolledFactors = [totpFactor];
    await expect(startTotpEnrollmentWithPassword('current-password')).rejects.toMatchObject({
      issue: 'alreadyEnabled',
    });
  });

  it('reauthenticates and unenrolls only the explicitly selected factor', async () => {
    const second = { ...totpFactor, uid: 'totp-2' };
    mocks.mfa.enrolledFactors = [totpFactor, second];
    mocks.mfa.unenroll.mockImplementation(async (factor) => {
      mocks.mfa.enrolledFactors = mocks.mfa.enrolledFactors.filter(
        (candidate) => candidate.uid !== factor.uid,
      );
    });

    const result = await startTotpUnenrollmentWithPassword('totp-2', 'password');
    expect(result).toEqual({ status: 'completed', factors: [totpFactor] });
    expect(mocks.mfa.unenroll).toHaveBeenCalledWith(second);
    expect(mocks.reauthenticate).toHaveBeenCalledWith(
      { provider: 'password', password: 'password' },
      {
      preserveMultiFactorError: true,
      },
    );
  });

  it.each(['google', 'apple'] as const)(
    '%s unenrollment requires federated reauth before touching the factor',
    async (provider) => {
      mocks.mfa.enrolledFactors = [totpFactor];
      await expect(
        startTotpUnenrollment('totp-1', { provider }),
      ).resolves.toEqual({ status: 'completed', factors: [] });
      expect(mocks.reauthenticate).toHaveBeenCalledWith(
        { provider },
        { preserveMultiFactorError: true },
      );
      expect(mocks.mfa.unenroll).toHaveBeenCalledWith(totpFactor);
    },
  );

  it('does not unenroll if the current user changes after reauthentication', async () => {
    const original = mocks.auth.currentUser!;
    mocks.mfa.enrolledFactors = [totpFactor];
    mocks.reauthenticate.mockImplementationOnce(async () => {
      mocks.auth.currentUser = {
        uid: 'user-2',
        email: 'other@example.com',
        emailVerified: true,
        reload: vi.fn(),
      };
      return original;
    });

    await expect(
      startTotpUnenrollment('totp-1', { provider: 'apple' }),
    ).rejects.toMatchObject({ issue: 'userMismatch' });
    expect(mocks.mfa.unenroll).not.toHaveBeenCalled();
  });

  it('does not alter enrolled factors when federated reauth fails', async () => {
    mocks.mfa.enrolledFactors = [totpFactor];
    const error = { issue: 'reauthFailed' };
    mocks.reauthenticate.mockRejectedValueOnce(error);
    await expect(
      startTotpUnenrollment('totp-1', { provider: 'apple' }),
    ).rejects.toBe(error);
    expect(mocks.mfa.unenroll).not.toHaveBeenCalled();
    expect(mocks.mfa.enrolledFactors).toEqual([totpFactor]);
  });

  it('resolves Firebase MFA reauthentication before unenrollment when required', async () => {
    mocks.mfa.enrolledFactors = [totpFactor];
    mocks.reauthenticate.mockRejectedValue({ code: 'auth/multi-factor-auth-required' });
    const start = await startTotpUnenrollmentWithPassword('totp-1', 'password');
    expect(start.status).toBe('challenge');
    if (start.status !== 'challenge') throw new Error('challenge expected');

    await expect(finishTotpUnenrollment(start.challenge, '654321')).resolves.toEqual([]);
    expect(mocks.assertionForSignIn).toHaveBeenCalledWith('totp-1', '654321');
    expect(mocks.resolver.resolveSignIn).toHaveBeenCalledWith({ kind: 'sign-in' });
    expect(mocks.mfa.unenroll).toHaveBeenCalledWith(totpFactor);
  });

  it.each(['google', 'apple'] as const)(
    'resolves the existing TOTP after %s reauth before unenrollment',
    async (provider) => {
      mocks.mfa.enrolledFactors = [totpFactor];
      mocks.reauthenticate.mockRejectedValue({
        code: 'auth/multi-factor-auth-required',
        customData: { opaque: true },
      });
      const start = await startTotpUnenrollment('totp-1', { provider });
      expect(start.status).toBe('challenge');
      if (start.status !== 'challenge') throw new Error('challenge expected');

      await expect(
        finishTotpUnenrollment(start.challenge, '654321'),
      ).resolves.toEqual([]);
      expect(mocks.reauthenticate).toHaveBeenCalledWith(
        { provider },
        { preserveMultiFactorError: true },
      );
      expect(mocks.resolver.resolveSignIn).toHaveBeenCalledOnce();
      expect(mocks.mfa.unenroll).toHaveBeenCalledWith(totpFactor);
    },
  );

  it('rejects null users and missing explicit factors without destructive calls', async () => {
    mocks.auth.currentUser = null;
    await expect(refreshTotpFactors()).rejects.toMatchObject({ issue: 'userMissing' });
    mocks.auth.currentUser = {
      uid: 'user-1',
      email: 'person@example.com',
      emailVerified: true,
      reload: vi.fn(),
    };
    await expect(startTotpUnenrollmentWithPassword('absent', 'password')).rejects.toMatchObject({
      issue: 'factorNotFound',
    });
    expect(mocks.mfa.unenroll).not.toHaveBeenCalled();
  });

  it('captures the original MFA error and exposes only safe TOTP hints', () => {
    mocks.resolver.hints = [
      { ...nonTotpFactor, displayName: 'Unsupported' },
      totpFactor,
      { ...totpFactor, uid: 'totp-2', displayName: null },
    ];
    const originalError = {
      code: 'auth/multi-factor-auth-required',
      customData: { opaque: true },
    };

    expect(startTotpSignInChallenge(originalError, 'google')).toEqual({
      origin: 'google',
      hints: [
        {
          uid: 'totp-1',
          displayName: 'AJ Fit Authenticator',
          enrollmentTime: totpFactor.enrollmentTime,
        },
        {
          uid: 'totp-2',
          displayName: null,
          enrollmentTime: totpFactor.enrollmentTime,
        },
      ],
    });
    expect(mocks.getResolver).toHaveBeenCalledWith(mocks.auth, originalError);
  });

  it('keeps the resolver after an incorrect OTP and clears it after success', async () => {
    startTotpSignInChallenge(
      { code: 'auth/multi-factor-auth-required' },
      'password',
    );
    const incorrect = { code: 'auth/invalid-verification-code' };
    mocks.resolver.resolveSignIn.mockRejectedValueOnce(incorrect);

    await expect(resolveTotpSignIn('totp-1', '111111')).rejects.toBe(incorrect);
    await expect(resolveTotpSignIn('totp-1', '222222')).resolves.toEqual({
      user: mocks.auth.currentUser,
    });
    expect(mocks.assertionForSignIn).toHaveBeenLastCalledWith('totp-1', '222222');
    await expect(resolveTotpSignIn('totp-1', '333333')).rejects.toMatchObject({
      issue: 'sessionExpired',
    });
  });

  it('clears the resolver on cancel', async () => {
    startTotpSignInChallenge(
      { code: 'auth/multi-factor-auth-required' },
      'apple',
    );
    clearTotpSignInChallenge();
    await expect(resolveTotpSignIn('totp-1', '123456')).rejects.toMatchObject({
      issue: 'sessionExpired',
    });
    expect(mocks.resolver.resolveSignIn).not.toHaveBeenCalled();
  });

  it('ignores unsupported factors and rejects a resolver without TOTP', () => {
    mocks.resolver.hints = [nonTotpFactor];
    expect(() =>
      startTotpSignInChallenge(
        { code: 'auth/multi-factor-auth-required' },
        'account-linking',
      ),
    ).toThrowError(expect.objectContaining({ issue: 'factorNotFound' }));

    mocks.resolver.hints = [];
    expect(() =>
      startTotpSignInChallenge(
        { code: 'auth/multi-factor-auth-required' },
        'password',
      ),
    ).toThrowError(expect.objectContaining({ issue: 'resolverWithoutHints' }));
  });
});
