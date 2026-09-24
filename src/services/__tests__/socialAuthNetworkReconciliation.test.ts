/**
 * Camada A regression coverage (2026-09-24 orphaned-Google-account audit):
 * `signInWithCredential` can reject with `auth/network-request-failed` AFTER
 * Firebase already created/authenticated the account server-side — the
 * response carrying that outcome back to THIS call is what got lost. These
 * tests prove `performSignInWithProvider` reconciles against Firebase's own
 * live `auth.currentUser`/`onAuthStateChanged` state instead of assuming
 * outright that nothing happened, while never inventing an identity when
 * nothing really exists.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authState: { currentUser: null as { uid: string } | null },
  authStateCallback: null as ((user: unknown) => void) | null,
  getAdditionalUserInfo: vi.fn(),
  getAppleCredential: vi.fn(),
  getGoogleCredential: vi.fn(),
  googleCredential: { providerId: 'google.com' },
  onAuthStateChanged: vi.fn(),
  signInWithCredential: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  deleteUser: vi.fn(),
  fetchSignInMethodsForEmail: vi.fn(),
  getAdditionalUserInfo: mocks.getAdditionalUserInfo,
  linkWithCredential: vi.fn(),
  onAuthStateChanged: mocks.onAuthStateChanged,
  signInWithCredential: mocks.signInWithCredential,
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  updateProfile: mocks.updateProfile,
}));

vi.mock('../../lib/firebase', () => ({ auth: mocks.authState }));
vi.mock('../../lib/logger', () => ({ logInfo: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));
vi.mock('../../lib/secureAuthStorage', () => ({ clearSecureAuthSession: vi.fn() }));
vi.mock('../../lib/photoVaultKeyStorage', () => ({ deleteVaultKey: vi.fn() }));
vi.mock('../providers/google.native', () => ({
  getGoogleCredential: mocks.getGoogleCredential,
  isGoogleSigninAvailable: vi.fn(),
}));
vi.mock('../providers/apple.native', () => ({
  getAppleCredential: mocks.getAppleCredential,
  isAppleAuthAvailable: vi.fn(),
}));

import { clearPendingSocialAuthState, signInWithProvider } from '../socialAuth';

const NETWORK_ERROR = { code: 'auth/network-request-failed', message: 'network' };

describe('social sign-in — network-failure reconciliation (Camada A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    clearPendingSocialAuthState();
    mocks.authState.currentUser = null;
    mocks.authStateCallback = null;
    mocks.onAuthStateChanged.mockImplementation((_auth: unknown, callback: (user: unknown) => void) => {
      mocks.authStateCallback = callback;
      return () => { mocks.authStateCallback = null; };
    });
    mocks.getGoogleCredential.mockResolvedValue({
      credential: mocks.googleCredential,
      displayName: 'Google Person',
    });
    mocks.getAdditionalUserInfo.mockReturnValue({ isNewUser: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('B — a genuine total connection failure (no session ever appears) still surfaces the connection error', async () => {
    mocks.signInWithCredential.mockRejectedValueOnce(NETWORK_ERROR);

    const pending = signInWithProvider('google');
    const assertion = expect(pending).rejects.toMatchObject({ code: 'auth/network-request-failed' });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;

    expect(mocks.signInWithCredential).toHaveBeenCalledTimes(1);
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it('C — Firebase authenticated despite the lost response: reconciles via auth.currentUser and completes under that exact uid', async () => {
    mocks.signInWithCredential.mockRejectedValueOnce(NETWORK_ERROR);

    const pending = signInWithProvider('google');
    // Simulate Firebase's OWN listener firing once its internal persistence
    // settles, milliseconds after the rejected promise.
    await Promise.resolve();
    await Promise.resolve();
    mocks.authState.currentUser = { uid: 'server-created-uid' };
    mocks.authStateCallback?.({ uid: 'server-created-uid' });

    await expect(pending).resolves.toEqual({
      user: { uid: 'server-created-uid' },
      // Firebase's own isNewUser classification is unavailable on this path
      // (no UserCredential) — false is the deliberate, safe default so the
      // caller always re-checks Firestore instead of assuming "brand new".
      isNewUser: false,
    });
  });

  it('C (variant) — auth.currentUser is already populated by the time the catch runs (no listener race needed)', async () => {
    mocks.signInWithCredential.mockImplementationOnce(async () => {
      mocks.authState.currentUser = { uid: 'already-there-uid' };
      throw NETWORK_ERROR;
    });

    await expect(signInWithProvider('google')).resolves.toEqual({
      user: { uid: 'already-there-uid' },
      isNewUser: false,
    });
  });

  it('never reconciles to a session that was already active BEFORE this attempt (no UID invented/misattributed)', async () => {
    mocks.authState.currentUser = { uid: 'pre-existing-unrelated-uid' };
    mocks.signInWithCredential.mockRejectedValueOnce(NETWORK_ERROR);

    const pending = signInWithProvider('google');
    const assertion = expect(pending).rejects.toMatchObject({ code: 'auth/network-request-failed' });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it('A — a normal, successful social sign-in never touches the reconciliation path', async () => {
    const signedInUser = { uid: 'normal-uid' };
    mocks.signInWithCredential.mockResolvedValueOnce({ user: signedInUser });

    await expect(signInWithProvider('google')).resolves.toEqual({
      user: signedInUser,
      isNewUser: false,
    });
    expect(mocks.onAuthStateChanged).not.toHaveBeenCalled();
  });
});
