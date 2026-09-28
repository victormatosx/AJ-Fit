import { describe, expect, it, vi } from 'vitest';
import type { DocumentSnapshot } from 'firebase-admin/firestore';

vi.mock('../../lib/firebaseAdmin', () => ({ db: {}, auth: {} }));
vi.mock('../../attribution/adminAuth', () => ({ requireAdminUid: vi.fn() }));

import { financialMatches, type Filters } from '../adminCoupons';

function document(data: Record<string, unknown>): DocumentSnapshot {
  return { get: (field: string) => data[field] } as unknown as DocumentSnapshot;
}

function filters(overrides: Partial<Filters> = {}): Filters {
  return {
    search: '',
    couponStatus: 'ALL',
    influencerId: '',
    subscriptionState: 'ALL',
    plan: 'ALL',
    from: null,
    to: null,
    includeSandbox: false,
    ...overrides,
  };
}

describe('financialMatches — Sandbox contamination guard', () => {
  it('excludes SANDBOX and UNKNOWN by default (PRODUCTION-only dashboard)', () => {
    expect(financialMatches(document({ environment: 'PRODUCTION' }), filters())).toBe(true);
    expect(financialMatches(document({ environment: 'SANDBOX' }), filters())).toBe(false);
    expect(financialMatches(document({ environment: 'UNKNOWN' }), filters())).toBe(false);
    expect(financialMatches(document({}), filters())).toBe(false);
  });

  it('includes every environment only when the admin explicitly opts in', () => {
    const auditFilters = filters({ includeSandbox: true });
    expect(financialMatches(document({ environment: 'PRODUCTION' }), auditFilters)).toBe(true);
    expect(financialMatches(document({ environment: 'SANDBOX' }), auditFilters)).toBe(true);
    expect(financialMatches(document({ environment: 'UNKNOWN' }), auditFilters)).toBe(true);
  });
});
