import type { CallableRequest } from 'firebase-functions/v2/https';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminUidMock = vi.hoisted(() => vi.fn());
vi.mock('../../attribution/adminAuth', () => ({ requireAdminUid: requireAdminUidMock }));

function fakeDoc(id: string, accountClass: unknown) {
  const data = { profile: {}, metadata: accountClass === undefined ? {} : { accountClass }, subscription: {} };
  return {
    id,
    get: (field: string) => (field === 'metadata.accountClass' ? accountClass : undefined),
    data: () => data,
  };
}

const queryMock = vi.hoisted(() => {
  const calls: { where: [string, string, unknown][] } = { where: [] };
  const state = { scanDocs: [] as ReturnType<typeof fakeDoc>[] };
  const query = {
    where: vi.fn((field: string, op: string, value: unknown) => {
      calls.where.push([field, op, value]);
      return query;
    }),
    orderBy: vi.fn(() => query),
    startAfter: vi.fn(() => query),
    limit: vi.fn(() => ({ get: async () => ({ docs: state.scanDocs }) })),
    doc: vi.fn((id: string) => ({ id, get: async () => ({ exists: false }) })),
  };
  return { query, calls, state };
});

const dbMock = vi.hoisted(() => ({
  collection: vi.fn(() => queryMock.query),
  getAll: vi.fn(async () => []),
}));

vi.mock('../../lib/firebaseAdmin', () => ({ db: dbMock, auth: { getUsers: vi.fn(async () => ({ users: [] })) } }));

const logger = vi.hoisted(() => ({ logInfo: vi.fn(), logFunctionError: vi.fn() }));
vi.mock('../../lib/logger', () => logger);

import { adminListUsersHandler } from '../adminUsers';

const ADMIN_UID = 'admin-1';

function request<T>(data: T): CallableRequest<T> {
  return { data, auth: { uid: ADMIN_UID, token: {} as never } } as unknown as CallableRequest<T>;
}

beforeEach(() => {
  queryMock.calls.where.length = 0;
  queryMock.query.where.mockClear();
  queryMock.state.scanDocs = [];
  requireAdminUidMock.mockReset();
  requireAdminUidMock.mockResolvedValue(ADMIN_UID);
});

describe('adminListUsersHandler — accountClass Sandbox/QA contamination guard', () => {
  it('defaults to PRODUCTION-only when no accountClassFilter is given', async () => {
    await adminListUsersHandler(request({}));
    expect(queryMock.calls.where).toContainEqual(['metadata.accountClass', '==', 'PRODUCTION']);
  });

  it('shows every account only on an explicit ALL opt-in', async () => {
    await adminListUsersHandler(request({ accountClassFilter: 'ALL' }));
    expect(queryMock.calls.where.some(([field]) => field === 'metadata.accountClass')).toBe(false);
  });

  it('shows only INTERNAL_QA accounts on explicit request', async () => {
    await adminListUsersHandler(request({ accountClassFilter: 'INTERNAL_QA' }));
    expect(queryMock.calls.where).toContainEqual(['metadata.accountClass', '==', 'INTERNAL_QA']);
  });

  it('rejects an invalid accountClassFilter value, including SANDBOX (not a valid account class)', async () => {
    await expect(adminListUsersHandler(request({ accountClassFilter: 'SANDBOX' }))).rejects.toThrow();
  });

  it('rejects combining a non-default accountClassFilter with subscriptionStatus (would need a 3-field composite index)', async () => {
    await expect(adminListUsersHandler(request({ accountClassFilter: 'INTERNAL_QA', subscriptionStatus: 'ACTIVE' }))).rejects.toThrow();
  });

  it('rejects combining search with a non-default accountClassFilter', async () => {
    await expect(adminListUsersHandler(request({ search: 'alice', accountClassFilter: 'ALL' }))).rejects.toThrow();
  });

  // H: admin can identify UNKNOWN accounts explicitly.
  it('UNKNOWN filter never issues a where() on accountClass — Firestore cannot query absence directly', async () => {
    await adminListUsersHandler(request({ accountClassFilter: 'UNKNOWN' }));
    expect(queryMock.calls.where.some(([field]) => field === 'metadata.accountClass')).toBe(false);
  });

  it('UNKNOWN filter surfaces only accounts whose resolveAccountClass is UNKNOWN, excluding PRODUCTION/INTERNAL_QA', async () => {
    queryMock.state.scanDocs = [
      fakeDoc('prod-1', 'PRODUCTION'),
      fakeDoc('qa-1', 'INTERNAL_QA'),
      fakeDoc('absent-1', undefined),
      fakeDoc('malformed-1', 'SANDBOX'),
    ];
    const result = await adminListUsersHandler(request({ accountClassFilter: 'UNKNOWN' }));
    const ids = result.users.map((u: { uid: string }) => u.uid);
    expect(ids).toEqual(['absent-1', 'malformed-1']);
  });

  it('rejects combining UNKNOWN with subscriptionStatus or search, same as other non-default filters', async () => {
    await expect(adminListUsersHandler(request({ accountClassFilter: 'UNKNOWN', subscriptionStatus: 'ACTIVE' }))).rejects.toThrow();
    await expect(adminListUsersHandler(request({ accountClassFilter: 'UNKNOWN', search: 'alice' }))).rejects.toThrow();
  });
});
