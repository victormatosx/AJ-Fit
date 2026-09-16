import type { CallableRequest } from 'firebase-functions/v2/https';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const userGetMock = vi.hoisted(() => vi.fn());
const authGetUserMock = vi.hoisted(() => vi.fn());
const runTransactionMock = vi.hoisted(() => vi.fn());
const mainDocGetMock = vi.hoisted(() => vi.fn());
const eventsListGetMock = vi.hoisted(() => vi.fn());
const txGetMock = vi.hoisted(() => vi.fn());
const txSetMock = vi.hoisted(() => vi.fn());
const grantMock = vi.hoisted(() => vi.fn());
const revokeMock = vi.hoisted(() => vi.fn());
const entitlementSignalSetMock = vi.hoisted(() => vi.fn());

const docMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    if (path.startsWith('users/')) return { get: userGetMock };
    if (path.startsWith('entitlementSignals/')) return { set: entitlementSignalSetMock };
    return {
      get: mainDocGetMock,
      collection: (_name: string) => ({
        doc: (id?: string) => ({ id: id ?? 'evt-generated' }),
        orderBy: () => ({ limit: () => ({ get: eventsListGetMock }) }),
      }),
    };
  }),
);

vi.mock('../../lib/firebaseAdmin', () => ({
  db: { doc: docMock, runTransaction: runTransactionMock },
  auth: { getUser: authGetUserMock },
}));

const FakeRevenueCatGrantError = vi.hoisted(() =>
  class FakeRevenueCatGrantError extends Error {
    constructor(
      public readonly kind: string,
      public readonly statusCode?: number,
    ) {
      super(`fake(${kind})`);
      this.name = 'RevenueCatGrantError';
    }
  },
);

vi.mock('../../billing/revenueCatGrants', () => ({
  grantPromotionalEntitlement: grantMock,
  revokePromotionalEntitlement: revokeMock,
  RevenueCatGrantError: FakeRevenueCatGrantError,
}));

import { adminGrantFreeAccessHandler, adminRevokeFreeAccessHandler, readFreeAccessView } from '../adminFreeAccess';

const ADMIN_UID = 'admin-uid-1';
const TARGET_UID = 'target-uid-1';

