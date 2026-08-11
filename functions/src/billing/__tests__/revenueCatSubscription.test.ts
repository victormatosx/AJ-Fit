import { describe, expect, it } from 'vitest';
import type { RevenueCatSubscription } from '../revenueCatApi';
import { reconcileRevenueCatPremiumSubscriptions } from '../revenueCatSubscription';

function subscription(
  id: string,
  overrides: Partial<RevenueCatSubscription> = {},
): RevenueCatSubscription {
  return {
    id,
    customerId: 'customer-1',
    originalCustomerId: 'customer-1',
    productId: 'prod-monthly',
    startsAtMs: 1_000,
    currentPeriodStartsAtMs: 2_000,
    currentPeriodEndsAtMs: 3_000,
    endsAtMs: null,
    givesAccess: true,
    pendingPayment: false,
    autoRenewalStatus: 'will_renew',
    status: 'active',
    entitlements: [
      {
        id: 'ent-premium',
        lookupKey: 'premium',
        products: [{ id: 'prod-monthly', storeIdentifier: 'ajfit_premium_monthly' }],
      },
    ],
    environment: 'sandbox',
    store: 'app_store',
    ...overrides,
  };
}

describe('reconcileRevenueCatPremiumSubscriptions', () => {
  it('A/J: selects the only Premium subscription that currently gives access', () => {
    const result = reconcileRevenueCatPremiumSubscriptions([
      subscription('unrelated', {
        entitlements: [{ id: 'other', lookupKey: 'other', products: [] }],
      }),
      subscription('expired-premium', { givesAccess: false, status: 'expired' }),
      subscription('active-premium'),
    ]);

    expect(result).toMatchObject({
      status: 'active',
      selectedSubscriptionId: 'active-premium',
      subscription: {
        provider: 'REVENUECAT',
        entitlementActive: true,
        status: 'ACTIVE',
        productId: 'ajfit_premium_monthly',
        store: 'APP_STORE',
      },
    });
  });

  it('B: a complete response with no Premium subscription clears access with no invented details', () => {
    const result = reconcileRevenueCatPremiumSubscriptions([
      subscription('unrelated', {
        entitlements: [{ id: 'other', lookupKey: 'other', products: [] }],
      }),
    ]);

    expect(result).toEqual({
      status: 'inactive',
      selectedSubscriptionId: null,
      subscription: { provider: 'REVENUECAT', entitlementActive: false },
    });
  });

  it('maps a canceled-but-still-accessible subscription without revoking its entitlement', () => {
    const result = reconcileRevenueCatPremiumSubscriptions([
      subscription('canceling', { autoRenewalStatus: 'will_not_renew' }),
    ]);

    expect(result).toMatchObject({
      status: 'active',
      subscription: { status: 'CANCELED', entitlementActive: true },
    });
  });

  it('keeps gives_access authoritative when RevenueCat returns an unmapped future status', () => {
    const result = reconcileRevenueCatPremiumSubscriptions([
      subscription('future-status', { status: 'future_status' }),
    ]);

    expect(result).toMatchObject({
      status: 'active',
      subscription: { entitlementActive: true },
    });
    if (result.status === 'active') {
      expect(result.subscription).not.toHaveProperty('status');
    }
  });

  it('K: fails closed instead of choosing array order between active Premium subscriptions', () => {
    const first = subscription('first');
    const second = subscription('second', { environment: 'production' });

    expect(reconcileRevenueCatPremiumSubscriptions([first, second])).toEqual({
      status: 'ambiguous',
      activeCandidateCount: 2,
    });
    expect(reconcileRevenueCatPremiumSubscriptions([second, first])).toEqual({
      status: 'ambiguous',
      activeCandidateCount: 2,
    });
  });
});
