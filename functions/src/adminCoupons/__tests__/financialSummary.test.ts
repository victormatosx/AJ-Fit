import { describe, expect, it, vi } from 'vitest';
import type { DocumentSnapshot } from 'firebase-admin/firestore';

vi.mock('../../lib/firebaseAdmin', () => ({ db: {}, auth: {} }));
vi.mock('../../attribution/adminAuth', () => ({ requireAdminUid: vi.fn() }));

import { financialSummary } from '../adminCoupons';

function document(data: Record<string, unknown>): DocumentSnapshot {
  return { get: (field: string) => data[field] } as unknown as DocumentSnapshot;
}

describe('coupon financialSummary ledger compatibility', () => {
  it('keeps gross sales separate from signed adjustments and reads historical documents as sales', () => {
    const summary = financialSummary([
      document({
        eventType: 'INITIAL_PURCHASE',
        currency: 'BRL',
        grossRevenue: 100,
        estimatedProceeds: 75,
        taxPercentage: .1,
        storeCommissionPercentage: .15,
      }),
      document({
        eventType: 'RENEWAL',
        movementType: 'sale',
        currency: null,
        grossRevenue: null,
        estimatedProceeds: null,
        taxPercentage: null,
        storeCommissionPercentage: null,
      }),
      document({
        eventType: 'CANCELLATION',
        movementType: 'refund',
        attributionStatus: 'unresolved',
        currency: 'BRL',
        grossRevenue: -100,
        estimatedProceeds: -75,
        taxPercentage: .1,
        storeCommissionPercentage: .15,
      }),
      document({
        eventType: 'REFUND_REVERSED',
        movementType: 'refund_reversal',
        currency: 'BRL',
        grossRevenue: 100,
        estimatedProceeds: 75,
        taxPercentage: .1,
        storeCommissionPercentage: .15,
      }),
    ]);

    expect(summary).toMatchObject({
      paidTransactions: 2,
      initialPaidTransactions: 1,
      renewals: 1,
      refundsObserved: 1,
      refundReversalsObserved: 1,
      unresolvedAttributionMovements: 1,
      unknownGrossRevenueMovements: 1,
      unknownEstimatedProceedsMovements: 1,
      revenueByCurrency: { BRL: 100 },
      estimatedProceedsByCurrency: { BRL: 75 },
      refundsByCurrency: { BRL: -100 },
      refundReversalsByCurrency: { BRL: 100 },
      netRevenueByCurrency: { BRL: 100 },
      netEstimatedProceedsByCurrency: { BRL: 75 },
    });
  });

  it('never adds null, NaN, infinity, or amounts without currency to a currency bucket', () => {
    const summary = financialSummary([
      document({ eventType: 'RENEWAL', grossRevenue: 20, estimatedProceeds: 15, taxPercentage: .1, storeCommissionPercentage: .15 }),
      document({ eventType: 'RENEWAL', currency: 'USD', grossRevenue: Number.NaN, estimatedProceeds: Number.POSITIVE_INFINITY, taxPercentage: .1, storeCommissionPercentage: .15 }),
    ]);

    expect(summary.paidTransactions).toBe(2);
    expect(summary.unknownGrossRevenueMovements).toBe(1);
    expect(summary.unknownEstimatedProceedsMovements).toBe(1);
    expect(summary.revenueByCurrency).toEqual({});
    expect(summary.estimatedProceedsByCurrency).toEqual({});
    expect(summary.netRevenueByCurrency).toEqual({});
    expect(summary.netEstimatedProceedsByCurrency).toEqual({});
  });

  it('does not trust an old estimatedProceeds value when its calculation inputs are absent', () => {
    const summary = financialSummary([
      document({ eventType: 'INITIAL_PURCHASE', currency: 'BRL', grossRevenue: 100, estimatedProceeds: 100 }),
    ]);
    expect(summary.revenueByCurrency).toEqual({ BRL: 100 });
    expect(summary.estimatedProceedsByCurrency).toEqual({});
    expect(summary.netEstimatedProceedsByCurrency).toEqual({});
    expect(summary.unknownEstimatedProceedsMovements).toBe(1);
  });

  it('keeps currencies isolated and never assigns an unresolved adjustment to sales', () => {
    const summary = financialSummary([
      document({ eventType: 'RENEWAL', movementType: 'sale', currency: 'BRL', grossRevenue: 100, estimatedProceeds: 75, taxPercentage: .1, storeCommissionPercentage: .15 }),
      document({ eventType: 'RENEWAL', movementType: 'sale', currency: 'USD', grossRevenue: 20, estimatedProceeds: 15, taxPercentage: .1, storeCommissionPercentage: .15 }),
      document({ eventType: 'CANCELLATION', movementType: 'refund', attributionStatus: 'unresolved', currency: 'USD', grossRevenue: -20, estimatedProceeds: -15, taxPercentage: .1, storeCommissionPercentage: .15 }),
    ]);
    expect(summary.revenueByCurrency).toEqual({ BRL: 100, USD: 20 });
    expect(summary.netRevenueByCurrency).toEqual({ BRL: 100, USD: 0 });
    expect(summary.paidTransactions).toBe(2);
    expect(summary.unresolvedAttributionMovements).toBe(1);
  });
});
