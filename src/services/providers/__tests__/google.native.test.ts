import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProviderCredentialError,
  SocialAuthCancelledError,
} from '../types';

const mocks = vi.hoisted(() => ({
  configure: vi.fn(),
  firebaseCredential: vi.fn(),
  hasPlayServices: vi.fn(),
  revokeAccess: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('react-native', () => ({
  NativeModules: { RNGoogleSignin: {} },
  Platform: { OS: 'android' },
  TurboModuleRegistry: { get: vi.fn(() => ({})) },
}));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: { credential: mocks.firebaseCredential },
}));
vi.mock('../../authConfig', () => ({
  GOOGLE_WEB_CLIENT_ID: 'web.apps.googleusercontent.com',
  GOOGLE_IOS_CLIENT_ID: 'ios.apps.googleusercontent.com',
  assertGoogleConfig: vi.fn(),
}));
vi.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: mocks.configure,
    hasPlayServices: mocks.hasPlayServices,
    revokeAccess: mocks.revokeAccess,
    signIn: mocks.signIn,
  },
  isErrorWithCode: (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error,
  isSuccessResponse: (response: { type?: string }) => response.type === 'success',
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
}));

import { getGoogleCredential, revokeGoogleAccess } from '../google.native';

describe('Google credential acquisition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPlayServices.mockResolvedValue(true);
    mocks.firebaseCredential.mockImplementation((idToken) => ({ idToken }));
    mocks.signIn.mockResolvedValue({
      type: 'success',
      data: {
        idToken: 'fresh-google-id-token',
        user: { name: 'Google Person' },
      },
    });
    mocks.revokeAccess.mockResolvedValue(undefined);
  });

  it('reuses configured native sign-in and builds a fresh Firebase credential', async () => {
    await expect(getGoogleCredential()).resolves.toEqual({
      credential: { idToken: 'fresh-google-id-token' },
      displayName: 'Google Person',
    });
    expect(mocks.hasPlayServices).toHaveBeenCalledWith({
      showPlayServicesUpdateDialog: true,
    });
    expect(mocks.signIn).toHaveBeenCalledOnce();
    expect(mocks.firebaseCredential).toHaveBeenCalledWith(
      'fresh-google-id-token',
    );
  });

  it('handles response and native-code cancellation without a Firebase call', async () => {
    mocks.signIn.mockResolvedValueOnce({ type: 'cancelled' });
    await expect(getGoogleCredential()).rejects.toBeInstanceOf(
      SocialAuthCancelledError,
    );

    mocks.signIn.mockRejectedValueOnce({ code: 'SIGN_IN_CANCELLED' });
    await expect(getGoogleCredential()).rejects.toBeInstanceOf(
      SocialAuthCancelledError,
    );
    expect(mocks.firebaseCredential).not.toHaveBeenCalled();
  });

  it.each([
    ['IN_PROGRESS', 'providerBusy'],
    ['PLAY_SERVICES_NOT_AVAILABLE', 'providerUnavailable'],
  ])('maps the installed library code %s to %s', async (code, issue) => {
    mocks.signIn.mockRejectedValueOnce({ code });
    await expect(getGoogleCredential()).rejects.toMatchObject({ issue });
    expect(mocks.firebaseCredential).not.toHaveBeenCalled();
  });

  it('rejects a successful response without an idToken', async () => {
    mocks.signIn.mockResolvedValueOnce({
      type: 'success',
      data: { idToken: null, user: { name: null } },
    });
    await expect(getGoogleCredential()).rejects.toEqual(
      new ProviderCredentialError('identityTokenMissing'),
    );
    expect(mocks.firebaseCredential).not.toHaveBeenCalled();
  });
});

describe('revokeGoogleAccess (Fase 3 — account deletion provider revocation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPlayServices.mockResolvedValue(true);
    mocks.firebaseCredential.mockImplementation((idToken) => ({ idToken }));
    mocks.signIn.mockResolvedValue({
      type: 'success',
      data: { idToken: 'fresh-google-id-token', user: { name: 'Google Person' } },
    });
  });

  it('resolves "revoked" when an active session revokes cleanly on the first try', async () => {
    mocks.revokeAccess.mockResolvedValueOnce(undefined);
    await expect(revokeGoogleAccess()).resolves.toBe('revoked');
    expect(mocks.revokeAccess).toHaveBeenCalledOnce();
    expect(mocks.signIn).not.toHaveBeenCalled(); // no fallback needed
  });

  it('falls back to an interactive sign-in once, then retries revoke, on "no session"', async () => {
    mocks.revokeAccess.mockRejectedValueOnce(new Error('no active session')).mockResolvedValueOnce(undefined);
    await expect(revokeGoogleAccess()).resolves.toBe('revoked');
    expect(mocks.signIn).toHaveBeenCalledOnce();
    expect(mocks.revokeAccess).toHaveBeenCalledTimes(2);
  });

  it('resolves "failed" when the fallback sign-in is cancelled', async () => {
    mocks.revokeAccess.mockRejectedValueOnce(new Error('no active session'));
    mocks.signIn.mockResolvedValueOnce({ type: 'cancelled' });
    await expect(revokeGoogleAccess()).resolves.toBe('failed');
    expect(mocks.revokeAccess).toHaveBeenCalledOnce(); // second call never happens
  });

  it('resolves "failed" (never throws) when revoke fails twice in a row', async () => {
    mocks.revokeAccess.mockRejectedValue(new Error('still broken'));
    await expect(revokeGoogleAccess()).resolves.toBe('failed');
  });

  it('resolves "unavailable" when the native module cannot be loaded at all', async () => {
    // Simulate the module-absent path the same way apple.native.test.ts's
    // sibling suite does not need to — google.native.ts's own loader guard
    // already returns null when TurboModuleRegistry has nothing registered.
    vi.doMock('react-native', () => ({
      NativeModules: {},
      Platform: { OS: 'android' },
      TurboModuleRegistry: { get: vi.fn(() => null) },
    }));
    vi.resetModules();
    const fresh = await import('../google.native');
    await expect(fresh.revokeGoogleAccess()).resolves.toBe('unavailable');
  });

  it('never throws — always resolves to a taxonomy value, so a UI never needs a try/catch for this', async () => {
    mocks.revokeAccess.mockRejectedValue({ weird: 'shape', not: 'an Error instance' });
    await expect(revokeGoogleAccess()).resolves.toBe('failed');
  });
});
