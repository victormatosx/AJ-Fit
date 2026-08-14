import { Timestamp } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeDocRef {
  path: string;
}

const transactionMocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
const docMock = vi.hoisted(() => vi.fn((path: string): FakeDocRef => ({ path })));
const runTransactionMock = vi.hoisted(() =>
  vi.fn(async (operation: (transaction: unknown) => Promise<unknown>) => operation(transactionMocks)),
);

vi.mock('../../lib/firebaseAdmin', () => ({
  db: { doc: docMock, runTransaction: runTransactionMock },
  auth: {},
}));

import { PROMO_PURCHASE_INTENT_TTL_MS } from '../constants';
import {
  authorizePromoPurchaseTransactionally,
  decidePromoPurchaseIntent,
} from '../promoPurchaseIntent';
import type { PendingPromoPurchaseIntent } from '../types';

const UID = 'firebase-uid-promo-purchase';
const NOW = new Date('2026-08-13T15:00:00.000Z');
const NOW_TIMESTAMP = Timestamp.fromDate(NOW);
const IOS_PROMOTION = {
  offeringIdentifier: 'promo_7d',
  monthlyProductId: 'ajfit_premium_monthly_promo',
  annualProductId: 'ajfit_premium_annual_promo',
};

function redemption(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: UID,
    couponCode: 'ARNALDO',
    campaignId: 'campaign-arnaldo',
    influencerId: 'ARNALDO',
    iosPromotion: IOS_PROMOTION,
    lockedAt: null,
    trialStartedAt: null,
    convertedAt: null,
    ...overrides,
  };
}

function intent(
  overrides: Partial<PendingPromoPurchaseIntent> = {},
): PendingPromoPurchaseIntent {
  return {
    campaignId: 'campaign-arnaldo',
    plan: 'monthly',
    expectedProductId: IOS_PROMOTION.monthlyProductId,
    offeringIdentifier: IOS_PROMOTION.offeringIdentifier,
    status: 'purchase_pending',
    createdAt: NOW_TIMESTAMP,
    updatedAt: NOW_TIMESTAMP,
    expiresAt: Timestamp.fromMillis(NOW.getTime() + PROMO_PURCHASE_INTENT_TTL_MS),
    ...overrides,
  };
}

function mockSnapshot(data?: Record<string, unknown>) {
  transactionMocks.get.mockResolvedValue({
    exists: data !== undefined,
    data: () => data,
  });
}

describe('decidePromoPurchaseIntent (pure)', () => {
  it('reuses the exact active logical intent without extending its expiration', () => {
    const existing = intent();
    const result = decidePromoPurchaseIntent(
      existing,
      {
        campaignId: existing.campaignId,
        plan: existing.plan,
        expectedProductId: existing.expectedProductId,
        offeringIdentifier: existing.offeringIdentifier,
      },
      NOW_TIMESTAMP,
    );
    expect(result).toEqual({ action: 'reuse', intent: existing });
    if (result.action === 'reuse') {
      expect(result.intent.expiresAt).toBe(existing.expiresAt);
    }
  });

  it('rejects a different plan while an intent is active', () => {
    expect(
      decidePromoPurchaseIntent(
        intent(),
        {
          campaignId: 'campaign-arnaldo',
          plan: 'annual',
          expectedProductId: IOS_PROMOTION.annualProductId,
          offeringIdentifier: IOS_PROMOTION.offeringIdentifier,
        },
        NOW_TIMESTAMP,
      ),
    ).toEqual({ action: 'conflict' });
  });

  it('allows an expired intent to be replaced', () => {
    const expired = intent({ expiresAt: NOW_TIMESTAMP });
    expect(
      decidePromoPurchaseIntent(
        expired,
        {
          campaignId: 'campaign-arnaldo',
          plan: 'annual',
          expectedProductId: IOS_PROMOTION.annualProductId,
          offeringIdentifier: IOS_PROMOTION.offeringIdentifier,
        },
        NOW_TIMESTAMP,
      ),
    ).toEqual({ action: 'create' });
  });

  it('never treats a confirmed intent as reusable authorization', () => {
    const pending = intent();
    expect(
      decidePromoPurchaseIntent(
        {
          ...pending,
          status: 'purchase_confirmed',
          confirmedAt: NOW_TIMESTAMP,
          revenueCatEventId: 'evt-confirmed',
        },
        {
          campaignId: pending.campaignId,
          plan: pending.plan,
          expectedProductId: pending.expectedProductId,
          offeringIdentifier: pending.offeringIdentifier,
        },
        NOW_TIMESTAMP,
      ),
    ).toEqual({ action: 'conflict' });
  });
});

