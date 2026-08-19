import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SocialAuthCancelledError } from '../providers/types';

type TestUser = { uid: string; providerData: Array<{ providerId: string }> };

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as TestUser | null },
  getAppleCredentialForAccountDeletion: vi.fn(),
  revokeGoogleAccess: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ auth: mocks.auth }));
vi.mock('../providers/apple.native', () => ({
  getAppleCredentialForAccountDeletion: mocks.getAppleCredentialForAccountDeletion,
}));
vi.mock('../providers/google.native', () => ({
  revokeGoogleAccess: mocks.revokeGoogleAccess,
}));
vi.mock('firebase/auth', () => ({ unlink: mocks.unlink }));

import {
  prepareAppleProviderRevocationMaterial,
  revokeGoogleProviderAccess,
} from '../accountDeletionProviderRevocation';

function user(uid = 'uid-1', providers: string[] = ['password', 'google.com', 'apple.com']): TestUser {
  return { uid, providerData: providers.map((providerId) => ({ providerId })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.currentUser = user();
  mocks.getAppleCredentialForAccountDeletion.mockResolvedValue({
    credential: { fake: true },
    displayName: null,
    authorizationCode: 'fresh-code',
  });
  mocks.revokeGoogleAccess.mockResolvedValue('revoked');
  mocks.unlink.mockResolvedValue(undefined);
});

describe('prepareAppleProviderRevocationMaterial', () => {
  it('returns not-linked without opening the Apple sheet when apple.com is not linked', async () => {
    mocks.auth.currentUser = user('uid-1', ['password', 'google.com']);
    await expect(prepareAppleProviderRevocationMaterial('uid-1')).resolves.toEqual({
      status: 'not-linked',
    });
    expect(mocks.getAppleCredentialForAccountDeletion).not.toHaveBeenCalled();
  });

  it('returns identity-changed if the caller-supplied expectedUid does not match the current session', async () => {
    mocks.auth.currentUser = user('uid-1');
    await expect(prepareAppleProviderRevocationMaterial('a-different-uid')).resolves.toEqual({
      status: 'identity-changed',
    });
    expect(mocks.getAppleCredentialForAccountDeletion).not.toHaveBeenCalled();
  });

  it('returns identity-changed when there is no current user at all', async () => {
    mocks.auth.currentUser = null;
    await expect(prepareAppleProviderRevocationMaterial('uid-1')).resolves.toEqual({
      status: 'identity-changed',
    });
  });

  it('returns ready with the authorizationCode on success', async () => {
    await expect(prepareAppleProviderRevocationMaterial('uid-1')).resolves.toEqual({
      status: 'ready',
      authorizationCode: 'fresh-code',
    });
  });

  it('returns cancelled when the user dismisses the Apple sheet', async () => {
    mocks.getAppleCredentialForAccountDeletion.mockRejectedValue(new SocialAuthCancelledError());
    await expect(prepareAppleProviderRevocationMaterial('uid-1')).resolves.toEqual({
      status: 'cancelled',
    });
  });

  it('returns unavailable on any other provider error, never throwing a raw error', async () => {
    mocks.getAppleCredentialForAccountDeletion.mockRejectedValue(new Error('native module missing'));
    await expect(prepareAppleProviderRevocationMaterial('uid-1')).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('detects an identity change that happens WHILE the Apple sheet is open (Fase 2 §14 pattern)', async () => {
    mocks.getAppleCredentialForAccountDeletion.mockImplementation(async () => {
      mocks.auth.currentUser = user('a-different-uid-that-appeared-mid-flow');
      return { credential: {}, displayName: null, authorizationCode: 'fresh-code' };
    });
    await expect(prepareAppleProviderRevocationMaterial('uid-1')).resolves.toEqual({
      status: 'identity-changed',
    });
  });

  it('never persists, logs, or otherwise retains the authorizationCode beyond the returned value', async () => {
    const result = await prepareAppleProviderRevocationMaterial('uid-1');
    expect(result).toEqual({ status: 'ready', authorizationCode: 'fresh-code' });
    // No AsyncStorage/SecureStore/Firestore mock exists in this test file at
    // all — if the module under test tried to call any of them, this test
    // would fail with an unresolved-module error, not silently pass.
  });
});

describe('revokeGoogleProviderAccess', () => {
  it('returns not-linked without calling revokeGoogleAccess when google.com is not linked', async () => {
    mocks.auth.currentUser = user('uid-1', ['password', 'apple.com']);
    await expect(revokeGoogleProviderAccess('uid-1')).resolves.toEqual({ status: 'not-linked' });
    expect(mocks.revokeGoogleAccess).not.toHaveBeenCalled();
  });

  it('returns identity-changed when expectedUid does not match', async () => {
    await expect(revokeGoogleProviderAccess('someone-else')).resolves.toEqual({
      status: 'identity-changed',
    });
    expect(mocks.revokeGoogleAccess).not.toHaveBeenCalled();
  });

  it('returns revoked on success, and unlinks google.com from the Firebase user (Fase 3/5 correction)', async () => {
    await expect(revokeGoogleProviderAccess('uid-1')).resolves.toEqual({ status: 'revoked' });
    expect(mocks.unlink).toHaveBeenCalledWith(mocks.auth.currentUser, 'google.com');
  });

  it('returns failed when the underlying revoke fails, and never attempts unlink', async () => {
    mocks.revokeGoogleAccess.mockResolvedValue('failed');
    await expect(revokeGoogleProviderAccess('uid-1')).resolves.toEqual({ status: 'failed' });
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it('returns failed when the native module is unavailable, and never attempts unlink', async () => {
    mocks.revokeGoogleAccess.mockResolvedValue('unavailable');
    await expect(revokeGoogleProviderAccess('uid-1')).resolves.toEqual({ status: 'failed' });
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it('detects a logout that happens WHILE revokeAccess is in flight', async () => {
    mocks.revokeGoogleAccess.mockImplementation(async () => {
      mocks.auth.currentUser = null;
      return 'revoked';
    });
    await expect(revokeGoogleProviderAccess('uid-1')).resolves.toEqual({
      status: 'identity-changed',
    });
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it('returns revoked-unlink-failed when revoke succeeds but unlink() itself fails (Fase 3/5 correction §17 trade-off)', async () => {
    mocks.unlink.mockRejectedValue(new Error('network error'));
    await expect(revokeGoogleProviderAccess('uid-1')).resolves.toEqual({
      status: 'revoked-unlink-failed',
    });
  });

  it('detects an identity change that happens WHILE unlink is in flight', async () => {
    mocks.unlink.mockImplementation(async () => {
      mocks.auth.currentUser = null;
    });
    await expect(revokeGoogleProviderAccess('uid-1')).resolves.toEqual({
      status: 'identity-changed',
    });
  });
});

describe('multi-provider independence', () => {
  it('an apple-only user: Google reports not-linked, Apple proceeds normally', async () => {
    mocks.auth.currentUser = user('uid-1', ['password', 'apple.com']);
    await expect(revokeGoogleProviderAccess('uid-1')).resolves.toEqual({ status: 'not-linked' });
    await expect(prepareAppleProviderRevocationMaterial('uid-1')).resolves.toMatchObject({
      status: 'ready',
    });
  });

  it('a google-only user: Apple reports not-linked, Google proceeds normally', async () => {
    mocks.auth.currentUser = user('uid-1', ['password', 'google.com']);
    await expect(prepareAppleProviderRevocationMaterial('uid-1')).resolves.toEqual({
      status: 'not-linked',
    });
    await expect(revokeGoogleProviderAccess('uid-1')).resolves.toEqual({ status: 'revoked' });
  });

  it('a password-only user: both report not-linked, neither opens a native sheet', async () => {
    mocks.auth.currentUser = user('uid-1', ['password']);
    await expect(prepareAppleProviderRevocationMaterial('uid-1')).resolves.toEqual({
      status: 'not-linked',
    });
    await expect(revokeGoogleProviderAccess('uid-1')).resolves.toEqual({ status: 'not-linked' });
    expect(mocks.getAppleCredentialForAccountDeletion).not.toHaveBeenCalled();
    expect(mocks.revokeGoogleAccess).not.toHaveBeenCalled();
  });

  it('a triple-provider user (password+apple+google): both Apple and Google proceed independently', async () => {
    mocks.auth.currentUser = user('uid-1', ['password', 'apple.com', 'google.com']);
    await expect(prepareAppleProviderRevocationMaterial('uid-1')).resolves.toMatchObject({
      status: 'ready',
    });
    await expect(revokeGoogleProviderAccess('uid-1')).resolves.toEqual({ status: 'revoked' });
  });
});
