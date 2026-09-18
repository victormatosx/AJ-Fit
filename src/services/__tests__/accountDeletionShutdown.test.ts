import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  removePhotoVaultCiphertextForUser: vi.fn(),
  clearOnboardingDraft: vi.fn(),
  clearWorkoutSubstitutionPreferences: vi.fn(),
  clearStoredUnitsPreference: vi.fn(),
  clearPrescriptionSnapshotsForUser: vi.fn(),
  cleanupRestSessionArtifacts: vi.fn(),
  purgePhotoVaultUploadsForUser: vi.fn(),
  removeLockedPreviewDerivativesForUser: vi.fn(),
}));

vi.mock('../photoVaultEncryptedCache', () => ({
  removePhotoVaultCiphertextForUser: mocks.removePhotoVaultCiphertextForUser,
}));
// Reaches expo-file-system, which cannot be parsed in this node environment —
// same reason the ciphertext cache mock above exists.
vi.mock('../photoVaultLockedPreviewCache', () => ({
  removeLockedPreviewDerivativesForUser: mocks.removeLockedPreviewDerivativesForUser,
}));
vi.mock('../../onboarding/draftStorage', () => ({
  clearOnboardingDraft: mocks.clearOnboardingDraft,
}));
vi.mock('../workoutSubstitutionsStorage', () => ({
  clearWorkoutSubstitutionPreferences: mocks.clearWorkoutSubstitutionPreferences,
}));
vi.mock('../../units/unitsStorage', () => ({
  clearStoredUnitsPreference: mocks.clearStoredUnitsPreference,
}));
vi.mock('../../workoutPrescription/storage', () => ({
  clearPrescriptionSnapshotsForUser: mocks.clearPrescriptionSnapshotsForUser,
}));
vi.mock('../restSessionCleanup', () => ({
  cleanupRestSessionArtifacts: mocks.cleanupRestSessionArtifacts,
}));
vi.mock('../photoVaultUploadQueue', () => ({
  purgePhotoVaultUploadsForUser: mocks.purgePhotoVaultUploadsForUser,
}));

import { finalizeAccountDeletionClientShutdown } from '../accountDeletionShutdown';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clearOnboardingDraft.mockResolvedValue(undefined);
  mocks.clearWorkoutSubstitutionPreferences.mockResolvedValue(undefined);
  mocks.clearStoredUnitsPreference.mockResolvedValue(undefined);
  mocks.clearPrescriptionSnapshotsForUser.mockResolvedValue(undefined);
  mocks.cleanupRestSessionArtifacts.mockResolvedValue(undefined);
  mocks.purgePhotoVaultUploadsForUser.mockResolvedValue(undefined);
  mocks.removeLockedPreviewDerivativesForUser.mockResolvedValue(undefined);
});