describe('authorizePromoPurchaseTransactionally', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    transactionMocks.get.mockReset();
    transactionMocks.set.mockReset();
    docMock.mockClear();
    runTransactionMock.mockReset();
    runTransactionMock.mockImplementation(async (operation) => operation(transactionMocks));
  });

  afterEach(() => vi.useRealTimers());

  it.each([
    ['monthly', IOS_PROMOTION.monthlyProductId],
    ['annual', IOS_PROMOTION.annualProductId],
  ] as const)('creates purchase_pending for %s from the redemption snapshot', async (plan, productId) => {
    mockSnapshot(redemption());

    const result = await authorizePromoPurchaseTransactionally(UID, plan);

    expect(result).toMatchObject({
      status: 'authorized',
      reused: false,
      intent: {
        campaignId: 'campaign-arnaldo',
        plan,
        expectedProductId: productId,
        offeringIdentifier: 'promo_7d',
        status: 'purchase_pending',
      },
    });
    const write = transactionMocks.set.mock.calls[0];
    expect((write[1] as Record<string, unknown>).purchaseIntent).toMatchObject({
      plan,
      expectedProductId: productId,
    });
    expect(write[2]).toEqual({ merge: true });
  });

  it('uses only couponRedemptions/{uid}; a later catalog change cannot alter the stored snapshot', async () => {
    mockSnapshot(redemption());

    const result = await authorizePromoPurchaseTransactionally(UID, 'monthly');

    expect(result).toMatchObject({
      intent: {
        offeringIdentifier: 'promo_7d',
        expectedProductId: 'ajfit_premium_monthly_promo',
      },
    });
    expect(docMock).toHaveBeenCalledTimes(1);
    expect(docMock).toHaveBeenCalledWith(`couponRedemptions/${UID}`);
  });

  it('returns no_redemption and writes nothing when the uid has no redemption', async () => {
    mockSnapshot();
    await expect(authorizePromoPurchaseTransactionally(UID, 'monthly')).resolves.toEqual({
      status: 'no_redemption',
    });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['partial', { offeringIdentifier: 'promo_7d', monthlyProductId: 'monthly' }],
    ['blank', { offeringIdentifier: ' ', monthlyProductId: 'monthly', annualProductId: 'annual' }],
  ])('fails closed when iosPromotion is %s', async (_label, iosPromotion) => {
    mockSnapshot(redemption({ iosPromotion }));
    await expect(authorizePromoPurchaseTransactionally(UID, 'monthly')).resolves.toEqual({
      status: 'ios_promotion_unavailable',
    });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it.each(['lockedAt', 'trialStartedAt', 'convertedAt'] as const)(
    'does not authorize when %s is already set',
    async (field) => {
      mockSnapshot(redemption({ [field]: NOW_TIMESTAMP }));
      await expect(authorizePromoPurchaseTransactionally(UID, 'monthly')).resolves.toEqual({
        status: 'redemption_consumed',
      });
      expect(transactionMocks.set).not.toHaveBeenCalled();
    },
  );

  it('is idempotent for monthly retry and performs no write or timestamp extension', async () => {
    const existing = intent();
    mockSnapshot(redemption({ purchaseIntent: existing }));

    const result = await authorizePromoPurchaseTransactionally(UID, 'monthly');

    expect(result).toEqual({ status: 'authorized', intent: existing, reused: true });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('does not silently replace an active monthly intent with annual', async () => {
    mockSnapshot(redemption({ purchaseIntent: intent() }));
    await expect(authorizePromoPurchaseTransactionally(UID, 'annual')).resolves.toEqual({
      status: 'intent_conflict',
    });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('does not silently replace an active intent associated with another campaign', async () => {
    mockSnapshot(
      redemption({
        purchaseIntent: intent({ campaignId: 'campaign-other' }),
      }),
    );
    await expect(authorizePromoPurchaseTransactionally(UID, 'monthly')).resolves.toEqual({
      status: 'intent_conflict',
    });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('replaces an expired intent with a fresh fixed 10-minute window', async () => {
    mockSnapshot(
      redemption({
        purchaseIntent: intent({ expiresAt: Timestamp.fromMillis(NOW.getTime() - 1) }),
      }),
    );

    const result = await authorizePromoPurchaseTransactionally(UID, 'annual');

    expect(result).toMatchObject({ status: 'authorized', reused: false });
    if (result.status === 'authorized') {
      expect(result.intent.createdAt.toMillis()).toBe(NOW.getTime());
      expect(result.intent.expiresAt.toMillis()).toBe(NOW.getTime() + PROMO_PURCHASE_INTENT_TTL_MS);
    }
  });

  it('does not set consumption state or any Premium/subscription field', async () => {
    mockSnapshot(redemption());
    await authorizePromoPurchaseTransactionally(UID, 'monthly');

    const payload = transactionMocks.set.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('lockedAt');
    expect(payload).not.toHaveProperty('trialStartedAt');
    expect(payload).not.toHaveProperty('convertedAt');
    expect(payload).not.toHaveProperty('subscription');
    expect(payload).not.toHaveProperty('premium');
  });

  it('concurrent monthly and annual calls leave only one active intent in the transactional model', async () => {
    let stored = redemption();
    let queue = Promise.resolve();
    runTransactionMock.mockImplementation((operation) => {
      const pending = queue.then(async () => {
        let write: Record<string, unknown> | undefined;
        const transaction = {
          get: vi.fn(async () => ({ exists: true, data: () => stored })),
          set: vi.fn((_ref: FakeDocRef, value: Record<string, unknown>) => {
            write = value;
          }),
        };
        const result = await operation(transaction);
        if (write) stored = { ...stored, ...write };
        return result;
      });
      queue = pending.then(() => undefined, () => undefined);
      return pending;
    });

    const results = await Promise.all([
      authorizePromoPurchaseTransactionally(UID, 'monthly'),
      authorizePromoPurchaseTransactionally(UID, 'annual'),
    ]);

    expect(results.filter((result) => result.status === 'authorized')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'intent_conflict')).toHaveLength(1);
    expect(stored.purchaseIntent).toMatchObject({ status: 'purchase_pending' });
  });
});
