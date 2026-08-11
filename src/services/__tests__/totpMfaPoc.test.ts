import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const resolver = {
    hints: [] as Array<{
      uid: string;
      factorId: string;
      displayName: string | null;
      enrollmentTime: string;
    }>,
    resolveSignIn: vi.fn(),
  };
  return {
    assertionForSignIn: vi.fn(),
    auth: {},
    getResolver: vi.fn(() => resolver),
    resolver,
  };
});

vi.mock('firebase/auth', () => ({
  getMultiFactorResolver: mocks.getResolver,
  TotpMultiFactorGenerator: {
    assertionForSignIn: mocks.assertionForSignIn,
  },
}));

vi.mock('../../lib/firebase', () => ({ auth: mocks.auth }));

import {
  captureTotpMfaSignInPoc,
  clearPendingTotpMfaSignInPoc,
  resolveTotpMfaSignInPoc,
} from '../totpMfaPoc';

const factor = {
  uid: 'totp-1',
  factorId: 'totp',
  displayName: 'AJ Fit Authenticator',
  enrollmentTime: 'Mon, 10 Aug 2026 12:00:00 GMT',
};

describe('temporary TOTP sign-in challenge bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPendingTotpMfaSignInPoc();
    mocks.resolver.hints = [factor];
    mocks.assertionForSignIn.mockReturnValue({ factorId: 'totp' });
    mocks.resolver.resolveSignIn.mockResolvedValue({ user: { uid: 'user-1' } });
  });

  it('captures the original MFA error and exposes only TOTP hints', () => {
    mocks.resolver.hints = [
      { ...factor, uid: 'phone-1', factorId: 'phone' },
      factor,
    ];
    const error = { code: 'auth/multi-factor-auth-required', customData: {} };

    expect(captureTotpMfaSignInPoc(error).hints).toEqual([factor]);
    expect(mocks.getResolver).toHaveBeenCalledWith(mocks.auth, error);
  });

  it('resolves with an explicit TOTP hint and keeps resolver for code retry', async () => {
    captureTotpMfaSignInPoc({ code: 'auth/multi-factor-auth-required' });
    const invalidCode = { code: 'auth/invalid-verification-code' };
    mocks.resolver.resolveSignIn.mockRejectedValueOnce(invalidCode);

    await expect(resolveTotpMfaSignInPoc('totp-1', '111111')).rejects.toBe(invalidCode);
    await expect(resolveTotpMfaSignInPoc('totp-1', '222222')).resolves.toEqual({
      user: { uid: 'user-1' },
    });
    expect(mocks.assertionForSignIn).toHaveBeenLastCalledWith('totp-1', '222222');
  });

  it('rejects absent hints and unsupported hint types', () => {
    mocks.resolver.hints = [];
    expect(() => captureTotpMfaSignInPoc({})).toThrowError(
      expect.objectContaining({ issue: 'resolverWithoutHints' }),
    );

    mocks.resolver.hints = [{ ...factor, factorId: 'phone' }];
    expect(() => captureTotpMfaSignInPoc({})).toThrowError(
      expect.objectContaining({ issue: 'factorNotFound' }),
    );
  });
});
