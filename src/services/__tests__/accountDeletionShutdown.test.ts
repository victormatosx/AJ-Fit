import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  removeCachedThumbnailsForUser: vi.fn(),
  clearOnboardingDraft: vi.fn(),
  clearWorkoutSubstitutionPreferences: vi.fn(),
  clearStoredUnitsPreference: vi.fn(),
}));

vi.mock('../photoVaultEncryptedCache', () => ({
  removeCachedThumbnailsForUser: mocks.removeCachedThumbnailsForUser,
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

import { finalizeAccountDeletionClientShutdown } from '../accountDeletionShutdown';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clearOnboardingDraft.mockResolvedValue(undefined);
  mocks.clearWorkoutSubstitutionPreferences.mockResolvedValue(undefined);
  mocks.clearStoredUnitsPreference.mockResolvedValue(undefined);
});

describe('finalizeAccountDeletionClientShutdown', () => {
  it('clears the vault thumbnail cache for the given uid', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    await finalizeAccountDeletionClientShutdown('uid-1', logout);
    expect(mocks.removeCachedThumbnailsForUser).toHaveBeenCalledWith('uid-1');
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

    expect(mocks.removeCachedThumbnailsForUser).toHaveBeenCalledWith('uid-1');
    expect(mocks.clearOnboardingDraft).toHaveBeenCalledOnce();
    expect(logout).toHaveBeenCalledOnce();
  });

  it('clears the local units preference (Fase 11 audit finding — user-scoped, synced to users/{uid}.preferences.units)', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    await finalizeAccountDeletionClientShutdown('uid-1', logout);
    expect(mocks.clearStoredUnitsPreference).toHaveBeenCalledOnce();
  });

  it('a failure clearing the units preference does not block the other cleanups or logout', async () => {
    mocks.clearStoredUnitsPreference.mockRejectedValue(new Error('storage error'));
    const logout = vi.fn().mockResolvedValue(undefined);

    await finalizeAccountDeletionClientShutdown('uid-1', logout);

    expect(mocks.removeCachedThumbnailsForUser).toHaveBeenCalledWith('uid-1');
    expect(mocks.clearOnboardingDraft).toHaveBeenCalledOnce();
    expect(mocks.clearWorkoutSubstitutionPreferences).toHaveBeenCalledOnce();
    expect(logout).toHaveBeenCalledOnce();
  });

  it('calls logout last, after local cleanup', async () => {
    const order: string[] = [];
    mocks.removeCachedThumbnailsForUser.mockImplementation(() => order.push('thumbnails'));
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
    mocks.removeCachedThumbnailsForUser.mockImplementation(() => {
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

    expect(mocks.removeCachedThumbnailsForUser).toHaveBeenCalledWith('uid-1');
    expect(logout).toHaveBeenCalledOnce();
  });

  it('propagates a logout failure to the caller (the caller remains responsible for forcing the user out of private UI)', async () => {
    const logout = vi.fn().mockRejectedValue(new Error('signOut failed'));
    await expect(finalizeAccountDeletionClientShutdown('uid-1', logout)).rejects.toThrow(
      'signOut failed',
    );
    // Local cleanup still ran despite the eventual logout failure.
    expect(mocks.removeCachedThumbnailsForUser).toHaveBeenCalledWith('uid-1');
    expect(mocks.clearOnboardingDraft).toHaveBeenCalledOnce();
  });

  it('only ever clears data for the given uid, never a hardcoded/other uid', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    await finalizeAccountDeletionClientShutdown('the-real-uid', logout);
    expect(mocks.removeCachedThumbnailsForUser).toHaveBeenCalledWith('the-real-uid');
    expect(mocks.removeCachedThumbnailsForUser).not.toHaveBeenCalledWith('someone-else');
  });
});
