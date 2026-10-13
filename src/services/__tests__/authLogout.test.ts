import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearSession: vi.fn(),
  signOut: vi.fn(),
  deleteVaultKey: vi.fn(),
  queueNotificationDeviceRelease: vi.fn(),
  clearNotificationAccountPreferenceState: vi.fn(),
  clearHealthIntegrationSessionState: vi.fn(),
  clearHealthIntegrationOnboardingStepSessionState: vi.fn(),
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

vi.mock('../notificationAccountLifecycle', () => ({
  queueNotificationDeviceRelease: mocks.queueNotificationDeviceRelease,
  clearNotificationAccountPreferenceState: mocks.clearNotificationAccountPreferenceState,
}));

vi.mock('../healthIntegrationPreferences', () => ({
  clearHealthIntegrationSessionState: mocks.clearHealthIntegrationSessionState,
}));

vi.mock('../healthIntegrationOnboardingStep', () => ({
  clearHealthIntegrationOnboardingStepSessionState: mocks.clearHealthIntegrationOnboardingStepSessionState,
}));

import { signOutUser } from '../auth';

describe('verification-screen logout compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signOut.mockResolvedValue(undefined);
    mocks.clearSession.mockResolvedValue(undefined);
    mocks.deleteVaultKey.mockResolvedValue(undefined);
    mocks.queueNotificationDeviceRelease.mockResolvedValue(undefined);
    mocks.clearNotificationAccountPreferenceState.mockResolvedValue(undefined);
    mocks.clearHealthIntegrationSessionState.mockReturnValue(undefined);
    mocks.clearHealthIntegrationOnboardingStepSessionState.mockReturnValue(undefined);
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

  it('does not wait for a slow push release before completing Firebase logout', async () => {
    mocks.queueNotificationDeviceRelease.mockReturnValue(new Promise(() => {}));

    await expect(signOutUser()).resolves.toBeUndefined();

    expect(mocks.queueNotificationDeviceRelease).toHaveBeenCalledWith('alice');
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('forgets the in-memory health-integration hint for the outgoing uid on logout', async () => {
    await signOutUser();

    expect(mocks.clearHealthIntegrationSessionState).toHaveBeenCalledWith('alice');
    expect(mocks.clearHealthIntegrationSessionState).toHaveBeenCalledTimes(1);
  });

  it('still completes logout if clearing the health-integration hint throws', async () => {
    mocks.clearHealthIntegrationSessionState.mockImplementation(() => {
      throw new Error('unexpected map error');
    });

    await expect(signOutUser()).resolves.toBeUndefined();
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('forgets the in-memory health-onboarding-step hint for the outgoing uid on logout', async () => {
    await signOutUser();

    expect(mocks.clearHealthIntegrationOnboardingStepSessionState).toHaveBeenCalledWith('alice');
    expect(mocks.clearHealthIntegrationOnboardingStepSessionState).toHaveBeenCalledTimes(1);
  });

  it('still completes logout if clearing the health-onboarding-step hint throws', async () => {
    mocks.clearHealthIntegrationOnboardingStepSessionState.mockImplementation(() => {
      throw new Error('unexpected map error');
    });

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
