import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestUser = {
  uid: string;
  email: string;
  emailVerified: boolean;
  providerData: Array<{ providerId: string }>;
  reload: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as TestUser | null },
  log: vi.fn(),
  send: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  sendEmailVerification: mocks.send,
}));

vi.mock('../../lib/firebase', () => ({ auth: mocks.auth }));

vi.mock('../auth', () => ({
  logAuthError: mocks.log,
  toAuthError: (error: unknown) => error,
}));

import {
  refreshEmailVerificationStatus,
  sendVerificationEmail,
} from '../emailVerification';

function user(emailVerified = false, providers = ['password']): TestUser {
  return {
    uid: 'user-1',
    email: 'person@example.com',
    emailVerified,
    providerData: providers.map((providerId) => ({ providerId })),
    reload: vi.fn(),
  };
}

describe('email verification Firebase service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.currentUser = user();
    mocks.send.mockResolvedValue(undefined);
  });

  it('sends one verification email to the current password user', async () => {
    await sendVerificationEmail();

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith(mocks.auth.currentUser);
  });

  it('supports the newly-created user as an explicit signup target', async () => {
    const newUser = user();
    mocks.auth.currentUser = null;

    await sendVerificationEmail(newUser as never);

    expect(mocks.send).toHaveBeenCalledWith(newUser);
  });

  it('deduplicates concurrent automatic and explicit sends for the same uid', async () => {
    let resolveSend!: () => void;
    mocks.send.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveSend = resolve;
      }),
    );

    const automatic = sendVerificationEmail(mocks.auth.currentUser as never);
    const manual = sendVerificationEmail();

    expect(mocks.send).toHaveBeenCalledTimes(1);
    resolveSend();
    await Promise.all([automatic, manual]);

    mocks.send.mockResolvedValue(undefined);
    await sendVerificationEmail();
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it('reloads before accepting an updated emailVerified=true value', async () => {
    const currentUser = user(false);
    currentUser.reload.mockImplementation(async () => {
      currentUser.emailVerified = true;
    });
    mocks.auth.currentUser = currentUser;

    const result = await refreshEmailVerificationStatus();

    expect(currentUser.reload).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ user: currentUser, emailVerified: true });
  });

  it('keeps the user blocked when reload still reports false', async () => {
    const currentUser = user(false);
    mocks.auth.currentUser = currentUser;

    const result = await refreshEmailVerificationStatus();

    expect(currentUser.reload).toHaveBeenCalledTimes(1);
    expect(result.emailVerified).toBe(false);
  });

  it.each([
    [null, 'auth/no-current-user'],
    [user(false, ['google.com']), 'auth/password-provider-required'],
    [user(false, ['apple.com']), 'auth/password-provider-required'],
  ])('rejects an ineligible session without sending (%s)', async (currentUser, code) => {
    mocks.auth.currentUser = currentUser;

    await expect(sendVerificationEmail()).rejects.toMatchObject({ code });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('preserves auth/too-many-requests for translated resend feedback', async () => {
    const error = { code: 'auth/too-many-requests' };
    mocks.send.mockRejectedValue(error);

    await expect(sendVerificationEmail()).rejects.toBe(error);

    expect(mocks.log).toHaveBeenCalledWith('email-verification:send', error);
  });

  it('rejects a session that changed while reload was in flight', async () => {
    const currentUser = user(false);
    currentUser.reload.mockImplementation(async () => {
      mocks.auth.currentUser = { ...user(false), uid: 'user-2' };
    });
    mocks.auth.currentUser = currentUser;

    await expect(refreshEmailVerificationStatus()).rejects.toMatchObject({
      code: 'auth/no-current-user',
    });
  });
});