function request<T>(data: T, authUid: string | null): CallableRequest<T> {
  return {
    data,
    auth: authUid !== null ? { uid: authUid, token: {} as never } : undefined,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}

function mockAdminRole(role: string | undefined) {
  userGetMock.mockResolvedValue({
    exists: role !== undefined,
    data: () => (role !== undefined ? { metadata: { role } } : undefined),
  });
}

async function expectHttpsError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

/** `state` simulates the ONE `adminAccessGrants/{uid}` doc read by `tx.get`. */
function mockCurrentState(state: { state?: 'granted' | 'revoked'; lock?: unknown } | null) {
  txGetMock.mockResolvedValue({
    exists: state !== null,
    data: () => state ?? {},
  });
}

beforeEach(() => {
  userGetMock.mockReset();
  authGetUserMock.mockReset();
  runTransactionMock.mockReset();
  mainDocGetMock.mockReset();
  eventsListGetMock.mockReset();
  txGetMock.mockReset();
  txSetMock.mockReset();
  grantMock.mockReset();
  revokeMock.mockReset();
  entitlementSignalSetMock.mockReset();
  docMock.mockClear();

  mockAdminRole('admin');
  authGetUserMock.mockResolvedValue({ uid: TARGET_UID });
  mockCurrentState(null);
  eventsListGetMock.mockResolvedValue({ docs: [] });
  mainDocGetMock.mockResolvedValue({ exists: true, data: () => ({ uid: TARGET_UID, state: 'granted' }) });
  runTransactionMock.mockImplementation(async (callback) => callback({ get: txGetMock, set: txSetMock }));
  entitlementSignalSetMock.mockResolvedValue(undefined);
});

describe('admin auth enforcement', () => {
  it('rejects an unauthenticated caller for grant', async () => {
    await expectHttpsError(
      adminGrantFreeAccessHandler(request({ uid: TARGET_UID, reason: 'teste' }, null)),
      'unauthenticated',
    );
    expect(grantMock).not.toHaveBeenCalled();
  });

  it('rejects a non-admin caller for grant', async () => {
    mockAdminRole('member');
    await expectHttpsError(
      adminGrantFreeAccessHandler(request({ uid: TARGET_UID, reason: 'teste' }, ADMIN_UID)),
      'permission-denied',
    );
    expect(grantMock).not.toHaveBeenCalled();
  });

  it('rejects a non-admin caller for revoke', async () => {
    mockAdminRole(undefined);
    await expectHttpsError(
      adminRevokeFreeAccessHandler(request({ uid: TARGET_UID }, ADMIN_UID)),
      'permission-denied',
    );
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it('never trusts an admin uid supplied in the payload', async () => {
    mockAdminRole('admin');
    // Even if the payload tried to smuggle a different admin identity, the
    // handler only ever reads `request.auth.uid` — there's no field in the
    // input types for an "actingAdminUid", so nothing to assert on the call
    // itself beyond requireAdminUid having been driven purely by `auth`.
    grantMock.mockResolvedValue({ store: 'PROMOTIONAL', expiresDateMs: null });
    await adminGrantFreeAccessHandler(request({ uid: TARGET_UID, reason: 'x' }, ADMIN_UID));
    expect(userGetMock).toHaveBeenCalled();
  });
});

describe('input validation', () => {
  it('rejects an empty uid', async () => {
    await expectHttpsError(
      adminGrantFreeAccessHandler(request({ uid: '', reason: 'teste' }, ADMIN_UID)),
      'invalid-argument',
    );
  });

  it('rejects a uid containing a path separator', async () => {
    await expectHttpsError(
      adminGrantFreeAccessHandler(request({ uid: 'a/b', reason: 'teste' }, ADMIN_UID)),
      'invalid-argument',
    );
  });

  it('rejects an empty reason on grant', async () => {
    await expectHttpsError(
      adminGrantFreeAccessHandler(request({ uid: TARGET_UID, reason: '   ' }, ADMIN_UID)),
      'invalid-argument',
    );
  });

  it('rejects a target uid that does not exist in Firebase Auth', async () => {
    authGetUserMock.mockRejectedValue({ code: 'auth/user-not-found' });
    await expectHttpsError(
      adminGrantFreeAccessHandler(request({ uid: TARGET_UID, reason: 'teste' }, ADMIN_UID)),
      'not-found',
    );
  });
});

describe('grant', () => {
  it('calls RevenueCat and records a confirmed grant', async () => {
    mockCurrentState(null);
    grantMock.mockResolvedValue({ store: 'PROMOTIONAL', expiresDateMs: 4_102_444_800_000 });
    mainDocGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ uid: TARGET_UID, state: 'granted', grantedBy: ADMIN_UID, reason: 'teste' }),
    });

    const result = await adminGrantFreeAccessHandler(
      request({ uid: TARGET_UID, reason: 'teste' }, ADMIN_UID),
    );

    expect(grantMock).toHaveBeenCalledWith(TARGET_UID, 'premium');
    expect(result.state).toBe('granted');
    expect(result.alreadyInState).toBe(false);
    // Two transactions: begin (acquire lock + pending event) and finalize
    // (clear lock + confirmed event).
    expect(runTransactionMock).toHaveBeenCalledTimes(2);
    expect(txSetMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ state: 'granted', grantedBy: ADMIN_UID }),
      expect.objectContaining({ merge: true }),
    );
  });

  it('is idempotent: a second grant while already granted never calls RevenueCat again', async () => {
    mockCurrentState({ state: 'granted' });

    const result = await adminGrantFreeAccessHandler(
      request({ uid: TARGET_UID, reason: 'teste' }, ADMIN_UID),
    );

    expect(grantMock).not.toHaveBeenCalled();
    expect(result.alreadyInState).toBe(true);
    expect(runTransactionMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a concurrent grant while a fresh lock is held', async () => {
    mockCurrentState({ lock: { operation: 'grant', lockedAtMs: Date.now(), lockedBy: 'other-admin' } });

    await expectHttpsError(
      adminGrantFreeAccessHandler(request({ uid: TARGET_UID, reason: 'teste' }, ADMIN_UID)),
      'aborted',
    );
    expect(grantMock).not.toHaveBeenCalled();
  });

  it('allows a retry once a stale lock (older than the TTL) is found', async () => {
    mockCurrentState({
      state: 'revoked',
      lock: { operation: 'grant', lockedAtMs: Date.now() - 5 * 60_000, lockedBy: 'other-admin' },
    });
    grantMock.mockResolvedValue({ store: 'PROMOTIONAL', expiresDateMs: null });

    const result = await adminGrantFreeAccessHandler(
      request({ uid: TARGET_UID, reason: 'teste' }, ADMIN_UID),
    );

    expect(grantMock).toHaveBeenCalledTimes(1);
    expect(result.alreadyInState).toBe(false);
  });

  it('surfaces a temporary RevenueCat failure as unavailable and records it as failed', async () => {
    mockCurrentState(null);
    grantMock.mockRejectedValue(new FakeRevenueCatGrantError('temporary', 503));

    await expectHttpsError(
      adminGrantFreeAccessHandler(request({ uid: TARGET_UID, reason: 'teste' }, ADMIN_UID)),
      'unavailable',
    );

    expect(txSetMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ state: 'failed', errorKind: 'temporary' }),
      expect.objectContaining({ merge: true }),
    );
  });

  it('surfaces a distinct, loudly-logged error when RevenueCat succeeds but the audit write fails after retries', async () => {
    mockCurrentState(null);
    grantMock.mockResolvedValue({ store: 'PROMOTIONAL', expiresDateMs: null });
    runTransactionMock
      .mockImplementationOnce(async (callback) => callback({ get: txGetMock, set: txSetMock })) // begin: succeeds
      .mockRejectedValue(new Error('firestore unavailable')); // every finalize attempt fails

    const promise = adminGrantFreeAccessHandler(request({ uid: TARGET_UID, reason: 'teste' }, ADMIN_UID));
    await expect(promise).rejects.toMatchObject({
      code: 'internal',
      message: 'audit_write_failed_after_revenuecat_success',
    });
    // RevenueCat itself is never called twice just because the audit write failed.
    expect(grantMock).toHaveBeenCalledTimes(1);
  });

  it('retries the audit write and succeeds once a transient Firestore failure clears', async () => {
    mockCurrentState(null);
    grantMock.mockResolvedValue({ store: 'PROMOTIONAL', expiresDateMs: null });
    mainDocGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ uid: TARGET_UID, state: 'granted', grantedBy: ADMIN_UID }),
    });
    runTransactionMock
      .mockImplementationOnce(async (callback) => callback({ get: txGetMock, set: txSetMock })) // begin
      .mockRejectedValueOnce(new Error('transient')) // finalize attempt 1
      .mockImplementationOnce(async (callback) => callback({ get: txGetMock, set: txSetMock })); // finalize attempt 2

    const result = await adminGrantFreeAccessHandler(
      request({ uid: TARGET_UID, reason: 'teste' }, ADMIN_UID),
    );

    expect(result.state).toBe('granted');
    expect(runTransactionMock).toHaveBeenCalledTimes(3);
  });
});