describe('finalizeAccountDeletionClientShutdown', () => {
  it('clears the vault thumbnail cache for the given uid', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    await finalizeAccountDeletionClientShutdown('uid-1', logout);
    expect(mocks.removePhotoVaultCiphertextForUser).toHaveBeenCalledWith('uid-1');
  });

  it('clears the locked-preview derivative cache for the given uid', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    await finalizeAccountDeletionClientShutdown('uid-1', logout);
    expect(mocks.removeLockedPreviewDerivativesForUser).toHaveBeenCalledWith('uid-1');
  });

  it('a failure clearing the locked-preview cache does not block the other cleanups or logout', async () => {
    mocks.removeLockedPreviewDerivativesForUser.mockImplementation(() => {
      throw new Error('disk error');
    });
    const logout = vi.fn().mockResolvedValue(undefined);
    await finalizeAccountDeletionClientShutdown('uid-1', logout);
    expect(mocks.removePhotoVaultCiphertextForUser).toHaveBeenCalledWith('uid-1');
    expect(mocks.clearOnboardingDraft).toHaveBeenCalledOnce();
    expect(logout).toHaveBeenCalledOnce();
  });

  it('clears the onboarding draft', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    await finalizeAccountDeletionClientShutdown('uid-1', logout);
    expect(mocks.clearOnboardingDraft).toHaveBeenCalledOnce();
  });

  it('clears the workout substitution preferences (Fase 11 audit finding — global, unnamespaced key)', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    await finalizeAccountDeletionClientShutdown('uid-1', logout);
    expect(mocks.clearWorkoutSubstitutionPreferences).toHaveBeenCalledOnce();
  });

  it('a failure clearing workout substitutions does not block the other cleanups or logout', async () => {
    mocks.clearWorkoutSubstitutionPreferences.mockRejectedValue(new Error('storage error'));
    const logout = vi.fn().mockResolvedValue(undefined);

    await finalizeAccountDeletionClientShutdown('uid-1', logout);

    expect(mocks.removePhotoVaultCiphertextForUser).toHaveBeenCalledWith('uid-1');
    expect(mocks.clearOnboardingDraft).toHaveBeenCalledOnce();
    expect(logout).toHaveBeenCalledOnce();
  });

  it('clears the local units preference (Fase 11 audit finding — user-scoped, synced to users/{uid}.preferences.units)', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    await finalizeAccountDeletionClientShutdown('uid-1', logout);
    expect(mocks.clearStoredUnitsPreference).toHaveBeenCalledOnce();
  });

  it('clears every immutable workout prescription snapshot for the deleted uid', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    await finalizeAccountDeletionClientShutdown('uid-1', logout);
    expect(mocks.clearPrescriptionSnapshotsForUser).toHaveBeenCalledWith('uid-1');
  });

  it('cleans persisted rest and native presentation before logout', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    await finalizeAccountDeletionClientShutdown('uid-1', logout);
    expect(mocks.cleanupRestSessionArtifacts).toHaveBeenCalledOnce();
    expect(mocks.cleanupRestSessionArtifacts.mock.invocationCallOrder[0]).toBeLessThan(
      logout.mock.invocationCallOrder[0],
    );
  });

  it('a failure clearing the units preference does not block the other cleanups or logout', async () => {
    mocks.clearStoredUnitsPreference.mockRejectedValue(new Error('storage error'));
    const logout = vi.fn().mockResolvedValue(undefined);

    await finalizeAccountDeletionClientShutdown('uid-1', logout);

    expect(mocks.removePhotoVaultCiphertextForUser).toHaveBeenCalledWith('uid-1');
    expect(mocks.clearOnboardingDraft).toHaveBeenCalledOnce();
    expect(mocks.clearWorkoutSubstitutionPreferences).toHaveBeenCalledOnce();
    expect(logout).toHaveBeenCalledOnce();
  });

  it('calls logout last, after local cleanup', async () => {
    const order: string[] = [];
    mocks.removePhotoVaultCiphertextForUser.mockImplementation(() => order.push('thumbnails'));
    mocks.clearOnboardingDraft.mockImplementation(async () => {
      order.push('draft');
    });
    const logout = vi.fn().mockImplementation(async () => {
      order.push('logout');
    });

    await finalizeAccountDeletionClientShutdown('uid-1', logout);

    expect(order.indexOf('logout')).toBe(order.length - 1);
    expect(order).toContain('thumbnails');
    expect(order).toContain('draft');
  });

  it('a failure clearing the thumbnail cache does not block clearing the onboarding draft or logging out', async () => {
    mocks.removePhotoVaultCiphertextForUser.mockImplementation(() => {
      throw new Error('disk error');
    });
    const logout = vi.fn().mockResolvedValue(undefined);

    await finalizeAccountDeletionClientShutdown('uid-1', logout);

    expect(mocks.clearOnboardingDraft).toHaveBeenCalledOnce();
    expect(logout).toHaveBeenCalledOnce();
  });

  it('a failure clearing the onboarding draft does not block clearing the thumbnail cache or logging out', async () => {
    mocks.clearOnboardingDraft.mockRejectedValue(new Error('storage error'));
    const logout = vi.fn().mockResolvedValue(undefined);

    await finalizeAccountDeletionClientShutdown('uid-1', logout);

    expect(mocks.removePhotoVaultCiphertextForUser).toHaveBeenCalledWith('uid-1');
    expect(logout).toHaveBeenCalledOnce();
  });

  it('propagates a logout failure to the caller (the caller remains responsible for forcing the user out of private UI)', async () => {
    const logout = vi.fn().mockRejectedValue(new Error('signOut failed'));
    await expect(finalizeAccountDeletionClientShutdown('uid-1', logout)).rejects.toThrow(
      'signOut failed',
    );
    // Local cleanup still ran despite the eventual logout failure.
    expect(mocks.removePhotoVaultCiphertextForUser).toHaveBeenCalledWith('uid-1');
    expect(mocks.clearOnboardingDraft).toHaveBeenCalledOnce();
  });

  it('only ever clears data for the given uid, never a hardcoded/other uid', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    await finalizeAccountDeletionClientShutdown('the-real-uid', logout);
    expect(mocks.removePhotoVaultCiphertextForUser).toHaveBeenCalledWith('the-real-uid');
    expect(mocks.removePhotoVaultCiphertextForUser).not.toHaveBeenCalledWith('someone-else');
  });
});

/**
 * Pending uploads survive a plain logout on purpose — they hold the only copy
 * of a photo the user was told was saved. An accepted deletion is the one
 * place that is allowed to destroy them.
 */
describe('pending Photo Vault uploads', () => {
  it('purges the deleted account’s durable ciphertext', async () => {
    await finalizeAccountDeletionClientShutdown('alice', vi.fn().mockResolvedValue(undefined));

    expect(mocks.purgePhotoVaultUploadsForUser).toHaveBeenCalledWith('alice');
  });

  it('still logs out when the purge fails', async () => {
    mocks.purgePhotoVaultUploadsForUser.mockRejectedValue(new Error('disk'));
    const logout = vi.fn().mockResolvedValue(undefined);

    await finalizeAccountDeletionClientShutdown('alice', logout);

    // Local cleanup is best-effort and independent; it must never trap the
    // user inside an account that is already being deleted.
    expect(logout).toHaveBeenCalled();
  });
});
