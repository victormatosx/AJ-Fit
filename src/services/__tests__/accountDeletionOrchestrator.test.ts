import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestUser = { uid: string; providerData: Array<{ providerId: string }> };

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as TestUser | null },
  httpsCallable: vi.fn(),
  call: vi.fn(),
  revokeGoogleProviderAccess: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ auth: mocks.auth }));
vi.mock('../../lib/firebaseFunctions', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock('../accountDeletionProviderRevocation', () => ({
  revokeGoogleProviderAccess: mocks.revokeGoogleProviderAccess,
}));

import { readFileSync } from 'node:fs';
import { requestAccountDeletionWithProviderPreparation } from '../accountDeletionOrchestrator';

/**
 * Fase 17 architectural invariant: the orchestrator must NEVER regain the
 * ability to open a native Apple sheet itself — that regression (the
 * original Fase 15/16 bug) is invisible to behavioral tests unless they
 * happen to assert on call counts, so this pins it structurally instead.
 */
describe('accountDeletionOrchestrator — never opens Apple itself (Fase 16 invariant)', () => {
  it('the source file has zero reference to Apple sheet-opening symbols', () => {
    const source = readFileSync(new URL('../accountDeletionOrchestrator.ts', import.meta.url), 'utf8');
    for (const forbidden of [
      'getAppleCredentialForAccountDeletion',
      'getAppleCredential',
      'AppleAuthentication',
      'prepareAppleProviderRevocationMaterial',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});

function user(uid = 'uid-1', providers: string[] = ['password']): TestUser {
  return { uid, providerData: providers.map((providerId) => ({ providerId })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.currentUser = user();
  mocks.httpsCallable.mockReturnValue(mocks.call);
  mocks.call.mockResolvedValue({
    data: { deletionId: 'del-1', status: 'REQUESTED', accepted: true, deduplicated: false, requiresReconciliation: false },
  });
  mocks.revokeGoogleProviderAccess.mockResolvedValue({ status: 'not-linked' });
});

describe('requestAccountDeletionWithProviderPreparation — no providers linked (password-only)', () => {
  it('calls the backend with an empty payload and returns accepted, with null prepared material', async () => {
    const result = await requestAccountDeletionWithProviderPreparation(null);
    expect(result).toEqual({
      status: 'accepted',
      deletionId: 'del-1',
      deduplicated: false,
      requiresReconciliation: false,
    });
    expect(mocks.call).toHaveBeenCalledWith({});
  });

  it('calls Google before the commit; never touches Apple at all for a password-only account', async () => {
    const order: string[] = [];
    mocks.revokeGoogleProviderAccess.mockImplementation(async () => {
      order.push('google');
      return { status: 'not-linked' };
    });
    mocks.call.mockImplementation(async () => {
      order.push('commit');
      return { data: { deletionId: 'del-1', accepted: true, deduplicated: false } };
    });
    await requestAccountDeletionWithProviderPreparation(null);
    expect(order).toEqual(['google', 'commit']);
  });
});

describe('requestAccountDeletionWithProviderPreparation — identity boundary', () => {
  it('returns identity-changed with no calls at all when there is no current user', async () => {
    mocks.auth.currentUser = null;
    await expect(requestAccountDeletionWithProviderPreparation(null)).resolves.toEqual({
      status: 'identity-changed',
    });
    expect(mocks.revokeGoogleProviderAccess).not.toHaveBeenCalled();
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('propagates identity-changed from Google without ever reaching the commit', async () => {
    mocks.revokeGoogleProviderAccess.mockResolvedValue({ status: 'identity-changed' });
    await expect(requestAccountDeletionWithProviderPreparation(null)).resolves.toEqual({
      status: 'identity-changed',
    });
    expect(mocks.call).not.toHaveBeenCalled();
  });
});

describe('requestAccountDeletionWithProviderPreparation — Google gate (unchanged by Fase 16)', () => {
  it('google-revocation-failed blocks the request entirely (revoke failed)', async () => {
    mocks.revokeGoogleProviderAccess.mockResolvedValue({ status: 'failed' });
    await expect(requestAccountDeletionWithProviderPreparation(null)).resolves.toEqual({
      status: 'google-revocation-failed',
    });
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('google-revocation-failed blocks the request when revoke succeeded but unlink failed (§17 trade-off)', async () => {
    mocks.revokeGoogleProviderAccess.mockResolvedValue({ status: 'revoked-unlink-failed' });
    await expect(requestAccountDeletionWithProviderPreparation(null)).resolves.toEqual({
      status: 'google-revocation-failed',
    });
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('a successful Google revoke proceeds to the commit', async () => {
    mocks.revokeGoogleProviderAccess.mockResolvedValue({ status: 'revoked' });
    await expect(requestAccountDeletionWithProviderPreparation(null)).resolves.toMatchObject({ status: 'accepted' });
  });
});

describe('requestAccountDeletionWithProviderPreparation — Apple gate (Fase 16: consumes prepared material, never opens Apple itself)', () => {
  it('apple-material-missing when apple.com is linked and no material was prepared — never opens Apple to recover', async () => {
    mocks.auth.currentUser = user('uid-1', ['apple.com']);
    await expect(requestAccountDeletionWithProviderPreparation(null)).resolves.toEqual({
      status: 'apple-material-missing',
    });
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('a prepared authorizationCode is forwarded to the callable payload, unchanged wire contract', async () => {
    mocks.auth.currentUser = user('uid-1', ['apple.com']);
    await requestAccountDeletionWithProviderPreparation('fresh-code-123');
    expect(mocks.call).toHaveBeenCalledWith({ appleAuthorizationCode: 'fresh-code-123' });
  });

  it('apple.com NOT linked: prepared material (if any, e.g. stale) is simply not required — proceeds regardless', async () => {
    mocks.auth.currentUser = user('uid-1', ['password']);
    await expect(requestAccountDeletionWithProviderPreparation(null)).resolves.toMatchObject({ status: 'accepted' });
    expect(mocks.call).toHaveBeenCalledWith({});
  });

  it('dual-linked (apple + google): Google resolves independently; Apple material is still required for the commit', async () => {
    mocks.auth.currentUser = user('uid-1', ['google.com', 'apple.com']);
    mocks.revokeGoogleProviderAccess.mockResolvedValue({ status: 'revoked' });
    await expect(requestAccountDeletionWithProviderPreparation(null)).resolves.toEqual({
      status: 'apple-material-missing',
    });
    expect(mocks.revokeGoogleProviderAccess).toHaveBeenCalledOnce();
    expect(mocks.call).not.toHaveBeenCalled();
  });
});

describe('requestAccountDeletionWithProviderPreparation — commit failure handling', () => {
  it('maps a callable HttpsError to request-failed with its code', async () => {
    mocks.call.mockRejectedValue(Object.assign(new Error('bad'), { code: 'functions/failed-precondition' }));
    await expect(requestAccountDeletionWithProviderPreparation(null)).resolves.toEqual({
      status: 'request-failed',
      code: 'failed-precondition',
    });
  });

  it('rejects a malformed response instead of trusting it', async () => {
    mocks.call.mockResolvedValue({ data: { nonsense: true } });
    await expect(requestAccountDeletionWithProviderPreparation(null)).resolves.toEqual({
      status: 'request-failed',
      code: 'invalid-response',
    });
  });

  it('response deduplicated:true is passed through faithfully', async () => {
    mocks.call.mockResolvedValue({
      data: { deletionId: 'del-1', accepted: true, deduplicated: true, requiresReconciliation: false },
    });
    await expect(requestAccountDeletionWithProviderPreparation(null)).resolves.toEqual({
      status: 'accepted',
      deletionId: 'del-1',
      deduplicated: true,
      requiresReconciliation: false,
    });
  });

  it('response requiresReconciliation:true is passed through faithfully (existing FAILED_TERMINAL operation)', async () => {
    mocks.call.mockResolvedValue({
      data: { deletionId: 'del-1', accepted: true, deduplicated: true, requiresReconciliation: true },
    });
    await expect(requestAccountDeletionWithProviderPreparation(null)).resolves.toEqual({
      status: 'accepted',
      deletionId: 'del-1',
      deduplicated: true,
      requiresReconciliation: true,
    });
  });
});