describe('entitlementSignals/{uid} — realtime invalidation signal', () => {
  it('touches the signal only after RevenueCat confirms AND the audit write is durable', async () => {
    mockCurrentState(null);
    grantMock.mockResolvedValue({ store: 'PROMOTIONAL', expiresDateMs: null });

    await adminGrantFreeAccessHandler(request({ uid: TARGET_UID, reason: 'teste' }, ADMIN_UID));

    expect(entitlementSignalSetMock).toHaveBeenCalledTimes(1);
    const [payload, options] = entitlementSignalSetMock.mock.calls[0];
    expect(options).toEqual({ merge: true });
    // No administrative data whatsoever — only whatever marks "something changed".
    expect(Object.keys(payload)).toEqual(['updatedAt']);
    expect(payload).not.toHaveProperty('state');
    expect(payload).not.toHaveProperty('grantedBy');
    expect(payload).not.toHaveProperty('reason');
  });

  it('touches the signal on a confirmed revoke too', async () => {
    mockCurrentState({ state: 'granted' });
    revokeMock.mockResolvedValue({ store: null, expiresDateMs: null });

    await adminRevokeFreeAccessHandler(request({ uid: TARGET_UID }, ADMIN_UID));

    expect(entitlementSignalSetMock).toHaveBeenCalledTimes(1);
  });

  it('never touches the signal on a duplicate no-op grant', async () => {
    mockCurrentState({ state: 'granted' });

    await adminGrantFreeAccessHandler(request({ uid: TARGET_UID, reason: 'teste' }, ADMIN_UID));

    expect(entitlementSignalSetMock).not.toHaveBeenCalled();
  });

  it('never touches the signal on a duplicate no-op revoke', async () => {
    mockCurrentState({ state: 'revoked' });

    await adminRevokeFreeAccessHandler(request({ uid: TARGET_UID }, ADMIN_UID));

    expect(entitlementSignalSetMock).not.toHaveBeenCalled();
  });

  it('never touches the signal when RevenueCat itself fails', async () => {
    mockCurrentState(null);
    grantMock.mockRejectedValue(new FakeRevenueCatGrantError('temporary', 503));

    await expectHttpsError(
      adminGrantFreeAccessHandler(request({ uid: TARGET_UID, reason: 'teste' }, ADMIN_UID)),
      'unavailable',
    );

    expect(entitlementSignalSetMock).not.toHaveBeenCalled();
  });

  it('never touches the signal when the audit write fails after RevenueCat succeeded', async () => {
    mockCurrentState(null);
    grantMock.mockResolvedValue({ store: 'PROMOTIONAL', expiresDateMs: null });
    runTransactionMock
      .mockImplementationOnce(async (callback) => callback({ get: txGetMock, set: txSetMock }))
      .mockRejectedValue(new Error('firestore unavailable'));

    await expect(
      adminGrantFreeAccessHandler(request({ uid: TARGET_UID, reason: 'teste' }, ADMIN_UID)),
    ).rejects.toMatchObject({ code: 'internal' });

    expect(entitlementSignalSetMock).not.toHaveBeenCalled();
  });

  it('does not fail the admin action if touching the signal itself fails (best-effort only)', async () => {
    mockCurrentState(null);
    grantMock.mockResolvedValue({ store: 'PROMOTIONAL', expiresDateMs: null });
    entitlementSignalSetMock.mockRejectedValue(new Error('entitlementSignals write failed'));

    const result = await adminGrantFreeAccessHandler(
      request({ uid: TARGET_UID, reason: 'teste' }, ADMIN_UID),
    );

    expect(result.state).toBe('granted');
  });
});

