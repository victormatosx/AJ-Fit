import { describe, expect, it, vi } from 'vitest';
import type { PurchasesPackage } from 'react-native-purchases';
import {
  classifyPromoPurchaseAuthorizationError,
  executeIOSPromoPurchase,
  iosPromoPurchaseSnapshotKey,
  parsePromoPurchaseIntentAuthorization,
  validatePromoPurchaseIntent,
  type IOSPromoPurchaseAttempt,
} from '../iosPromoPurchase';

const expiresAt = '2030-01-01T00:10:00.000Z';
const monthlyPromoProductId = 'ajfit_premium_monthly_promo';
const annualPromoProductId = 'ajfit_premium_annual_promo';
const attempt: IOSPromoPurchaseAttempt = {
  plan: 'monthly',
  authorization: {
    offeringIdentifier: 'promo_7d',
    monthlyProductId: monthlyPromoProductId,
    annualProductId: annualPromoProductId,
  },
  package: {
    identifier: '$rc_monthly',
    packageType: 'MONTHLY',
    product: { identifier: monthlyPromoProductId },
  } as PurchasesPackage,
};
const response = {
  authorized: true as const,
  purchaseIntent: {
    plan: 'monthly' as const,
    offeringIdentifier: 'promo_7d',
    expectedProductId: monthlyPromoProductId,
    status: 'purchase_pending' as const,
    expiresAt,
  },
};

describe('iOS promotional purchase intent', () => {
  it('classifies intent conflict and authentication failures without exposing details', () => {
    expect(
      classifyPromoPurchaseAuthorizationError({
        code: 'functions/failed-precondition',
        message: 'promo_purchase_intent_conflict',
      }),
    ).toBe('conflict');
    expect(
      classifyPromoPurchaseAuthorizationError({ code: 'functions/unauthenticated' }),
    ).toBe('unauthenticated');
  });

  it('strictly parses the exact callable response and rejects extra/malformed fields', () => {
    expect(parsePromoPurchaseIntentAuthorization(response)).toEqual(response);
    expect(parsePromoPurchaseIntentAuthorization({ ...response, uid: 'forbidden' })).toBeNull();
    expect(parsePromoPurchaseIntentAuthorization({ authorized: true })).toBeNull();
    expect(
      parsePromoPurchaseIntentAuthorization({
        ...response,
        purchaseIntent: { ...response.purchaseIntent, expectedProductId: ` ${monthlyPromoProductId}` },
      }),
    ).toBeNull();
    expect(
      parsePromoPurchaseIntentAuthorization({
        ...response,
        purchaseIntent: { ...response.purchaseIntent, expiresAt: '2030-01-01' },
      }),
    ).toBeNull();
    expect(parsePromoPurchaseIntentAuthorization({ ...response, authorized: false })).toBeNull();
    const { expiresAt: _expiresAt, ...withoutExpiry } = response.purchaseIntent;
    expect(
      parsePromoPurchaseIntentAuthorization({ ...response, purchaseIntent: withoutExpiry }),
    ).toBeNull();
    expect(
      parsePromoPurchaseIntentAuthorization({
        ...response,
        purchaseIntent: { ...response.purchaseIntent, unexpected: true },
      }),
    ).toBeNull();
  });

  it.each([
    ['plan_mismatch', { plan: 'annual' }],
    ['offering_mismatch', { offeringIdentifier: 'wrong' }],
    ['product_mismatch', { expectedProductId: annualPromoProductId }],
    ['status_mismatch', { status: 'purchase_confirmed' }],
  ] as const)('fails closed on %s', (reason, overrides) => {
    const malformed = {
      ...response,
      purchaseIntent: { ...response.purchaseIntent, ...overrides },
    } as typeof response;
    expect(validatePromoPurchaseIntent(malformed, attempt, Date.parse(expiresAt) - 1)).toEqual({
      status: 'invalid',
      reason,
    });
  });

  it('rejects an expired intent immediately before purchase', () => {
    expect(validatePromoPurchaseIntent(response, attempt, Date.parse(expiresAt))).toEqual({
      status: 'invalid',
      reason: 'expired',
    });
  });

  it('rechecks TTL after validation and before invoking purchase', async () => {
    const purchase = vi.fn();
    const timeline = [Date.parse(expiresAt) - 1, Date.parse(expiresAt)];
    const result = await executeIOSPromoPurchase({
      attempt,
      authorize: vi.fn().mockResolvedValue({ status: 'authorized', response }),
      purchase,
      isCurrent: () => true,
      now: () => timeline.shift() ?? Date.parse(expiresAt),
    });
    expect(result).toEqual({ status: 'intent_invalid', reason: 'expired' });
    expect(purchase).not.toHaveBeenCalled();
  });

  it.each(['monthly', 'annual'] as const)('authorizes then purchases the exact %s promo package', async (plan) => {
    const expectedProductId =
      plan === 'monthly' ? monthlyPromoProductId : annualPromoProductId;
    const currentAttempt = {
      ...attempt,
      plan,
      package: {
        ...attempt.package,
        packageType: plan === 'monthly' ? 'MONTHLY' : 'ANNUAL',
        product: { identifier: expectedProductId },
      } as PurchasesPackage,
    };
    const authorize = vi.fn().mockResolvedValue({
      status: 'authorized',
      response: {
        ...response,
        purchaseIntent: {
          ...response.purchaseIntent,
          plan,
          expectedProductId,
        },
      },
    });
    const purchase = vi.fn().mockResolvedValue({ status: 'cancelled' });
    const result = await executeIOSPromoPurchase({
      attempt: currentAttempt,
      authorize,
      purchase,
      isCurrent: () => true,
      now: () => Date.parse(expiresAt) - 1000,
    });
    expect(authorize).toHaveBeenCalledWith(plan);
    expect(purchase).toHaveBeenCalledWith(currentAttempt.package);
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(
      purchase.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({ status: 'purchased', result: { status: 'cancelled' } });
  });

  it.each(['conflict', 'temporary'] as const)('never purchases after authorization %s', async (reason) => {
    const purchase = vi.fn();
    const result = await executeIOSPromoPurchase({
      attempt,
      authorize: vi.fn().mockResolvedValue({ status: 'failed', reason }),
      purchase,
      isCurrent: () => true,
    });
    expect(result.status).toBe('authorization_failed');
    expect(purchase).not.toHaveBeenCalled();
  });

  it('discards a late response after UID/coupon/plan snapshot changes', async () => {
    let current = true;
    const purchase = vi.fn();
    const authorize = vi.fn().mockImplementation(async () => {
      current = false;
      return { status: 'authorized', response };
    });
    expect(
      await executeIOSPromoPurchase({ attempt, authorize, purchase, isCurrent: () => current }),
    ).toEqual({ status: 'stale' });
    expect(purchase).not.toHaveBeenCalled();
  });

  it('snapshot key changes for UID, generation, coupon, plan, or package', () => {
    const base = { uid: 'A', generation: 1, code: 'ONE', attempt };
    const key = iosPromoPurchaseSnapshotKey(base);
    expect(iosPromoPurchaseSnapshotKey({ ...base, uid: 'B' })).not.toBe(key);
    expect(iosPromoPurchaseSnapshotKey({ ...base, generation: 2 })).not.toBe(key);
    expect(iosPromoPurchaseSnapshotKey({ ...base, code: 'TWO' })).not.toBe(key);
    expect(iosPromoPurchaseSnapshotKey({ ...base, attempt: { ...attempt, plan: 'annual' } })).not.toBe(key);
  });
});
