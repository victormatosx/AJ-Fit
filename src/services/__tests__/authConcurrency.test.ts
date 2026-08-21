import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as { uid: string } | null },
  createUser: vi.fn(),
  resetPassword: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: mocks.createUser,
  onAuthStateChanged: vi.fn(),
  sendPasswordResetEmail: mocks.resetPassword,
  signInWithEmailAndPassword: mocks.signIn,
  signOut: mocks.signOut,
  updateProfile: mocks.updateProfile,
}));

vi.mock('../../lib/firebase', () => ({ auth: mocks.auth }));
vi.mock('../../lib/secureAuthStorage', () => ({ clearSecureAuthSession: vi.fn() }));
vi.mock('../../lib/photoVaultKeyStorage', () => ({ deleteVaultKey: vi.fn() }));

import { resetPassword, signInWithEmail, signOutUser, signUpWithEmail } from '../auth';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

describe('email authentication concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProfile.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('coalesces 20 pending logins into one Firebase sign-in', async () => {
    const pending = deferred<{ user: { uid: string } }>();
    mocks.signIn.mockReturnValueOnce(pending.promise);

    const calls = Array.from({ length: 20 }, () =>
      signInWithEmail('person@example.com', 'password'),
    );
    await Promise.resolve();

    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    expect(mocks.auth.currentUser).toBeNull();
    pending.resolve({ user: { uid: 'user-1' } });
    await Promise.all(calls);

    mocks.signIn.mockResolvedValueOnce({ user: { uid: 'user-1' } });
    await signInWithEmail('person@example.com', 'password');
    expect(mocks.signIn).toHaveBeenCalledTimes(2);
  });

  it('coalesces 20 pending signups into one Firebase creation and profile update', async () => {
    const pending = deferred<{ user: { uid: string } }>();
    mocks.createUser.mockReturnValueOnce(pending.promise);

    const calls = Array.from({ length: 20 }, () =>
      signUpWithEmail('person@example.com', 'password', 'Person'),
    );
    await Promise.resolve();

    expect(mocks.createUser).toHaveBeenCalledTimes(1);
    pending.resolve({ user: { uid: 'user-1' } });
    await Promise.all(calls);

    expect(mocks.updateProfile).toHaveBeenCalledTimes(1);
  });

  it('coalesces 20 pending password resets into one Firebase email request', async () => {
    const pending = deferred<void>();
    mocks.resetPassword.mockReturnValueOnce(pending.promise);

    const calls = Array.from({ length: 20 }, () => resetPassword('person@example.com'));
    await Promise.resolve();

    expect(mocks.resetPassword).toHaveBeenCalledTimes(1);
    pending.resolve();
    await Promise.all(calls);

    mocks.resetPassword.mockResolvedValueOnce(undefined);
    await resetPassword('person@example.com');
    expect(mocks.resetPassword).toHaveBeenCalledTimes(2);
  });

  it('releases the login flight after an error', async () => {
    mocks.signIn
      .mockRejectedValueOnce({ code: 'auth/invalid-credential' })
      .mockResolvedValueOnce({ user: { uid: 'user-1' } });

    await expect(signInWithEmail('person@example.com', 'bad')).rejects.toMatchObject({
      code: 'auth/invalid-credential',
    });
    await expect(signInWithEmail('person@example.com', 'good')).resolves.toMatchObject({
      uid: 'user-1',
    });

    expect(mocks.signIn).toHaveBeenCalledTimes(2);
  });

  it('shares throttling across 20 callers, performs no retry, and later recovers', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pending = deferred<{ user: { uid: string } }>();
    mocks.signIn.mockReturnValueOnce(pending.promise);

    const calls = Array.from({ length: 20 }, () =>
      signInWithEmail('person@example.com', 'attempted-password'),
    );
    await Promise.resolve();
    expect(mocks.signIn).toHaveBeenCalledTimes(1);

    pending.reject({ code: 'auth/too-many-requests' });
    const outcomes = await Promise.allSettled(calls);
    expect(outcomes).toHaveLength(20);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toMatchObject({
          code: 'auth/too-many-requests',
          message:
            'Muitas tentativas realizadas. Aguarde um momento antes de tentar novamente.',
        });
      }
    }
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    expect(mocks.auth.currentUser).toBeNull();
    expect(errorLog).not.toHaveBeenCalled();

    mocks.signIn.mockResolvedValueOnce({ user: { uid: 'user-after-throttle' } });
    await expect(
      signInWithEmail('person@example.com', 'later-password'),
    ).resolves.toMatchObject({ uid: 'user-after-throttle' });
    expect(mocks.signIn).toHaveBeenCalledTimes(2);
  });

  it('releases signup and reset flights after errors', async () => {
    mocks.createUser
      .mockRejectedValueOnce({ code: 'auth/network-request-failed' })
      .mockResolvedValueOnce({ user: { uid: 'user-1' } });
    mocks.resetPassword
      .mockRejectedValueOnce({ code: 'auth/network-request-failed' })
      .mockResolvedValueOnce(undefined);

    await expect(
      signUpWithEmail('person@example.com', 'password', 'Person'),
    ).rejects.toMatchObject({ code: 'auth/network-request-failed' });
    await expect(
      signUpWithEmail('person@example.com', 'password', 'Person'),
    ).resolves.toMatchObject({ uid: 'user-1' });

    await expect(resetPassword('person@example.com')).rejects.toMatchObject({
      code: 'auth/network-request-failed',
    });
    await expect(resetPassword('person@example.com')).resolves.toBeUndefined();

    expect(mocks.createUser).toHaveBeenCalledTimes(2);
    expect(mocks.resetPassword).toHaveBeenCalledTimes(2);
  });

  it('coalesces 20 pending logouts into one Firebase sign-out', async () => {
    const pending = deferred<void>();
    mocks.signOut.mockReturnValueOnce(pending.promise);

    const calls = Array.from({ length: 20 }, () => signOutUser());
    await Promise.resolve();

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    pending.resolve();
    await Promise.all(calls);

    mocks.signOut.mockResolvedValueOnce(undefined);
    await signOutUser();
    expect(mocks.signOut).toHaveBeenCalledTimes(2);
  });
});
