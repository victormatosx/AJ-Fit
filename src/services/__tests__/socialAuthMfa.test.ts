import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appleCredential: { providerId: 'apple.com' },
  fetchMethods: vi.fn(),
  getAppleCredential: vi.fn(),
  getGoogleCredential: vi.fn(),
  googleCredential: { providerId: 'google.com' },
  linkWithCredential: vi.fn(),
  signInWithCredential: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(),
  fetchSignInMethodsForEmail: mocks.fetchMethods,
  linkWithCredential: mocks.linkWithCredential,
  onAuthStateChanged: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithCredential: mocks.signInWithCredential,
  signInWithEmailAndPassword: mocks.signInWithEmailAndPassword,
  signOut: vi.fn(),
  updateProfile: mocks.updateProfile,
}));

vi.mock('../../lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('../../lib/secureAuthStorage', () => ({
  clearSecureAuthSession: vi.fn(),
}));
vi.mock('../providers/google.native', () => ({
  getGoogleCredential: mocks.getGoogleCredential,
  isGoogleSigninAvailable: vi.fn(),
}));
vi.mock('../providers/apple.native', () => ({
  getAppleCredential: mocks.getAppleCredential,
  isAppleAuthAvailable: vi.fn(),
}));

import {
  AccountLinkingRequiredError,
  clearPendingSocialAuthState,
  completeLinkingWithPassword,
  completeLinkingWithProvider,
  finalizeSocialSignInAfterMfa,
  signInWithProvider,
} from '../socialAuth';

function user(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'user-1',
    displayName: 'Existing name',
    providerData: [],
    ...overrides,
  };
}

describe('Google/Apple sign-in MFA boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPendingSocialAuthState();
    mocks.getGoogleCredential.mockResolvedValue({
      credential: mocks.googleCredential,
      displayName: 'Google Person',
    });
    mocks.getAppleCredential.mockResolvedValue({
      credential: mocks.appleCredential,
      displayName: 'Apple Person',
    });
    mocks.linkWithCredential.mockImplementation(async (linkedUser) => ({
      user: linkedUser,
    }));
  });

  it.each([
    ['google', mocks.googleCredential],
    ['apple', mocks.appleCredential],
  ] as const)('keeps %s login unchanged when MFA is not required', async (provider, credential) => {
    const signedInUser = user();
    mocks.signInWithCredential.mockResolvedValueOnce({ user: signedInUser });

    await expect(signInWithProvider(provider)).resolves.toBe(signedInUser);
    expect(mocks.signInWithCredential).toHaveBeenCalledWith(
      expect.anything(),
      credential,
    );
  });

  it.each(['google', 'apple'] as const)(
    'preserves the original %s MFA error without acquiring the provider twice',
    async (provider) => {
      const original = {
        code: 'auth/multi-factor-auth-required',
        customData: { operationType: 'signIn', opaque: true },
      };
      mocks.signInWithCredential.mockRejectedValueOnce(original);

      await expect(signInWithProvider(provider)).rejects.toBe(original);
      const acquire =
        provider === 'google'
          ? mocks.getGoogleCredential
          : mocks.getAppleCredential;
      expect(acquire).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves account-exists linking separately from MFA', async () => {
    mocks.signInWithCredential.mockRejectedValueOnce({
      code: 'auth/account-exists-with-different-credential',
      customData: { email: 'person@example.com' },
    });
    mocks.fetchMethods.mockResolvedValueOnce(['password']);

    await expect(signInWithProvider('google')).rejects.toBeInstanceOf(
      AccountLinkingRequiredError,
    );
    expect(mocks.fetchMethods).toHaveBeenCalledWith(
      expect.anything(),
      'person@example.com',
    );
  });

  it('preserves MFA while authenticating the existing password account for linking', async () => {
    mocks.signInWithCredential.mockRejectedValueOnce({
      code: 'auth/account-exists-with-different-credential',
      customData: { email: 'person@example.com' },
    });
    mocks.fetchMethods.mockResolvedValueOnce(['password']);
    await expect(signInWithProvider('google')).rejects.toBeInstanceOf(
      AccountLinkingRequiredError,
    );

    const original = { code: 'auth/multi-factor-auth-required', customData: {} };
    mocks.signInWithEmailAndPassword.mockRejectedValueOnce(original);
    await expect(
      completeLinkingWithPassword('person@example.com', 'password'),
    ).rejects.toBe(original);
  });

  it('links the pending incoming credential after MFA resolves on the same user', async () => {
    mocks.signInWithCredential.mockRejectedValueOnce({
      code: 'auth/account-exists-with-different-credential',
      customData: { email: 'person@example.com' },
    });
    mocks.fetchMethods.mockResolvedValueOnce(['password']);
    await expect(signInWithProvider('google')).rejects.toBeInstanceOf(
      AccountLinkingRequiredError,
    );

    const resolvedUser = user();
    await expect(
      finalizeSocialSignInAfterMfa(resolvedUser as never, true),
    ).resolves.toBe(resolvedUser);
    expect(mocks.linkWithCredential).toHaveBeenCalledWith(
      resolvedUser,
      mocks.googleCredential,
    );
  });

  it('preserves MFA when the existing account is authenticated with Apple for linking', async () => {
    mocks.signInWithCredential.mockRejectedValueOnce({
      code: 'auth/account-exists-with-different-credential',
      customData: { email: 'person@example.com' },
    });
    mocks.fetchMethods.mockResolvedValueOnce(['apple.com']);
    await expect(signInWithProvider('google')).rejects.toBeInstanceOf(
      AccountLinkingRequiredError,
    );

    const original = { code: 'auth/multi-factor-auth-required', customData: {} };
    mocks.signInWithCredential.mockRejectedValueOnce(original);
    await expect(completeLinkingWithProvider('apple')).rejects.toBe(original);
    expect(mocks.getAppleCredential).toHaveBeenCalledTimes(1);
  });

  it('drops the pending linking credential when the flow is cancelled', async () => {
    mocks.signInWithCredential.mockRejectedValueOnce({
      code: 'auth/account-exists-with-different-credential',
      customData: { email: 'person@example.com' },
    });
    mocks.fetchMethods.mockResolvedValueOnce(['password']);
    await expect(signInWithProvider('google')).rejects.toBeInstanceOf(
      AccountLinkingRequiredError,
    );

    clearPendingSocialAuthState();
    await finalizeSocialSignInAfterMfa(user() as never, true);
    expect(mocks.linkWithCredential).not.toHaveBeenCalled();
  });

  it('restores Apple display-name behavior after its MFA resolver completes', async () => {
    const original = { code: 'auth/multi-factor-auth-required', customData: {} };
    mocks.signInWithCredential.mockRejectedValueOnce(original);
    await expect(signInWithProvider('apple')).rejects.toBe(original);

    const resolvedUser = user({ displayName: null });
    await finalizeSocialSignInAfterMfa(resolvedUser as never, false);
    expect(mocks.updateProfile).toHaveBeenCalledWith(resolvedUser, {
      displayName: 'Apple Person',
    });
  });
});
