import { describe, expect, it } from 'vitest';
import type {
  CustomerInfo,
  PurchasesEntitlementInfo,
  PurchasesOfferings,
  PurchasesPackage,
  PurchasesSubscriptionInfo,
} from 'react-native-purchases';
import {
  findSubscriptionPackage,
  isRestoreVisible,
  resolveSubscriptionCenterModel,
  resolveSubscriptionCenterViewState,
  type SubscriptionCenterStatus,
} from '../subscriptionCenter';

const NOW = new Date('2026-08-13T12:00:00.000Z');
const START = '2026-07-13T12:00:00.000Z';
const END = '2026-09-13T12:00:00.000Z';

function entitlement(
  overrides: Partial<PurchasesEntitlementInfo> = {},
): PurchasesEntitlementInfo {
  return {
    identifier: 'premium',
    isActive: true,
    willRenew: true,
    periodType: 'NORMAL',
    latestPurchaseDate: START,
    latestPurchaseDateMillis: Date.parse(START),
    originalPurchaseDate: START,
    originalPurchaseDateMillis: Date.parse(START),
    expirationDate: END,
    expirationDateMillis: Date.parse(END),
    store: 'APP_STORE',
    productIdentifier: 'ajfit_premium_monthly',
    productPlanIdentifier: null,
    isSandbox: false,
    unsubscribeDetectedAt: null,
    unsubscribeDetectedAtMillis: null,
    billingIssueDetectedAt: null,
    billingIssueDetectedAtMillis: null,
    ownershipType: 'PURCHASED',
    verification: 'NOT_REQUESTED',
    ...overrides,
  } as PurchasesEntitlementInfo;
}

function subscription(
  productIdentifier: string,
  overrides: Partial<PurchasesSubscriptionInfo> = {},
): PurchasesSubscriptionInfo {
  return {
    productIdentifier,
    purchaseDate: START,
    originalPurchaseDate: START,
    expiresDate: END,
    store: 'APP_STORE',
    unsubscribeDetectedAt: null,
    isSandbox: false,
    billingIssuesDetectedAt: null,
    gracePeriodExpiresDate: null,
    ownershipType: 'PURCHASED',
    periodType: 'NORMAL',
    refundedAt: null,
    storeTransactionId: 'transaction',
    isActive: true,
    willRenew: true,
    autoResumeDate: null,
    displayName: null,
    managementURL: 'https://apps.apple.com/account/subscriptions',
    productPlanIdentifier: null,
    ...overrides,
  } as PurchasesSubscriptionInfo;
}

function customerInfo({
  premium = entitlement(),
  active = true,
  subscriptionInfo = subscription(premium.productIdentifier),
}: {
  premium?: PurchasesEntitlementInfo;
  active?: boolean;
  subscriptionInfo?: PurchasesSubscriptionInfo | null;
} = {}): CustomerInfo {
  return {
    entitlements: {
      active: active ? { premium } : {},
      all: { premium },
      verification: 'NOT_REQUESTED',
    },
    activeSubscriptions: active ? [premium.productIdentifier] : [],
    allPurchasedProductIdentifiers: [premium.productIdentifier],
    subscriptionsByProductIdentifier: subscriptionInfo
      ? { [premium.productIdentifier]: subscriptionInfo }
      : {},
    managementURL: subscriptionInfo?.managementURL ?? null,
    latestExpirationDate: premium.expirationDate,
    firstSeen: START,
    originalAppUserId: 'uid',
    requestDate: NOW.toISOString(),
    allExpirationDates: { [premium.productIdentifier]: premium.expirationDate },
    allPurchaseDates: { [premium.productIdentifier]: premium.originalPurchaseDate },
    originalApplicationVersion: null,
    originalPurchaseDate: START,
    nonSubscriptionTransactions: [],
  } as CustomerInfo;
}

function pkg(
  identifier: string,
  packageType: 'MONTHLY' | 'ANNUAL',
  priceString: string,
  offeringIdentifier = 'default',
): PurchasesPackage {
  return {
    identifier: packageType === 'MONTHLY' ? '$rc_monthly' : '$rc_annual',
    packageType,
    offeringIdentifier,
    presentedOfferingContext: { offeringIdentifier, placementIdentifier: null, targetingContext: null },
    webCheckoutUrl: null,
    product: {
      identifier,
      title: packageType === 'MONTHLY' ? 'AJ Fit Monthly' : 'AJ Fit Annual',
      priceString,
      subscriptionPeriod: packageType === 'MONTHLY' ? 'P1M' : 'P1Y',
      subscriptionOptions: null,
    },
  } as PurchasesPackage;
}

