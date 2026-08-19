import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestUser = { uid: string };

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as TestUser | null },
  httpsCallable: vi.fn(),
  call: vi.fn(),
  revokeGoogleProviderAccess: vi.fn(),
  prepareAppleProviderRevocationMaterial: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ auth: mocks.auth }));
vi.mock('../../lib/firebaseFunctions', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock('../accountDeletionProviderRevocation', () => ({
  revokeGoogleProviderAccess: mocks.revokeGoogleProviderAccess,
  prepareAppleProviderRevocationMaterial: mocks.prepareAppleProviderRevocationMaterial,
}));

import { requestAccountDeletionWithProviderPreparation } from '../accountDeletionOrchestrator';

function user(uid = 'uid-1'): TestUser {
  return { uid };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.currentUser = user();
  mocks.httpsCallable.mockReturnValue(mocks.call);
  mocks.call.mockResolvedValue({
    data: { deletionId: 'del-1', status: 'REQUESTED', accepted: true, deduplicated: false, requiresReconciliation: false },
  });
  mocks.revokeGoogleProviderAccess.mockResolvedValue({ status: 'not-linked' });
  mocks.prepareAppleProviderRevocationMaterial.mockResolvedValue({ status: 'not-linked' });
});

describe('requestAccountDeletionWithProviderPreparation — no providers linked (password-only)', () => {
  it('calls the backend with an empty payload and returns accepted', async () => {
    const result = await requestAccountDeletionWithProviderPreparation();
    expect(result).toEqual({
      status: 'accepted',
      deletionId: 'del-1',
      deduplicated: false,
      requiresReconciliation: false,
    });
    expect(mocks.call).toHaveBeenCalledWith({});
  });

  it('calls Google before Apple, and Apple before the commit', async () => {
    const order: string[] = [];
    mocks.revokeGoogleProviderAccess.mockImplementation(async () => {
      order.push('google');
      return { status: 'not-linked' };
    });
    mocks.prepareAppleProviderRevocationMaterial.mockImplementation(async () => {
      order.push('apple');
      return { status: 'not-linked' };
    });
    mocks.call.mockImplementation(async () => {
      order.push('commit');
      return { data: { deletionId: 'del-1', accepted: true, deduplicated: false } };
    });
    await requestAccountDeletionWithProviderPreparation();
    expect(order).toEqual(['google', 'apple', 'commit']);
  });
});

