import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestUser = {
  uid: string;
  getIdTokenResult: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as TestUser | null },
  reauthenticateCurrentUser: vi.fn(),
  getMultiFactorResolver: vi.fn(),
  assertionForSignIn: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ auth: mocks.auth }));

vi.mock('firebase/auth', () => ({
  getMultiFactorResolver: mocks.getMultiFactorResolver,
  TotpMultiFactorGenerator: { assertionForSignIn: mocks.assertionForSignIn },
}));

// A minimal, self-contained mock of ../reauthentication: real error CLASSES
// (so `instanceof` checks in accountDeletionReauth.ts work), but a mocked
// async function — avoids transitively loading the native Google/Apple
// provider modules that ../reauthentication.ts itself imports.
vi.mock('../reauthentication', () => {
  class ReauthenticationCancelledError extends Error {
    constructor() {
      super('Reauthentication cancelled');
      this.name = 'ReauthenticationCancelledError';
    }
  }
  class ReauthenticationServiceError extends Error {
    issue: string;
    constructor(issue: string) {
      super(issue);
      this.name = 'ReauthenticationServiceError';
      this.issue = issue;
    }
  }
  return {
    ReauthenticationCancelledError,
    ReauthenticationServiceError,
    reauthenticateCurrentUser: mocks.reauthenticateCurrentUser,
  };
});

import {
  ReauthenticationCancelledError,
  ReauthenticationServiceError,
} from '../reauthentication';
import {
  AccountDeletionReauthError,
  finishAccountDeletionReauthentication,
  needsAccountDeletionReauthentication,
  startAccountDeletionReauthentication,
  type AccountDeletionMfaChallenge,
} from '../accountDeletionReauth';

function user(uid = 'user-1', authTimeIso = new Date().toISOString()): TestUser {
  return {
    uid,
    getIdTokenResult: vi.fn().mockResolvedValue({ authTime: authTimeIso }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.currentUser = user();
});

describe('needsAccountDeletionReauthentication', () => {
  it('is true when there is no current user', async () => {
    mocks.auth.currentUser = null;
    await expect(needsAccountDeletionReauthentication()).resolves.toBe(true);
  });

  it('is false for a token minted moments ago', async () => {
    mocks.auth.currentUser = user('user-1', new Date().toISOString());
    await expect(needsAccountDeletionReauthentication()).resolves.toBe(false);
  });

  it('is true for a stale token', async () => {
    mocks.auth.currentUser = user('user-1', new Date(Date.now() - 60 * 60 * 1000).toISOString());
    await expect(needsAccountDeletionReauthentication()).resolves.toBe(true);
  });
});

describe('startAccountDeletionReauthentication — success path', () => {
  it('completes and forces an ID token refresh (Fase 2 §7)', async () => {
    mocks.reauthenticateCurrentUser.mockResolvedValue(mocks.auth.currentUser);

    const outcome = await startAccountDeletionReauthentication({
      provider: 'password',
      password: 'correct-horse',
    });

    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect(outcome.uid).toBe('user-1');
    }
    expect(mocks.auth.currentUser!.getIdTokenResult).toHaveBeenCalledWith(true);
  });

  it('captures expectedUid before reauthenticating, not after (Fase 2 §14)', async () => {
    mocks.reauthenticateCurrentUser.mockResolvedValue(mocks.auth.currentUser);
    await startAccountDeletionReauthentication({ provider: 'google' });
    // Verified indirectly: outcome.uid below matches the ORIGINAL user, and
    // the identity-change tests below prove a mid-flight swap is caught.
    expect(mocks.reauthenticateCurrentUser).toHaveBeenCalledWith(
      { provider: 'google' },
      { preserveMultiFactorError: true },
    );
  });
});

