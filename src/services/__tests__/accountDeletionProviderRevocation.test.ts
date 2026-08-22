import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestUser = { uid: string; providerData: Array<{ providerId: string }> };

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as TestUser | null },
  revokeGoogleAccess: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ auth: mocks.auth }));
vi.mock('../providers/google.native', () => ({
  revokeGoogleAccess: mocks.revokeGoogleAccess,
}));
vi.mock('firebase/auth', () => ({ unlink: mocks.unlink }));

import { revokeGoogleProviderAccess } from '../accountDeletionProviderRevocation';

function user(uid = 'uid-1', providers: string[] = ['password', 'google.com']): TestUser {
  return { uid, providerData: providers.map((providerId) => ({ providerId })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.currentUser = user();
  mocks.revokeGoogleAccess.mockResolvedValue('revoked');
  mocks.unlink.mockResolvedValue(undefined);
});

// Fase 16 (Apple prompt consolidation) REMOVED `prepareAppleProviderRevocationMaterial`
// from this module entirely — Apple's material capture moved to
// `accountDeletionReauth.ts`'s `startAccountDeletionReauthentication`, the
// SAME native sign-in that proves Firebase recent-auth. Its own test
// coverage lives in `accountDeletionReauth.test.ts` now. Google is
// UNCHANGED — every test below is unmodified by Fase 16.
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

  it('a password-only user: reports not-linked, never opens a native sheet', async () => {
    mocks.auth.currentUser = user('uid-1', ['password']);
    await expect(revokeGoogleProviderAccess('uid-1')).resolves.toEqual({ status: 'not-linked' });
    expect(mocks.revokeGoogleAccess).not.toHaveBeenCalled();
  });

  it('a triple-provider user (password+apple+google): Google proceeds independently of Apple linkage', async () => {
    mocks.auth.currentUser = user('uid-1', ['password', 'apple.com', 'google.com']);
    await expect(revokeGoogleProviderAccess('uid-1')).resolves.toEqual({ status: 'revoked' });
  });
});
