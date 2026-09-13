import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appleCredential: { providerId: 'apple.com' },
  deleteUser: vi.fn(),
  fetchMethods: vi.fn(),
  getAdditionalUserInfo: vi.fn(),
  getAppleCredential: vi.fn(),
  getGoogleCredential: vi.fn(),
  googleCredential: { providerId: 'google.com' },
  linkWithCredential: vi.fn(),
  signInWithCredential: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(),
  deleteUser: mocks.deleteUser,
  fetchSignInMethodsForEmail: mocks.fetchMethods,
  getAdditionalUserInfo: mocks.getAdditionalUserInfo,
  linkWithCredential: mocks.linkWithCredential,
  onAuthStateChanged: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithCredential: mocks.signInWithCredential,
  signInWithEmailAndPassword: mocks.signInWithEmailAndPassword,
  signOut: mocks.signOut,
  updateProfile: mocks.updateProfile,
}));
vi.mock('../../lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('../../lib/secureAuthStorage', () => ({ clearSecureAuthSession: vi.fn() }));
vi.mock('../../lib/photoVaultKeyStorage', () => ({ deleteVaultKey: vi.fn() }));
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
  discardNewSocialIdentity,
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

async function startPendingGoogleLink() {
  mocks.signInWithCredential.mockRejectedValueOnce({
    code: 'auth/account-exists-with-different-credential',
    customData: { email: 'person@example.com' },
  });
  mocks.fetchMethods.mockResolvedValueOnce(['password']);
  await expect(signInWithProvider('google')).rejects.toBeInstanceOf(
    AccountLinkingRequiredError,
  );
}

describe('Google/Apple sign-in and account linking', () => {
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
    mocks.getAdditionalUserInfo.mockReturnValue({ isNewUser: false });
  });

  it.each([
    ['google', mocks.googleCredential],
    ['apple', mocks.appleCredential],
  ] as const)('signs in with %s through its acquired Firebase credential', async (provider, credential) => {
    const signedInUser = user();
    mocks.signInWithCredential.mockResolvedValueOnce({ user: signedInUser });

    await expect(signInWithProvider(provider)).resolves.toEqual({
      user: signedInUser,
      isNewUser: false,
    });
    expect(mocks.signInWithCredential).toHaveBeenCalledWith(expect.anything(), credential);
  });

  it.each(['google', 'apple'] as const)(
    'reports a first %s credential sign-in as a new Firebase user',
    async (provider) => {
      const signedInUser = user();
      const userCredential = { user: signedInUser };
      mocks.signInWithCredential.mockResolvedValueOnce(userCredential);
      mocks.getAdditionalUserInfo.mockReturnValueOnce({ isNewUser: true });

      await expect(signInWithProvider(provider)).resolves.toEqual({
        user: signedInUser,
        isNewUser: true,
      });
      expect(mocks.getAdditionalUserInfo).toHaveBeenCalledWith(userCredential);
    },
  );

  it('keeps account-exists detection and method discovery intact', async () => {
    await startPendingGoogleLink();
    expect(mocks.fetchMethods).toHaveBeenCalledWith(
      expect.anything(),
      'person@example.com',
    );
  });

  it('links the pending Google credential to the existing password user', async () => {
    await startPendingGoogleLink();
    const existingUser = user();
    mocks.signInWithEmailAndPassword.mockResolvedValueOnce({ user: existingUser });

    await expect(
      completeLinkingWithPassword('person@example.com', 'password'),
    ).resolves.toBe(existingUser);
    expect(mocks.linkWithCredential).toHaveBeenCalledWith(
      existingUser,
      mocks.googleCredential,
    );
  });

  it('links the pending Google credential after authenticating with Apple', async () => {
    await startPendingGoogleLink();
    const existingUser = user();
    mocks.signInWithCredential.mockResolvedValueOnce({ user: existingUser });

    await expect(completeLinkingWithProvider('apple')).resolves.toBe(existingUser);
    expect(mocks.linkWithCredential).toHaveBeenCalledWith(
      existingUser,
      mocks.googleCredential,
    );
  });

  it('drops a pending credential when the linking flow is cancelled', async () => {
    await startPendingGoogleLink();
    clearPendingSocialAuthState();
    const existingUser = user();
    mocks.signInWithEmailAndPassword.mockResolvedValueOnce({ user: existingUser });

    await expect(
      completeLinkingWithPassword('person@example.com', 'password'),
    ).resolves.toBe(existingUser);
    expect(mocks.linkWithCredential).not.toHaveBeenCalled();
  });

  it('preserves Apple display-name provisioning on first sign-in', async () => {
    const signedInUser = user({ displayName: null });
    mocks.signInWithCredential.mockResolvedValueOnce({ user: signedInUser });

    await signInWithProvider('apple');
    expect(mocks.updateProfile).toHaveBeenCalledWith(signedInUser, {
      displayName: 'Apple Person',
    });
  });

  it('still classifies a new identity when the optional display-name update fails', async () => {
    const signedInUser = user({ displayName: null });
    mocks.signInWithCredential.mockResolvedValueOnce({ user: signedInUser });
    mocks.getAdditionalUserInfo.mockReturnValueOnce({ isNewUser: true });
    mocks.updateProfile.mockRejectedValueOnce(new Error('profile update failed'));

    await expect(signInWithProvider('apple')).resolves.toEqual({
      user: signedInUser,
      isNewUser: true,
    });
  });

  it('deletes a newly-created social identity when registration is abandoned', async () => {
    const incompleteUser = user();

    await discardNewSocialIdentity(incompleteUser as never);

    expect(mocks.deleteUser).toHaveBeenCalledWith(incompleteUser);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('signs out and surfaces cleanup failure when deleting the new identity fails', async () => {
    const incompleteUser = user();
    mocks.deleteUser.mockRejectedValueOnce({ code: 'auth/network-request-failed' });

    await expect(discardNewSocialIdentity(incompleteUser as never)).rejects.toMatchObject({
      code: 'auth/network-request-failed',
    });

    expect(mocks.signOut).toHaveBeenCalled();
  });
});
