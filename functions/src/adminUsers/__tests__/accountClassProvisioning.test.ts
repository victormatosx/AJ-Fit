import type { CallableRequest } from 'firebase-functions/v2/https';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminUidMock = vi.hoisted(() => vi.fn());
vi.mock('../../attribution/adminAuth', () => ({ requireAdminUid: requireAdminUidMock }));

const state = vi.hoisted(() => ({
  users: new Map<string, Record<string, unknown>>(),
}));

const updateMock = vi.hoisted(() => vi.fn(async (uid: string, patch: Record<string, unknown>) => {
  const flat = state.users.get(uid) ?? {};
  for (const [key, value] of Object.entries(patch)) {
    // Only 'metadata.x' dot-paths are ever written by this module.
    const [, field] = key.split('.');
    flat.metadata = { ...(flat.metadata as Record<string, unknown> ?? {}), [field]: value };
  }
  state.users.set(uid, flat);
}));

const dbMock = vi.hoisted(() => ({
  collection: vi.fn((name: string) => {
    if (name !== 'users') throw new Error(`unexpected collection ${name}`);
    return {
      doc: (uid: string) => ({
        get: async () => {
          const data = state.users.get(uid);
          return { exists: data !== undefined, get: (path: string) => path.split('.').reduce((acc: unknown, key) => (acc as Record<string, unknown> | undefined)?.[key], data) };
        },
        update: (patch: Record<string, unknown>) => updateMock(uid, patch),
      }),
    };
  }),
}));

vi.mock('../../lib/firebaseAdmin', () => ({ db: dbMock }));

const logger = vi.hoisted(() => ({ logInfo: vi.fn(), logFunctionError: vi.fn() }));
vi.mock('../../lib/logger', () => logger);

import { adminSetAccountClassHandler, provisionAccountClass } from '../accountClassProvisioning';

function request<T>(data: T, authUid: string | null): CallableRequest<T> {
  return {
    data,
    auth: authUid !== null ? { uid: authUid, token: {} as never } : undefined,
  } as CallableRequest<T>;
}

const ADMIN_UID = 'admin-1';
const TARGET_UID = 'target-1';

beforeEach(() => {
  state.users.clear();
  updateMock.mockClear();
  requireAdminUidMock.mockReset();
  requireAdminUidMock.mockResolvedValue(ADMIN_UID);
});

describe('adminSetAccountClassHandler', () => {
  it('requires an authorized admin', async () => {
    requireAdminUidMock.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(adminSetAccountClassHandler(request({ uid: TARGET_UID, accountClass: 'INTERNAL_QA' }, null)))
      .rejects.toThrow();
  });

  it('rejects an unknown target uid', async () => {
    await expect(adminSetAccountClassHandler(request({ uid: 'ghost', accountClass: 'INTERNAL_QA' }, ADMIN_UID)))
      .rejects.toThrow();
  });

  it('rejects an invalid accountClass value, including SANDBOX (not a valid account class)', async () => {
    state.users.set(TARGET_UID, { metadata: {} });
    await expect(adminSetAccountClassHandler(request({ uid: TARGET_UID, accountClass: 'SANDBOX' }, ADMIN_UID)))
      .rejects.toThrow();
  });

  it('moves an account from the implicit PRODUCTION default to INTERNAL_QA', async () => {
    state.users.set(TARGET_UID, { metadata: {} });
    const result = await adminSetAccountClassHandler(request({ uid: TARGET_UID, accountClass: 'INTERNAL_QA' }, ADMIN_UID));
    expect(result).toMatchObject({ uid: TARGET_UID, accountClass: 'INTERNAL_QA', changed: true });
    expect(state.users.get(TARGET_UID)?.metadata).toMatchObject({ accountClass: 'INTERNAL_QA' });
  });

  it('is a no-op (changed: false) when the account is already in the target class', async () => {
    state.users.set(TARGET_UID, { metadata: { accountClass: 'INTERNAL_QA' } });
    const result = await adminSetAccountClassHandler(request({ uid: TARGET_UID, accountClass: 'INTERNAL_QA' }, ADMIN_UID));
    expect(result).toMatchObject({ changed: false });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('moves an account back from INTERNAL_QA to PRODUCTION', async () => {
    state.users.set(TARGET_UID, { metadata: { accountClass: 'INTERNAL_QA' } });
    const result = await adminSetAccountClassHandler(request({ uid: TARGET_UID, accountClass: 'PRODUCTION' }, ADMIN_UID));
    expect(result).toMatchObject({ accountClass: 'PRODUCTION', changed: true });
  });
});

describe('provisionAccountClass — onUserProvisioned core', () => {
  function fakeSnapshot(data: Record<string, unknown>) {
    const ref = { update: vi.fn(async (patch: Record<string, unknown>) => Object.assign(data, { metadata: { ...(data.metadata as object ?? {}), accountClass: patch['metadata.accountClass'] } })) };
    return {
      ref,
      get: (path: string) => path.split('.').reduce((acc: unknown, key) => (acc as Record<string, unknown> | undefined)?.[key], data),
    };
  }

  it('stamps PRODUCTION on a brand-new account with no accountClass yet', async () => {
    const snapshot = fakeSnapshot({ metadata: {} });
    await provisionAccountClass(TARGET_UID, snapshot);
    expect(snapshot.ref.update).toHaveBeenCalledWith({ 'metadata.accountClass': 'PRODUCTION' });
  });

  it('is idempotent — never overwrites an already-classified account (redelivery or a race with an admin reclassification)', async () => {
    const snapshot = fakeSnapshot({ metadata: { accountClass: 'INTERNAL_QA' } });
    await provisionAccountClass(TARGET_UID, snapshot);
    expect(snapshot.ref.update).not.toHaveBeenCalled();

    const alreadyProd = fakeSnapshot({ metadata: { accountClass: 'PRODUCTION' } });
    await provisionAccountClass(TARGET_UID, alreadyProd);
    expect(alreadyProd.ref.update).not.toHaveBeenCalled();
  });
});
