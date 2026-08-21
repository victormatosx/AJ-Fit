import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAppleCredential: vi.fn(),
  getGoogleCredential: vi.fn(),
  signInWithCredential: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  fetchSignInMethodsForEmail: vi.fn(),
  linkWithCredential: vi.fn(),
  signInWithCredential: mocks.signInWithCredential,
  signInWithEmailAndPassword: vi.fn(),
  updateProfile: vi.fn(),
}));
vi.mock('../../lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('../auth', () => ({
  logAuthError: vi.fn(),
  toAuthError: (error: unknown) => error,
}));
vi.mock('../providers/google.native', () => ({
  getGoogleCredential: mocks.getGoogleCredential,
  isGoogleSigninAvailable: vi.fn(),
}));
vi.mock('../providers/apple.native', () => ({
  getAppleCredential: mocks.getAppleCredential,
  isAppleAuthAvailable: vi.fn(),
}));

import { SocialAuthCancelledError, signInWithProvider } from '../socialAuth';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

describe('social authentication concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signInWithCredential.mockResolvedValue({
      user: { uid: 'user-1', displayName: 'Person' },
    });
  });

  it.each(['google', 'apple'] as const)(
    'coalesces 20 pending %s attempts into one native provider flow',
    async (provider) => {
      const pending = deferred<{ credential: object; displayName: string }>();
      const acquire = provider === 'google' ? mocks.getGoogleCredential : mocks.getAppleCredential;
      acquire.mockReturnValueOnce(pending.promise);

      const calls = Array.from({ length: 20 }, () => signInWithProvider(provider));
      await Promise.resolve();

      expect(acquire).toHaveBeenCalledTimes(1);
      pending.resolve({ credential: { provider }, displayName: 'Person' });
      await Promise.all(calls);

      expect(mocks.signInWithCredential).toHaveBeenCalledTimes(1);
    },
  );

  it('releases the social flight after provider cancellation', async () => {
    mocks.getAppleCredential
      .mockRejectedValueOnce(new SocialAuthCancelledError())
      .mockResolvedValueOnce({ credential: { provider: 'apple' }, displayName: 'Person' });

    await expect(signInWithProvider('apple')).rejects.toBeInstanceOf(
      SocialAuthCancelledError,
    );
    await expect(signInWithProvider('apple')).resolves.toMatchObject({ uid: 'user-1' });

    expect(mocks.getAppleCredential).toHaveBeenCalledTimes(2);
  });

  it('releases the social flight after a non-cancellation error', async () => {
    const failure = new Error('provider failed');
    mocks.getGoogleCredential
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ credential: { provider: 'google' }, displayName: 'Person' });

    await expect(signInWithProvider('google')).rejects.toBe(failure);
    await expect(signInWithProvider('google')).resolves.toMatchObject({ uid: 'user-1' });

    expect(mocks.getGoogleCredential).toHaveBeenCalledTimes(2);
  });
});
