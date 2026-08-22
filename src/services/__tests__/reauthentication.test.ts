import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SocialAuthCancelledError } from '../providers/types';

type TestUser = {
  uid: string;
  providerData: Array<{ providerId: string }>;
};

const mocks = vi.hoisted(() => ({
  appleCredential: { providerId: 'apple.com' },
  auth: { currentUser: null as TestUser | null },
  getAppleCredential: vi.fn(),
  getGoogleCredential: vi.fn(),
  googleCredential: { providerId: 'google.com' },
  passwordReauth: vi.fn(),
  reauthenticate: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  reauthenticateWithCredential: mocks.reauthenticate,
}));
vi.mock('../../lib/firebase', () => ({ auth: mocks.auth }));
vi.mock('../password', () => ({
  reauthenticatePasswordUser: mocks.passwordReauth,
}));
vi.mock('../providers/google.native', () => ({
  getGoogleCredential: mocks.getGoogleCredential,
}));
vi.mock('../providers/apple.native', () => ({
  getAppleCredential: mocks.getAppleCredential,
}));

import {
  ReauthenticationCancelledError,
  reauthenticateCurrentUser,
} from '../reauthentication';

function user(
  uid = 'user-1',
  providers = ['google.com', 'apple.com', 'password'],
): TestUser {
  return {
    uid,
    providerData: providers.map((providerId) => ({ providerId })),
  };
}

describe('current-user reauthentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.currentUser = user();
    mocks.getGoogleCredential.mockResolvedValue({
      credential: mocks.googleCredential,
      displayName: 'Ignored',
    });
    mocks.getAppleCredential.mockResolvedValue({
      credential: mocks.appleCredential,
      displayName: null,
    });
    mocks.passwordReauth.mockResolvedValue(mocks.auth.currentUser);
    mocks.reauthenticate.mockImplementation(async () => ({
      user: mocks.auth.currentUser,
    }));
  });

  it('reauthenticates a Google-only user without signing in or linking', async () => {
    mocks.auth.currentUser = user('user-1', ['google.com']);

    await expect(
      reauthenticateCurrentUser({ provider: 'google' }),
    ).resolves.toBe(mocks.auth.currentUser);
    expect(mocks.getGoogleCredential).toHaveBeenCalledOnce();
    expect(mocks.reauthenticate).toHaveBeenCalledWith(
      mocks.auth.currentUser,
      mocks.googleCredential,
    );
  });

  it('reauthenticates Apple without requesting name or email again', async () => {
    mocks.auth.currentUser = user('user-1', ['apple.com']);

    await reauthenticateCurrentUser({ provider: 'apple' });
    expect(mocks.getAppleCredential).toHaveBeenCalledWith({
      requestProfile: false,
    });
    expect(mocks.reauthenticate).toHaveBeenCalledWith(
      mocks.auth.currentUser,
      mocks.appleCredential,
    );
  });

  it('keeps password behavior delegated to the existing service', async () => {
    await reauthenticateCurrentUser({
      provider: 'password',
      password: 'current-password',
    });
    expect(mocks.passwordReauth).toHaveBeenCalledWith('current-password');
    expect(mocks.reauthenticate).not.toHaveBeenCalled();
  });

  it('rejects a method that is not linked before acquiring credentials', async () => {
    mocks.auth.currentUser = user('user-1', ['apple.com']);
    await expect(
      reauthenticateCurrentUser({ provider: 'google' }),
    ).rejects.toMatchObject({ issue: 'reauthProviderUnsupported' });
    expect(mocks.getGoogleCredential).not.toHaveBeenCalled();
    expect(mocks.reauthenticate).not.toHaveBeenCalled();
  });

  it('treats provider cancellation as a safe non-operation', async () => {
    mocks.auth.currentUser = user('user-1', ['google.com']);
    mocks.getGoogleCredential.mockRejectedValue(new SocialAuthCancelledError());

    await expect(
      reauthenticateCurrentUser({ provider: 'google' }),
    ).rejects.toBeInstanceOf(ReauthenticationCancelledError);
    expect(mocks.reauthenticate).not.toHaveBeenCalled();
  });

  it('aborts if the current UID changes while the provider sheet is open', async () => {
    const original = user('user-1', ['google.com']);
    mocks.auth.currentUser = original;
    mocks.getGoogleCredential.mockImplementation(async () => {
      mocks.auth.currentUser = user('user-2', ['google.com']);
      return { credential: mocks.googleCredential };
    });

    await expect(
      reauthenticateCurrentUser({ provider: 'google' }),
    ).rejects.toMatchObject({ issue: 'userMismatch' });
    expect(mocks.reauthenticate).not.toHaveBeenCalled();
  });

  it('rejects a credential result whose UID differs from the original UID', async () => {
    mocks.auth.currentUser = user('user-1', ['apple.com']);
    mocks.reauthenticate.mockResolvedValue({ user: user('user-2', ['apple.com']) });

    await expect(
      reauthenticateCurrentUser({ provider: 'apple' }),
    ).rejects.toMatchObject({ issue: 'userMismatch' });
  });

  it('normalizes an invalid federated credential without exposing it', async () => {
    mocks.auth.currentUser = user('user-1', ['apple.com']);
    mocks.reauthenticate.mockRejectedValue({ code: 'auth/invalid-credential' });

    await expect(
      reauthenticateCurrentUser({ provider: 'apple' }),
    ).rejects.toMatchObject({ issue: 'reauthFailed' });
  });
});