function offerings(packages: PurchasesPackage[], extras: PurchasesPackage[] = []): PurchasesOfferings {
  const current = {
    identifier: 'default',
    serverDescription: '',
    metadata: {},
    availablePackages: packages,
    monthly: packages.find((item) => item.packageType === 'MONTHLY') ?? null,
    annual: packages.find((item) => item.packageType === 'ANNUAL') ?? null,
  };
  const promo = {
    ...current,
    identifier: 'promo_7d',
    availablePackages: extras,
    monthly: extras.find((item) => item.packageType === 'MONTHLY') ?? null,
    annual: extras.find((item) => item.packageType === 'ANNUAL') ?? null,
  };
  return {
    current,
    all: extras.length ? { default: current, promo_7d: promo } : { default: current },
  } as unknown as PurchasesOfferings;
}

describe('resolveSubscriptionCenterModel', () => {
  it('describes an active monthly plan with localized Store price and renewal', () => {
    const monthly = pkg('ajfit_premium_monthly', 'MONTHLY', 'R$ 29,90');
    const model = resolveSubscriptionCenterModel({
      customerInfo: customerInfo(),
      offerings: offerings([monthly]),
      now: NOW,
    });

    expect(model).toMatchObject({
      status: 'active',
      hasPremiumAccess: true,
      planKind: 'monthly',
      localizedPrice: 'R$ 29,90',
      store: 'APP_STORE',
      willRenew: true,
    });
    expect(model.currentPeriodEndsAt?.toISOString()).toBe(END);
  });

  it('describes an active annual plan without inferring it from the product id', () => {
    const annualEntitlement = entitlement({ productIdentifier: 'opaque-product' });
    const annual = pkg('opaque-product', 'ANNUAL', 'US$ 79.99');
    const model = resolveSubscriptionCenterModel({
      customerInfo: customerInfo({
        premium: annualEntitlement,
        subscriptionInfo: subscription('opaque-product'),
      }),
      offerings: offerings([annual]),
      now: NOW,
    });

    expect(model.planKind).toBe('annual');
    expect(model.localizedPrice).toBe('US$ 79.99');
  });

  it('recognizes a real free trial only from RevenueCat periodType', () => {
    const trialEntitlement = entitlement({ periodType: 'TRIAL' });
    const model = resolveSubscriptionCenterModel({
      customerInfo: customerInfo({
        premium: trialEntitlement,
        subscriptionInfo: subscription(trialEntitlement.productIdentifier, {
          periodType: 'TRIAL',
        }),
      }),
      offerings: null,
      now: NOW,
    });

    expect(model.status).toBe('trial');
    expect(model.trialEndsAt?.toISOString()).toBe(END);
  });

  it('prioritizes scheduled cancellation over trial and keeps Premium until expiry', () => {
    const canceledAt = '2026-08-10T12:00:00.000Z';
    const canceled = entitlement({
      periodType: 'TRIAL',
      willRenew: false,
      unsubscribeDetectedAt: canceledAt,
    });
    const model = resolveSubscriptionCenterModel({
      customerInfo: customerInfo({
        premium: canceled,
        subscriptionInfo: subscription(canceled.productIdentifier, {
          periodType: 'TRIAL',
          willRenew: false,
          unsubscribeDetectedAt: canceledAt,
        }),
      }),
      offerings: null,
      now: NOW,
    });

    expect(model.status).toBe('canceled');
    expect(model.hasPremiumAccess).toBe(true);
    expect(model.currentPeriodEndsAt?.toISOString()).toBe(END);
  });

  it('shows a billing issue without revoking an active entitlement', () => {
    const issueAt = '2026-08-12T12:00:00.000Z';
    const issue = entitlement({ billingIssueDetectedAt: issueAt });
    const model = resolveSubscriptionCenterModel({
      customerInfo: customerInfo({
        premium: issue,
        subscriptionInfo: subscription(issue.productIdentifier, {
          billingIssuesDetectedAt: issueAt,
        }),
      }),
      offerings: null,
      now: NOW,
    });

    expect(model.status).toBe('billing_issue');
    expect(model.hasPremiumAccess).toBe(true);
  });

  it('distinguishes a current grace period when RevenueCat provides its end date', () => {
    const issueAt = '2026-08-12T12:00:00.000Z';
    const issue = entitlement({ billingIssueDetectedAt: issueAt });
    const model = resolveSubscriptionCenterModel({
      customerInfo: customerInfo({
        premium: issue,
        subscriptionInfo: subscription(issue.productIdentifier, {
          billingIssuesDetectedAt: issueAt,
          gracePeriodExpiresDate: '2026-08-20T12:00:00.000Z',
        }),
      }),
      offerings: null,
      now: NOW,
    });

    expect(model.status).toBe('grace_period');
    expect(model.gracePeriodEndsAt?.toISOString()).toBe('2026-08-20T12:00:00.000Z');
    expect(model.hasPremiumAccess).toBe(true);
  });

  it('represents an expired historical entitlement but never grants access', () => {
    const expired = entitlement({
      isActive: false,
      willRenew: false,
      expirationDate: '2026-08-01T12:00:00.000Z',
    });
    const model = resolveSubscriptionCenterModel({
      customerInfo: customerInfo({
        premium: expired,
        active: false,
        subscriptionInfo: subscription(expired.productIdentifier, {
          isActive: false,
          willRenew: false,
          expiresDate: expired.expirationDate,
        }),
      }),
      offerings: null,
      now: NOW,
    });

    expect(model.status).toBe('expired');
    expect(model.hasPremiumAccess).toBe(false);
  });

  it('tolerates missing optional catalog and subscription details', () => {
    const model = resolveSubscriptionCenterModel({
      customerInfo: customerInfo({ subscriptionInfo: null }),
      offerings: null,
      now: NOW,
    });

    expect(model.status).toBe('active');
    expect(model.planKind).toBe('unknown');
    expect(model.localizedPrice).toBeNull();
    expect(model.managementURL).toBeNull();
  });

  it('finds the exact promotional SKU across all Offerings without exposing a coupon claim', () => {
    const standard = pkg('ajfit_premium_monthly', 'MONTHLY', 'R$ 29,90');
    const promo = pkg(
      'ajfit_premium_monthly_promo',
      'MONTHLY',
      'R$ 19,90',
      'promo_7d',
    );
    const promoEntitlement = entitlement({ productIdentifier: promo.product.identifier });
    const catalog = offerings([standard], [promo]);
    const model = resolveSubscriptionCenterModel({
      customerInfo: customerInfo({
        premium: promoEntitlement,
        subscriptionInfo: subscription(promo.product.identifier),
      }),
      offerings: catalog,
      now: NOW,
    });

    expect(findSubscriptionPackage(catalog, promo.product.identifier, null)).toBe(promo);
    expect(model.productPackage).toBe(promo);
    expect(model.localizedPrice).toBe('R$ 19,90');
    expect(model).not.toHaveProperty('couponCode');
    expect(model).not.toHaveProperty('promotion');
  });

  it('never lets a stale webhook status override current CustomerInfo access or lifecycle', () => {
    const model = resolveSubscriptionCenterModel({
      customerInfo: customerInfo(),
      offerings: null,
      mirror: {
        status: 'CANCELED',
        entitlementActive: false,
        canceledAt: { toDate: () => new Date('2026-08-01T12:00:00.000Z') },
        startedAt: { toDate: () => new Date('2026-01-01T12:00:00.000Z') },
      },
      now: NOW,
    });

    expect(model.status).toBe('active');
    expect(model.hasPremiumAccess).toBe(true);
    expect(model.canceledAt).toBeNull();
  });

  it('reflects CustomerInfo changes on the next derivation without a remount cache', () => {
    const active = resolveSubscriptionCenterModel({
      customerInfo: customerInfo(),
      offerings: null,
      now: NOW,
    });
    const canceledPremium = entitlement({
      willRenew: false,
      unsubscribeDetectedAt: NOW.toISOString(),
    });
    const canceled = resolveSubscriptionCenterModel({
      customerInfo: customerInfo({
        premium: canceledPremium,
        subscriptionInfo: subscription(canceledPremium.productIdentifier, {
          willRenew: false,
          unsubscribeDetectedAt: NOW.toISOString(),
        }),
      }),
      offerings: null,
      now: NOW,
    });

    expect(active.status).toBe('active');
    expect(canceled.status).toBe('canceled');
  });

  it('flags an administrative grant only from the active entitlement store, never from Firestore', () => {
    const granted = entitlement({ store: 'PROMOTIONAL', productIdentifier: 'rc_promo_premium_lifetime' });
    const model = resolveSubscriptionCenterModel({
      customerInfo: customerInfo({ premium: granted, subscriptionInfo: null }),
      offerings: null,
      now: NOW,
    });

    expect(model.isAdministrativeGrant).toBe(true);
    expect(model.hasPremiumAccess).toBe(true);
    expect(model.status).toBe('active');
    // No store package exists for a promotional product id — the model
    // must not invent a price/plan for it.
    expect(model.localizedPrice).toBeNull();
    expect(model.productPackage).toBeNull();
  });

  it('does not flag a real paid subscription as an administrative grant', () => {
    const model = resolveSubscriptionCenterModel({
      customerInfo: customerInfo(),
      offerings: null,
      now: NOW,
    });
    expect(model.isAdministrativeGrant).toBe(false);
  });

  it('does not flag a real free trial as an administrative grant', () => {
    const trialEntitlement = entitlement({ periodType: 'TRIAL' });
    const model = resolveSubscriptionCenterModel({
      customerInfo: customerInfo({
        premium: trialEntitlement,
        subscriptionInfo: subscription(trialEntitlement.productIdentifier, { periodType: 'TRIAL' }),
      }),
      offerings: null,
      now: NOW,
    });
    expect(model.isAdministrativeGrant).toBe(false);
    expect(model.status).toBe('trial');
  });

  it('does not flag a historical (no longer active) promotional entitlement', () => {
    const expiredGrant = entitlement({
      store: 'PROMOTIONAL',
      isActive: false,
      expirationDate: '2026-08-01T12:00:00.000Z',
    });
    const model = resolveSubscriptionCenterModel({
      customerInfo: customerInfo({ premium: expiredGrant, active: false, subscriptionInfo: null }),
      offerings: null,
      now: NOW,
    });
    expect(model.isAdministrativeGrant).toBe(false);
    expect(model.hasPremiumAccess).toBe(false);
  });
});

