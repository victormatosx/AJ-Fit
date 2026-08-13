import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(),
  onAuthStateChanged: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: mocks.signOut,
  updateProfile: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ auth: { currentUser: null } }));

vi.mock('../../lib/secureAuthStorage', () => ({
  clearSecureAuthSession: mocks.clearSession,
}));

import { signOutUser } from '../auth';

describe('verification-screen logout compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signOut.mockResolvedValue(undefined);
    mocks.clearSession.mockResolvedValue(undefined);
  });

  it('signs out from Firebase before clearing secure session persistence', async () => {
    await signOutUser();

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.clearSession).toHaveBeenCalledTimes(1);
    expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearSession.mock.invocationCallOrder[0],
    );
  });
});