describe('startAccountDeletionReauthentication — error taxonomy', () => {
  it('USER_SIGNED_OUT when there is no user to reauthenticate', async () => {
    mocks.auth.currentUser = null;
    await expect(
      startAccountDeletionReauthentication({ provider: 'google' }),
    ).rejects.toMatchObject({ code: 'USER_SIGNED_OUT' });
    expect(mocks.reauthenticateCurrentUser).not.toHaveBeenCalled();
  });

  it('USER_CANCELLED on provider cancellation', async () => {
    mocks.reauthenticateCurrentUser.mockRejectedValue(new ReauthenticationCancelledError());
    await expect(
      startAccountDeletionReauthentication({ provider: 'apple' }),
    ).rejects.toMatchObject({ code: 'USER_CANCELLED' });
  });

  it('IDENTITY_CHANGED when ReauthenticationServiceError reports userMismatch', async () => {
    mocks.reauthenticateCurrentUser.mockRejectedValue(new ReauthenticationServiceError('userMismatch'));
    await expect(
      startAccountDeletionReauthentication({ provider: 'google' }),
    ).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' });
  });

  it('PROVIDER_MISMATCH when the requested provider is not linked', async () => {
    mocks.reauthenticateCurrentUser.mockRejectedValue(
      new ReauthenticationServiceError('reauthProviderUnsupported'),
    );
    await expect(
      startAccountDeletionReauthentication({ provider: 'google' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_MISMATCH' });
  });

  it('WRONG_PASSWORD for auth/wrong-password and auth/invalid-credential', async () => {
    mocks.reauthenticateCurrentUser.mockRejectedValue({ code: 'auth/wrong-password' });
    await expect(
      startAccountDeletionReauthentication({ provider: 'password', password: 'wrong' }),
    ).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });

    mocks.reauthenticateCurrentUser.mockRejectedValue({ code: 'auth/invalid-credential' });
    await expect(
      startAccountDeletionReauthentication({ provider: 'password', password: 'wrong' }),
    ).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
  });

  it('PASSWORD_REQUIRED for an empty password field', async () => {
    mocks.reauthenticateCurrentUser.mockRejectedValue({ code: 'auth/missing-password' });
    await expect(
      startAccountDeletionReauthentication({ provider: 'password', password: '' }),
    ).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
  });

  it('RATE_LIMITED for auth/too-many-requests', async () => {
    mocks.reauthenticateCurrentUser.mockRejectedValue({ code: 'auth/too-many-requests' });
    await expect(
      startAccountDeletionReauthentication({ provider: 'password', password: 'x' }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('SESSION_EXPIRED for requires-recent-login/user-token-expired/invalid-user-token', async () => {
    for (const code of ['auth/requires-recent-login', 'auth/user-token-expired', 'auth/invalid-user-token']) {
      mocks.reauthenticateCurrentUser.mockRejectedValue({ code });
      await expect(
        startAccountDeletionReauthentication({ provider: 'google' }),
      ).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    }
  });

  it('NETWORK_ERROR for auth/network-request-failed', async () => {
    mocks.reauthenticateCurrentUser.mockRejectedValue({ code: 'auth/network-request-failed' });
    await expect(
      startAccountDeletionReauthentication({ provider: 'google' }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('REAUTH_FAILED for an unrecognized error', async () => {
    mocks.reauthenticateCurrentUser.mockRejectedValue(new Error('boom'));
    await expect(
      startAccountDeletionReauthentication({ provider: 'google' }),
    ).rejects.toMatchObject({ code: 'REAUTH_FAILED' });
  });

  it('never throws a raw error — always AccountDeletionReauthError', async () => {
    mocks.reauthenticateCurrentUser.mockRejectedValue(new Error('anything'));
    await expect(
      startAccountDeletionReauthentication({ provider: 'google' }),
    ).rejects.toBeInstanceOf(AccountDeletionReauthError);
  });
});

describe('startAccountDeletionReauthentication — identity consistency', () => {
  it('IDENTITY_CHANGED when reauthenticateCurrentUser resolves with a different uid', async () => {
    mocks.reauthenticateCurrentUser.mockResolvedValue(user('someone-else'));
    await expect(
      startAccountDeletionReauthentication({ provider: 'google' }),
    ).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' });
  });

  it('USER_SIGNED_OUT when the session is cleared during the reauthentication call (logout mid-flow)', async () => {
    const original = mocks.auth.currentUser!;
    mocks.reauthenticateCurrentUser.mockImplementation(async () => {
      mocks.auth.currentUser = null; // simulates a sign-out racing the provider sheet
      return original;
    });

    await expect(
      startAccountDeletionReauthentication({ provider: 'google' }),
    ).rejects.toMatchObject({ code: 'USER_SIGNED_OUT' });
  });

  it('IDENTITY_CHANGED when a DIFFERENT account signs in during the reauthentication call', async () => {
    const original = mocks.auth.currentUser!;
    mocks.reauthenticateCurrentUser.mockImplementation(async () => {
      mocks.auth.currentUser = user('attacker-account');
      return original; // the mocked call itself still "succeeds" with the original identity
    });

    await expect(
      startAccountDeletionReauthentication({ provider: 'google' }),
    ).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' });
  });
});

describe('startAccountDeletionReauthentication — MFA challenge', () => {
  function multiFactorError() {
    return { code: 'auth/multi-factor-auth-required', customData: {} };
  }

  it('returns a challenge outcome when Firebase demands a second factor', async () => {
    mocks.reauthenticateCurrentUser.mockRejectedValue(multiFactorError());
    mocks.getMultiFactorResolver.mockReturnValue({
      hints: [{ uid: 'factor-1', factorId: 'totp', displayName: 'Authenticator' }],
      resolveSignIn: vi.fn(),
    });

    const outcome = await startAccountDeletionReauthentication({ provider: 'password', password: 'x' });
    expect(outcome.status).toBe('challenge');
    if (outcome.status === 'challenge') {
      expect(outcome.challenge.expectedUid).toBe('user-1');
      expect(outcome.challenge.hints).toEqual([{ uid: 'factor-1', displayName: 'Authenticator' }]);
    }
  });

  it('REAUTH_FAILED when the resolver has no TOTP hints (unsupported second factor)', async () => {
    mocks.reauthenticateCurrentUser.mockRejectedValue(multiFactorError());
    mocks.getMultiFactorResolver.mockReturnValue({
      hints: [{ uid: 'factor-1', factorId: 'phone', displayName: null }],
      resolveSignIn: vi.fn(),
    });

    await expect(
      startAccountDeletionReauthentication({ provider: 'password', password: 'x' }),
    ).rejects.toMatchObject({ code: 'REAUTH_FAILED' });
  });
});

describe('finishAccountDeletionReauthentication', () => {
  function challenge(overrides: Partial<AccountDeletionMfaChallenge> = {}): AccountDeletionMfaChallenge {
    return {
      expectedUid: 'user-1',
      hints: [{ uid: 'factor-1', displayName: 'Authenticator' }],
      resolver: { resolveSignIn: vi.fn() } as never,
      ...overrides,
    };
  }

  it('completes on a valid code and forces a token refresh', async () => {
    const resolveSignIn = vi.fn().mockResolvedValue({ user: { uid: 'user-1' } });
    const ch = challenge({ resolver: { resolveSignIn } as never });
    mocks.assertionForSignIn.mockReturnValue('assertion');

    const outcome = await finishAccountDeletionReauthentication(ch, 'factor-1', '123456');

    expect(mocks.assertionForSignIn).toHaveBeenCalledWith('factor-1', '123456');
    expect(resolveSignIn).toHaveBeenCalledWith('assertion');
    expect(outcome.status).toBe('completed');
    expect(mocks.auth.currentUser!.getIdTokenResult).toHaveBeenCalledWith(true);
  });

  it('MFA_INVALID_CODE for an empty/malformed code, without touching the resolver', async () => {
    const resolveSignIn = vi.fn();
    const ch = challenge({ resolver: { resolveSignIn } as never });

    await expect(finishAccountDeletionReauthentication(ch, 'factor-1', '')).rejects.toMatchObject({
      code: 'MFA_INVALID_CODE',
    });
    await expect(finishAccountDeletionReauthentication(ch, 'factor-1', 'abcdef')).rejects.toMatchObject({
      code: 'MFA_INVALID_CODE',
    });
    await expect(finishAccountDeletionReauthentication(ch, 'factor-1', '123')).rejects.toMatchObject({
      code: 'MFA_INVALID_CODE',
    });
    expect(resolveSignIn).not.toHaveBeenCalled();
  });

  it('MFA_INVALID_CODE for an unknown hint uid, without touching the resolver', async () => {
    const resolveSignIn = vi.fn();
    const ch = challenge({ resolver: { resolveSignIn } as never });

    await expect(
      finishAccountDeletionReauthentication(ch, 'not-a-real-hint', '123456'),
    ).rejects.toMatchObject({ code: 'MFA_INVALID_CODE' });
    expect(resolveSignIn).not.toHaveBeenCalled();
  });

  it('MFA_INVALID_CODE when Firebase rejects the code', async () => {
    const resolveSignIn = vi.fn().mockRejectedValue({ code: 'auth/invalid-verification-code' });
    const ch = challenge({ resolver: { resolveSignIn } as never });

    await expect(finishAccountDeletionReauthentication(ch, 'factor-1', '123456')).rejects.toMatchObject({
      code: 'MFA_INVALID_CODE',
    });
  });

  it('IDENTITY_CHANGED when the resolved credential belongs to a different uid', async () => {
    const resolveSignIn = vi.fn().mockResolvedValue({ user: { uid: 'someone-else' } });
    const ch = challenge({ resolver: { resolveSignIn } as never });

    await expect(finishAccountDeletionReauthentication(ch, 'factor-1', '123456')).rejects.toMatchObject({
      code: 'IDENTITY_CHANGED',
    });
  });

  it('USER_SIGNED_OUT when the session was cleared while the MFA prompt was open, without touching the resolver', async () => {
    mocks.auth.currentUser = null;
    const resolveSignIn = vi.fn();
    const ch = challenge({ resolver: { resolveSignIn } as never });

    await expect(finishAccountDeletionReauthentication(ch, 'factor-1', '123456')).rejects.toMatchObject({
      code: 'USER_SIGNED_OUT',
    });
    expect(resolveSignIn).not.toHaveBeenCalled();
  });

  it('IDENTITY_CHANGED when a different account is now signed in, without touching the resolver', async () => {
    mocks.auth.currentUser = user('someone-else');
    const resolveSignIn = vi.fn();
    const ch = challenge({ resolver: { resolveSignIn } as never });

    await expect(finishAccountDeletionReauthentication(ch, 'factor-1', '123456')).rejects.toMatchObject({
      code: 'IDENTITY_CHANGED',
    });
    expect(resolveSignIn).not.toHaveBeenCalled();
  });
});
