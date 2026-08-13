import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearSession: vi.fn(),
  signOut: vi.fn(),
  deleteVaultKey: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(),
  onAuthStateChanged: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: mocks.signOut,
  updateProfile: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ auth: { currentUser: { uid: 'alice' } } }));

vi.mock('../../lib/secureAuthStorage', () => ({
  clearSecureAuthSession: mocks.clearSession,
}));

vi.mock('../../lib/photoVaultKeyStorage', () => ({
  deleteVaultKey: mocks.deleteVaultKey,
}));

import { signOutUser } from '../auth';

describe('verification-screen logout compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signOut.mockResolvedValue(undefined);
    mocks.clearSession.mockResolvedValue(undefined);
    mocks.deleteVaultKey.mockResolvedValue(undefined);
  });

  it('signs out from Firebase before clearing secure session persistence', async () => {
    await signOutUser();

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.clearSession).toHaveBeenCalledTimes(1);
    expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearSession.mock.invocationCallOrder[0],
    );
  });

  it("removes this device's photo vault key on logout", async () => {
    await signOutUser();

    // Namespaced per uid — the uid must be captured before signOut clears it.
    expect(mocks.deleteVaultKey).toHaveBeenCalledWith('alice');
  });

  it('still completes logout when clearing the vault key fails', async () => {
    mocks.deleteVaultKey.mockRejectedValue(new Error('keychain unavailable'));

    await expect(signOutUser()).resolves.toBeUndefined();
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('does not attempt to clear a vault key when there is no current user', async () => {
    const firebase = await import('../../lib/firebase');
    (firebase.auth as { currentUser: unknown }).currentUser = null;

    await signOutUser();

    expect(mocks.deleteVaultKey).not.toHaveBeenCalled();

    (firebase.auth as { currentUser: unknown }).currentUser = { uid: 'alice' };
  });
});