describe('isRestoreVisible', () => {
  it('hides restore for every status where RevenueCat already recognizes the entitlement', () => {
    const recognized: SubscriptionCenterStatus[] = [
      'active',
      'trial',
      'canceled',
      'billing_issue',
      'grace_period',
    ];
    for (const status of recognized) {
      expect(isRestoreVisible(status)).toBe(false);
    }
  });

  it('shows restore only where no entitlement is currently recognized', () => {
    expect(isRestoreVisible('expired')).toBe(true);
    expect(isRestoreVisible('unknown')).toBe(true);
  });
});

describe('unknown status only resolves once CustomerInfo has actually loaded', () => {
  it('never derives "unknown" while the screen is still in the loading view state', () => {
    // Loading always resolves to the 'loading' view state before any
    // CustomerInfo (and therefore any 'unknown' status) exists — 'unknown'
    // is not a loading artifact, it means "we checked and found nothing",
    // which is why isRestoreVisible offers restore for it.
    expect(
      resolveSubscriptionCenterViewState({ loading: true, customerInfo: null, error: null }),
    ).toBe('loading');

    const model = resolveSubscriptionCenterModel({ customerInfo: null, offerings: null });
    expect(model.status).toBe('unknown');
  });
});

describe('resolveSubscriptionCenterViewState', () => {
  it('covers loading, terminal error, and confirmed CustomerInfo', () => {
    expect(resolveSubscriptionCenterViewState({ loading: true, customerInfo: null, error: null }))
      .toBe('loading');
    expect(resolveSubscriptionCenterViewState({ loading: false, customerInfo: null, error: 'x' }))
      .toBe('error');
    expect(resolveSubscriptionCenterViewState({
      loading: false,
      customerInfo: customerInfo(),
      error: 'refresh failed',
    })).toBe('ready');
  });
});
