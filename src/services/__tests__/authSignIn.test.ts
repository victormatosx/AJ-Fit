import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  signInWithEmailAndPassword: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(),
  onAuthStateChanged: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: mocks.signInWithEmailAndPassword,
  signOut: vi.fn(),
  updateProfile: vi.fn(),
}));
vi.mock('../../lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('../../lib/secureAuthStorage', () => ({ clearSecureAuthSession: vi.fn() }));
vi.mock('../../lib/photoVaultKeyStorage', () => ({ deleteVaultKey: vi.fn() }));

import { signInWithEmail } from '../auth';

describe('email/password sign-in', () => {
  beforeEach(() => vi.clearAllMocks());

  it('trims the email and returns the authenticated Firebase user', async () => {
    const user = { uid: 'user-1' };
    mocks.signInWithEmailAndPassword.mockResolvedValue({ user });

    await expect(signInWithEmail(' person@example.com ', 'password')).resolves.toBe(user);
    expect(mocks.signInWithEmailAndPassword).toHaveBeenCalledWith(
      expect.anything(),
      'person@example.com',
      'password',
    );
  });

  it('sends a legacy six-character password to Firebase without strength validation', async () => {
    const user = { uid: 'legacy-user' };
    mocks.signInWithEmailAndPassword.mockResolvedValue({ user });

    await expect(signInWithEmail('person@example.com', '123456')).resolves.toBe(user);
    expect(mocks.signInWithEmailAndPassword).toHaveBeenCalledWith(
      expect.anything(),
      'person@example.com',
      '123456',
    );
  });

  it.each([
    'auth/invalid-credential',
    'auth/user-not-found',
    'auth/wrong-password',
    'auth/user-disabled',
  ])('normalizes private sign-in failure %s to one external result', async (code) => {
    mocks.signInWithEmailAndPassword.mockRejectedValue({ code });

    await expect(signInWithEmail('person@example.com', 'bad')).rejects.toMatchObject({
      code: 'auth/invalid-credential',
      message: 'E-mail ou senha incorretos.',
    });
  });

  it.each(['auth/too-many-requests', 'auth/network-request-failed', 'auth/invalid-email'])(
    'preserves actionable sign-in failure %s',
    async (code) => {
      mocks.signInWithEmailAndPassword.mockRejectedValue({ code });
      await expect(signInWithEmail('person@example.com', 'bad')).rejects.toMatchObject({
        code,
      });
    },
  );
});