describe('requestAccountDeletionWithProviderPreparation — identity boundary', () => {
  it('returns identity-changed with no calls at all when there is no current user', async () => {
    mocks.auth.currentUser = null;
    await expect(requestAccountDeletionWithProviderPreparation()).resolves.toEqual({
      status: 'identity-changed',
    });
    expect(mocks.revokeGoogleProviderAccess).not.toHaveBeenCalled();
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('propagates identity-changed from Google without ever reaching Apple or the commit', async () => {
    mocks.revokeGoogleProviderAccess.mockResolvedValue({ status: 'identity-changed' });
    await expect(requestAccountDeletionWithProviderPreparation()).resolves.toEqual({
      status: 'identity-changed',
    });
    expect(mocks.prepareAppleProviderRevocationMaterial).not.toHaveBeenCalled();
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('propagates identity-changed from Apple without ever reaching the commit', async () => {
    mocks.prepareAppleProviderRevocationMaterial.mockResolvedValue({ status: 'identity-changed' });
    await expect(requestAccountDeletionWithProviderPreparation()).resolves.toEqual({
      status: 'identity-changed',
    });
    expect(mocks.call).not.toHaveBeenCalled();
  });
});

describe('requestAccountDeletionWithProviderPreparation — Google gate', () => {
  it('google-revocation-failed blocks the request entirely (revoke failed)', async () => {
    mocks.revokeGoogleProviderAccess.mockResolvedValue({ status: 'failed' });
    await expect(requestAccountDeletionWithProviderPreparation()).resolves.toEqual({
      status: 'google-revocation-failed',
    });
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('google-revocation-failed blocks the request when revoke succeeded but unlink failed (§17 trade-off)', async () => {
    mocks.revokeGoogleProviderAccess.mockResolvedValue({ status: 'revoked-unlink-failed' });
    await expect(requestAccountDeletionWithProviderPreparation()).resolves.toEqual({
      status: 'google-revocation-failed',
    });
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('a successful Google revoke proceeds to the commit', async () => {
    mocks.revokeGoogleProviderAccess.mockResolvedValue({ status: 'revoked' });
    await expect(requestAccountDeletionWithProviderPreparation()).resolves.toMatchObject({ status: 'accepted' });
  });
});

describe('requestAccountDeletionWithProviderPreparation — Apple gate', () => {
  it('cancellation blocks the request entirely', async () => {
    mocks.prepareAppleProviderRevocationMaterial.mockResolvedValue({ status: 'cancelled' });
    await expect(requestAccountDeletionWithProviderPreparation()).resolves.toEqual({
      status: 'apple-preparation-cancelled',
    });
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('unavailable blocks the request entirely', async () => {
    mocks.prepareAppleProviderRevocationMaterial.mockResolvedValue({ status: 'unavailable' });
    await expect(requestAccountDeletionWithProviderPreparation()).resolves.toEqual({
      status: 'apple-preparation-unavailable',
    });
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('a ready authorizationCode is forwarded to the callable payload', async () => {
    mocks.prepareAppleProviderRevocationMaterial.mockResolvedValue({
      status: 'ready',
      authorizationCode: 'fresh-code-123',
    });
    await requestAccountDeletionWithProviderPreparation();
    expect(mocks.call).toHaveBeenCalledWith({ appleAuthorizationCode: 'fresh-code-123' });
  });
});

describe('requestAccountDeletionWithProviderPreparation — multi-provider', () => {
  it('password + Google + Apple: both preparations run, both feed into one commit', async () => {
    mocks.revokeGoogleProviderAccess.mockResolvedValue({ status: 'revoked' });
    mocks.prepareAppleProviderRevocationMaterial.mockResolvedValue({
      status: 'ready',
      authorizationCode: 'fresh-code',
    });
    const result = await requestAccountDeletionWithProviderPreparation();
    expect(result).toEqual({
      status: 'accepted',
      deletionId: 'del-1',
      deduplicated: false,
      requiresReconciliation: false,
    });
    expect(mocks.revokeGoogleProviderAccess).toHaveBeenCalledOnce();
    expect(mocks.prepareAppleProviderRevocationMaterial).toHaveBeenCalledOnce();
    expect(mocks.call).toHaveBeenCalledWith({ appleAuthorizationCode: 'fresh-code' });
  });
});

describe('requestAccountDeletionWithProviderPreparation — commit failure handling', () => {
  it('maps a callable HttpsError to request-failed with its code', async () => {
    mocks.call.mockRejectedValue(Object.assign(new Error('bad'), { code: 'functions/failed-precondition' }));
    await expect(requestAccountDeletionWithProviderPreparation()).resolves.toEqual({
      status: 'request-failed',
      code: 'failed-precondition',
    });
  });

  it('rejects a malformed response instead of trusting it', async () => {
    mocks.call.mockResolvedValue({ data: { nonsense: true } });
    await expect(requestAccountDeletionWithProviderPreparation()).resolves.toEqual({
      status: 'request-failed',
      code: 'invalid-response',
    });
  });

  it('response deduplicated:true is passed through faithfully', async () => {
    mocks.call.mockResolvedValue({
      data: { deletionId: 'del-1', accepted: true, deduplicated: true, requiresReconciliation: false },
    });
    await expect(requestAccountDeletionWithProviderPreparation()).resolves.toEqual({
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
    await expect(requestAccountDeletionWithProviderPreparation()).resolves.toEqual({
      status: 'accepted',
      deletionId: 'del-1',
      deduplicated: true,
      requiresReconciliation: true,
    });
  });
});
