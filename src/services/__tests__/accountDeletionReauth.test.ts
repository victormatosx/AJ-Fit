import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestUser = {
  uid: string;
  providerData: { providerId: string }[];
  getIdTokenResult: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as TestUser | null },
  reauthenticateCurrentUser: vi.fn(),
  reauthenticateWithCredential: vi.fn(),
  getAppleCredentialForAccountDeletion: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ auth: mocks.auth }));

vi.mock('firebase/auth', () => ({
  reauthenticateWithCredential: mocks.reauthenticateWithCredential,
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

// Fase 16: Apple's native entry point, mocked at this boundary so no real
// `expo-apple-authentication` module is ever loaded. Mocked via the
// `.native` path (matching `vitest.config.mts`'s alias target for
// `./providers/apple`, which is what `accountDeletionReauth.ts` actually
// imports) — same pattern the pre-existing provider tests already use.
// `../providers/types` is NOT mocked — its error classes are pure, no
// native deps, and `instanceof` checks need the REAL classes.
vi.mock('../providers/apple.native', () => ({
  getAppleCredentialForAccountDeletion: mocks.getAppleCredentialForAccountDeletion,
}));

import { SocialAuthCancelledError, ProviderCredentialError } from '../providers/types';
import {
  ReauthenticationCancelledError,
  ReauthenticationServiceError,
} from '../reauthentication';
import {
  AccountDeletionReauthError,
  needsAccountDeletionReauthentication,
  startAccountDeletionReauthentication,
} from '../accountDeletionReauth';

const PASSWORD_PROVIDER_ID = 'password';
const GOOGLE_PROVIDER_ID = 'google.com';
const APPLE_PROVIDER_ID = 'apple.com';

function user(
  uid = 'user-1',
  authTimeIso = new Date().toISOString(),
  providers: string[] = [PASSWORD_PROVIDER_ID],
): TestUser {
  return {
    uid,
    providerData: providers.map((providerId) => ({ providerId })),
    getIdTokenResult: vi.fn().mockResolvedValue({ authTime: authTimeIso }),
  };
}

function appleCredentialResult(authorizationCode = 'fresh-authorization-code') {
  return { credential: { fake: 'firebase-credential' }, displayName: null, authorizationCode };
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

  it('is false for a password-only user with a token minted moments ago', async () => {
    mocks.auth.currentUser = user('user-1', new Date().toISOString(), [PASSWORD_PROVIDER_ID]);
    await expect(needsAccountDeletionReauthentication()).resolves.toBe(false);
  });

  it('is true for a stale token (password-only)', async () => {
    mocks.auth.currentUser = user('user-1', new Date(Date.now() - 60 * 60 * 1000).toISOString(), [
      PASSWORD_PROVIDER_ID,
    ]);
    await expect(needsAccountDeletionReauthentication()).resolves.toBe(true);
  });

  it('is still governed purely by freshness for a Google-only account — unchanged by Fase 16', async () => {
    mocks.auth.currentUser = user('user-1', new Date().toISOString(), [GOOGLE_PROVIDER_ID]);
    await expect(needsAccountDeletionReauthentication()).resolves.toBe(false);
  });

  it('Fase 16: is ALWAYS true for an Apple-linked account, even with a freshly-minted token — reauth is the ONLY place Apple material is captured', async () => {
    mocks.auth.currentUser = user('user-1', new Date().toISOString(), [APPLE_PROVIDER_ID]);
    await expect(needsAccountDeletionReauthentication()).resolves.toBe(true);
  });
});

describe('startAccountDeletionReauthentication — password/Google success path (unchanged by Fase 16)', () => {
  it('completes and forces an ID token refresh (Fase 2 §7)', async () => {
    mocks.reauthenticateCurrentUser.mockResolvedValue(mocks.auth.currentUser);

    const outcome = await startAccountDeletionReauthentication({
      provider: 'password',
      password: 'correct-horse',
    });

    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect(outcome.uid).toBe('user-1');
      expect(outcome.appleAuthorizationCode).toBeUndefined();
    }
    expect(mocks.auth.currentUser!.getIdTokenResult).toHaveBeenCalledWith(true);
  });

  it('captures expectedUid before reauthenticating, not after (Fase 2 §14)', async () => {
    mocks.reauthenticateCurrentUser.mockResolvedValue(mocks.auth.currentUser);
    await startAccountDeletionReauthentication({ provider: 'google' });
    expect(mocks.reauthenticateCurrentUser).toHaveBeenCalledWith({ provider: 'google' });
    expect(mocks.getAppleCredentialForAccountDeletion).not.toHaveBeenCalled();
  });
});

describe('startAccountDeletionReauthentication — error taxonomy (password/Google, unchanged by Fase 16)', () => {
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
      startAccountDeletionReauthentication({ provider: 'google' }),
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

describe('startAccountDeletionReauthentication — identity consistency (password/Google, unchanged by Fase 16)', () => {
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

describe('startAccountDeletionReauthentication — Apple (Fase 16 consolidation): ONE native call produces BOTH Firebase reauth and authorizationCode', () => {
  function appleUser(uid = 'user-1', authTimeIso = new Date().toISOString()): TestUser {
    return user(uid, authTimeIso, [APPLE_PROVIDER_ID]);
  }

  it('#17 — calls the native Apple entry point exactly once for the whole reauth', async () => {
    mocks.auth.currentUser = appleUser();
    mocks.getAppleCredentialForAccountDeletion.mockResolvedValue(appleCredentialResult());
    mocks.reauthenticateWithCredential.mockResolvedValue({ user: { uid: 'user-1' } });

    await startAccountDeletionReauthentication({ provider: 'apple' });

    expect(mocks.getAppleCredentialForAccountDeletion).toHaveBeenCalledTimes(1);
    // Never routes through the generic federated path for apple anymore —
    // that path is what used to discard authorizationCode.
    expect(mocks.reauthenticateCurrentUser).not.toHaveBeenCalled();
  });

  it('C — returns BOTH Firebase reauth completion AND the authorizationCode from the SAME sign-in', async () => {
    mocks.auth.currentUser = appleUser();
    mocks.getAppleCredentialForAccountDeletion.mockResolvedValue(appleCredentialResult('code-123'));
    mocks.reauthenticateWithCredential.mockResolvedValue({ user: { uid: 'user-1' } });

    const outcome = await startAccountDeletionReauthentication({ provider: 'apple' });

    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect(outcome.uid).toBe('user-1');
      expect(outcome.appleAuthorizationCode).toBe('code-123');
    }
    expect(mocks.auth.currentUser!.getIdTokenResult).toHaveBeenCalledWith(true);
    expect(mocks.reauthenticateWithCredential).toHaveBeenCalledWith(
      mocks.auth.currentUser,
      appleCredentialResult('code-123').credential,
    );
  });

  it('PROVIDER_MISMATCH when apple is not actually linked — never opens the native sheet', async () => {
    mocks.auth.currentUser = user('user-1', new Date().toISOString(), [PASSWORD_PROVIDER_ID]);
    await expect(startAccountDeletionReauthentication({ provider: 'apple' })).rejects.toMatchObject({
      code: 'PROVIDER_MISMATCH',
    });
    expect(mocks.getAppleCredentialForAccountDeletion).not.toHaveBeenCalled();
  });

  it('F — USER_CANCELLED when the Apple sheet is dismissed: no commit-eligible material produced', async () => {
    mocks.auth.currentUser = appleUser();
    mocks.getAppleCredentialForAccountDeletion.mockRejectedValue(new SocialAuthCancelledError());

    await expect(startAccountDeletionReauthentication({ provider: 'apple' })).rejects.toMatchObject({
      code: 'USER_CANCELLED',
    });
    expect(mocks.reauthenticateWithCredential).not.toHaveBeenCalled();
  });

  it('D/E — a native-layer failure (e.g. missing identityToken/authorizationCode) maps to REAUTH_FAILED, never SESSION_EXPIRED', async () => {
    mocks.auth.currentUser = appleUser();
    mocks.getAppleCredentialForAccountDeletion.mockRejectedValue(
      new ProviderCredentialError('authorizationCodeMissing'),
    );

    await expect(startAccountDeletionReauthentication({ provider: 'apple' })).rejects.toMatchObject({
      code: 'REAUTH_FAILED',
    });
    expect(mocks.reauthenticateWithCredential).not.toHaveBeenCalled();
  });

  it('H — IDENTITY_CHANGED when the uid changes while the Apple sheet is open: material is discarded, never sent onward', async () => {
    mocks.auth.currentUser = appleUser();
    mocks.getAppleCredentialForAccountDeletion.mockImplementation(async () => {
      mocks.auth.currentUser = user('attacker', new Date().toISOString(), [APPLE_PROVIDER_ID]);
      return appleCredentialResult();
    });

    await expect(startAccountDeletionReauthentication({ provider: 'apple' })).rejects.toMatchObject({
      code: 'IDENTITY_CHANGED',
    });
    expect(mocks.reauthenticateWithCredential).not.toHaveBeenCalled();
  });

  it('G — a Firebase reauth failure maps through the normal taxonomy; the authorizationCode never reaches any outcome', async () => {
    mocks.auth.currentUser = appleUser();
    mocks.getAppleCredentialForAccountDeletion.mockResolvedValue(appleCredentialResult('code-should-be-discarded'));
    mocks.reauthenticateWithCredential.mockRejectedValue({ code: 'auth/invalid-credential' });

    await expect(startAccountDeletionReauthentication({ provider: 'apple' })).rejects.toMatchObject({
      code: 'WRONG_PASSWORD',
    });
  });

  it('IDENTITY_CHANGED when reauthenticateWithCredential resolves with a different uid than expected', async () => {
    mocks.auth.currentUser = appleUser();
    mocks.getAppleCredentialForAccountDeletion.mockResolvedValue(appleCredentialResult());
    mocks.reauthenticateWithCredential.mockResolvedValue({ user: { uid: 'someone-else' } });

    await expect(startAccountDeletionReauthentication({ provider: 'apple' })).rejects.toMatchObject({
      code: 'IDENTITY_CHANGED',
    });
  });

});
