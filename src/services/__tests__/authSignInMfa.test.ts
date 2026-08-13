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
vi.mock('../../lib/secureAuthStorage', () => ({
  clearSecureAuthSession: vi.fn(),
}));

vi.mock('../../lib/photoVaultKeyStorage', () => ({
  deleteVaultKey: vi.fn(),
}));

import { signInWithEmail } from '../auth';

describe('email/password sign-in MFA boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the Firebase user unchanged when MFA is not required', async () => {
    const user = { uid: 'user-1' };
    mocks.signInWithEmailAndPassword.mockResolvedValue({ user });

    await expect(signInWithEmail(' person@example.com ', 'password')).resolves.toBe(user);
    expect(mocks.signInWithEmailAndPassword).toHaveBeenCalledWith(
      expect.anything(),
      'person@example.com',
      'password',
    );
  });

  it('preserves the original MultiFactorError for the resolver', async () => {
    const original = {
      code: 'auth/multi-factor-auth-required',
      customData: { operationType: 'signIn', opaque: true },
    };
    mocks.signInWithEmailAndPassword.mockRejectedValue(original);

    await expect(signInWithEmail('person@example.com', 'password')).rejects.toBe(
      original,
    );
  });

  it('continues normalizing non-MFA Firebase errors', async () => {
    mocks.signInWithEmailAndPassword.mockRejectedValue({
      code: 'auth/invalid-credential',
    });

    await expect(signInWithEmail('person@example.com', 'bad')).rejects.toMatchObject({
      code: 'auth/invalid-credential',
    });
  });
});
