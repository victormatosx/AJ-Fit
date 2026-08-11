import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as TestUser | null },
  credential: vi.fn(),
  log: vi.fn(),
  reauthenticate: vi.fn(),
  update: vi.fn(),
}));

type TestUser = {
  uid: string;
  email: string | null;
  providerData: Array<{ providerId: string }>;
};

vi.mock('firebase/auth', () => ({
  EmailAuthProvider: { credential: mocks.credential },
  reauthenticateWithCredential: mocks.reauthenticate,
  updatePassword: mocks.update,
}));

vi.mock('../../lib/firebase', () => ({ auth: mocks.auth }));

vi.mock('../auth', () => ({
  logAuthError: mocks.log,
  toAuthError: (error: unknown) => error,
}));

import { changePasswordWithReauthentication } from '../password';

const input = {
  currentPassword: 'old-pass',
  newPassword: 'new-pass',
  confirmation: 'new-pass',
};

function user(providers = ['password']): TestUser {
  return {
    uid: 'user-1',
    email: 'person@example.com',
    providerData: providers.map((providerId) => ({ providerId })),
  };
}

describe('changePasswordWithReauthentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.currentUser = user();
    mocks.credential.mockReturnValue({ credential: true });
    mocks.reauthenticate.mockImplementation(async () => ({
      user: mocks.auth.currentUser,
    }));
    mocks.update.mockResolvedValue(undefined);
  });

  it('reauthenticates before updating the password', async () => {
    mocks.auth.currentUser = user(['google.com', 'apple.com', 'password']);

    await changePasswordWithReauthentication(input);

    expect(mocks.credential).toHaveBeenCalledWith(
      'person@example.com',
      'old-pass',
    );
    expect(mocks.reauthenticate).toHaveBeenCalledWith(
      mocks.auth.currentUser,
      { credential: true },
    );
    expect(mocks.update).toHaveBeenCalledWith(mocks.auth.currentUser, 'new-pass');
    expect(mocks.reauthenticate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.update.mock.invocationCallOrder[0],
    );
  });

  it.each([
    null,
    user(['google.com']),
    user(['apple.com']),
    user(['google.com', 'apple.com']),
  ])('never calls Firebase credentials for an ineligible account', async (currentUser) => {
    mocks.auth.currentUser = currentUser;

    await expect(changePasswordWithReauthentication(input)).rejects.toBeTruthy();
    expect(mocks.credential).not.toHaveBeenCalled();
    expect(mocks.reauthenticate).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('stops when mandatory reauthentication fails', async () => {
    const error = { code: 'auth/wrong-password' };
    mocks.reauthenticate.mockRejectedValue(error);

    await expect(changePasswordWithReauthentication(input)).rejects.toBe(error);

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith('reauthenticate-password', error);
  });

  it('rechecks the authenticated user after reauthentication', async () => {
    mocks.reauthenticate.mockImplementation(async () => {
      mocks.auth.currentUser = user(['google.com']);
    });

    await expect(changePasswordWithReauthentication(input)).rejects.toMatchObject({
      code: 'auth/no-current-user',
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects local validation failures before any Firebase call', async () => {
    await expect(
      changePasswordWithReauthentication({ ...input, confirmation: 'mismatch' }),
    ).rejects.toMatchObject({ code: 'passwordMismatch' });

    expect(mocks.credential).not.toHaveBeenCalled();
    expect(mocks.reauthenticate).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