describe('touchEntitlementSignal — bounded retry', () => {
  it('1. succeeds on the first attempt — no retry needed', async () => {
    mockCurrentState(null);
    grantMock.mockResolvedValue({ store: 'PROMOTIONAL', expiresDateMs: null });

    const result = await adminGrantFreeAccessHandler(
      request({ uid: TARGET_UID, reason: 'teste' }, ADMIN_UID),
    );

    expect(entitlementSignalSetMock).toHaveBeenCalledTimes(1);
    expect(result.state).toBe('granted');
  });

  it('2. fails on the first attempt, succeeds on the second', async () => {
    mockCurrentState(null);
    grantMock.mockResolvedValue({ store: 'PROMOTIONAL', expiresDateMs: null });
    entitlementSignalSetMock
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(undefined);

    const result = await adminGrantFreeAccessHandler(
      request({ uid: TARGET_UID, reason: 'teste' }, ADMIN_UID),
    );

    expect(entitlementSignalSetMock).toHaveBeenCalledTimes(2);
    expect(result.state).toBe('granted');
    // The admin action itself never surfaces the transient hiccup.
    expect(result).not.toHaveProperty('error');
  });

  it('3. only succeeds on the third attempt', async () => {
    mockCurrentState(null);
    grantMock.mockResolvedValue({ store: 'PROMOTIONAL', expiresDateMs: null });
    entitlementSignalSetMock
      .mockRejectedValueOnce(new Error('transient 1'))
      .mockRejectedValueOnce(new Error('transient 2'))
      .mockResolvedValueOnce(undefined);

    const result = await adminGrantFreeAccessHandler(
      request({ uid: TARGET_UID, reason: 'teste' }, ADMIN_UID),
    );

    expect(entitlementSignalSetMock).toHaveBeenCalledTimes(3);
    expect(result.state).toBe('granted');
  });

  it('4. three failures give up at exactly 3 attempts and never re-run the RevenueCat call', async () => {
    mockCurrentState(null);
    grantMock.mockResolvedValue({ store: 'PROMOTIONAL', expiresDateMs: null });
    entitlementSignalSetMock.mockRejectedValue(new Error('persistent'));

    await adminGrantFreeAccessHandler(request({ uid: TARGET_UID, reason: 'teste' }, ADMIN_UID));

    expect(entitlementSignalSetMock).toHaveBeenCalledTimes(3);
    expect(grantMock).toHaveBeenCalledTimes(1);
  });

  it('5. three failures never undo the already-confirmed RevenueCat operation or the audit record', async () => {
    mockCurrentState(null);
    grantMock.mockResolvedValue({ store: 'PROMOTIONAL', expiresDateMs: null });
    entitlementSignalSetMock.mockRejectedValue(new Error('persistent'));
    mainDocGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ uid: TARGET_UID, state: 'granted', grantedBy: ADMIN_UID, reason: 'teste' }),
    });

    const result = await adminGrantFreeAccessHandler(
      request({ uid: TARGET_UID, reason: 'teste' }, ADMIN_UID),
    );

    // The grant response is unchanged: still reports the confirmed state,
    // no thrown error, no "undo"/compensating call of any kind — only the
    // best-effort realtime ping was unable to land.
    expect(result.state).toBe('granted');
    expect(result.alreadyInState).toBe(false);
    expect(revokeMock).not.toHaveBeenCalled();
    // finalizeOperation's own two transactions (begin + finalize) are not
    // re-run just because the signal failed.
    expect(runTransactionMock).toHaveBeenCalledTimes(2);
  });
});

describe('cross-operation concurrency', () => {
  it('rejects a revoke while a grant lock for the same uid is still fresh', async () => {
    mockCurrentState({
      state: 'granted',
      lock: { operation: 'grant', lockedAtMs: Date.now(), lockedBy: 'other-admin' },
    });

    await expectHttpsError(
      adminRevokeFreeAccessHandler(request({ uid: TARGET_UID }, ADMIN_UID)),
      'aborted',
    );
    expect(revokeMock).not.toHaveBeenCalled();
  });
});

describe('revoke', () => {
  it('calls RevenueCat and records a confirmed revoke without touching a paid subscription', async () => {
    mockCurrentState({ state: 'granted' });
    revokeMock.mockResolvedValue({ store: null, expiresDateMs: null });
    mainDocGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ uid: TARGET_UID, state: 'revoked', revokedBy: ADMIN_UID }),
    });

    const result = await adminRevokeFreeAccessHandler(request({ uid: TARGET_UID }, ADMIN_UID));

    expect(revokeMock).toHaveBeenCalledWith(TARGET_UID, 'premium');
    expect(grantMock).not.toHaveBeenCalled();
    expect(result.state).toBe('revoked');
  });

  it('is idempotent: revoking when never granted is a no-op that never calls RevenueCat', async () => {
    mockCurrentState(null);

    const result = await adminRevokeFreeAccessHandler(request({ uid: TARGET_UID }, ADMIN_UID));

    expect(revokeMock).not.toHaveBeenCalled();
    expect(result.alreadyInState).toBe(true);
  });

  it('is idempotent: revoking an already-revoked grant is a no-op', async () => {
    mockCurrentState({ state: 'revoked' });

    const result = await adminRevokeFreeAccessHandler(request({ uid: TARGET_UID }, ADMIN_UID));

    expect(revokeMock).not.toHaveBeenCalled();
    expect(result.alreadyInState).toBe(true);
  });
});

describe('readFreeAccessView (adminGetUser enrichment)', () => {
  it('degrades to a safe "never granted" view instead of throwing when Firestore fails', async () => {
    mainDocGetMock.mockRejectedValue(new Error('firestore unavailable'));
    eventsListGetMock.mockResolvedValue({ docs: [] });

    const view = await readFreeAccessView(TARGET_UID);

    expect(view).toEqual({
      uid: TARGET_UID,
      state: 'none',
      alreadyInState: false,
      grantedAt: null,
      grantedBy: null,
      reason: null,
      revokedAt: null,
      revokedBy: null,
      history: [],
    });
  });

  it('returns the confirmed state and history when reads succeed', async () => {
    mainDocGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ uid: TARGET_UID, state: 'granted', grantedBy: ADMIN_UID, reason: 'teste' }),
    });
    eventsListGetMock.mockResolvedValue({
      docs: [{ id: 'evt-1', data: () => ({ type: 'grant', state: 'confirmed', requestedBy: ADMIN_UID }) }],
    });

    const view = await readFreeAccessView(TARGET_UID);

    expect(view.state).toBe('granted');
    expect(view.history).toHaveLength(1);
    expect(view.history[0]).toMatchObject({ id: 'evt-1', type: 'grant', state: 'confirmed' });
  });
});
