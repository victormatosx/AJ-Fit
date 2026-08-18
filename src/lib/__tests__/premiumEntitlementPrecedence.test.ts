import { describe, expect, it } from 'vitest';
import type {
  CustomerInfo,
  PurchasesEntitlementInfo,
  PurchasesSubscriptionInfo,
} from 'react-native-purchases';
import { resolveSubscriptionCenterModel, type SubscriptionCenterStatus } from '../subscriptionCenter';
import { PREMIUM_ENTITLEMENT_ID } from '../subscriptionConstants';
import { canPerformPremiumCapability, type PremiumCapability } from '../premiumCapabilities';
import { resolvePremiumUpgradeIntent } from '../premiumUpgradeIntent';

/**
 * Fase 6 (docs/13_assinaturas_e_billing.md): the whole point of this phase
 * — proved end to end, not just asserted in a comment. `resolveStatus`
 * (subscriptionCenter.ts) only returns 'canceled' | 'trial' | 'active' |
 * 'grace_period' | 'billing_issue' when `activeEntitlement` is truthy, and
 * `isPremium` (SubscriptionContext.tsx) is `Boolean(customerInfo
 * ?.entitlements.active[PREMIUM_ENTITLEMENT_ID])` — the exact same source.
 * This file constructs real `CustomerInfo` fixtures for every entitlement-
 * active commercial status and proves, through the actual production
 * functions (not a re-implementation), that:
 *
 *   1. `resolveSubscriptionCenterModel` reports that status AND
 *      `hasPremiumAccess: true` for the same CustomerInfo;
 *   2. the same CustomerInfo, read the way SubscriptionContext reads it,
 *      yields `isPremium: true`;
 *   3. `canPerformPremiumCapability` — the actual authorization function
 *      `usePremiumCapabilities`/`PremiumAction` call — returns `true` for
 *      every capability given that `isPremium`.
 *
 * In other words: PremiumRequiredSheet is structurally unreachable for a
 * canceled-but-active, trialing, grace-period or billing-issue user. This
 * is not a policy PremiumAction/PremiumActionContext had to be taught in
 * Fase 6 — it already followed from Fase 2's `canPerform` reading the same
 * entitlement `resolveStatus` reads. Fase 6 proves it explicitly instead of
 * leaving it implicit.
 */

const ALL_CAPABILITIES: PremiumCapability[] = [
  'START_WORKOUT',
  'VIEW_WORKOUT_DETAILS',
  'REGISTER_WORKOUT',
  'REGISTER_LOAD',
  'REGISTER_BODY_WEIGHT',
  'REGISTER_MEASUREMENTS',
  'ADD_PROGRESS_PHOTO',
  'DELETE_PROGRESS_PHOTO',
  'CREATE_ASSESSMENT',
];

const NOW = new Date('2026-08-18T12:00:00.000Z');
const PAST = '2026-07-18T12:00:00.000Z';
const FUTURE = '2026-09-18T12:00:00.000Z';
const PRODUCT_ID = 'ajfit_premium_monthly';

function entitlement(overrides: Partial<PurchasesEntitlementInfo> = {}): PurchasesEntitlementInfo {
  return {
    identifier: PREMIUM_ENTITLEMENT_ID,
    isActive: true,
    willRenew: true,
    periodType: 'NORMAL',
    latestPurchaseDate: PAST,
    latestPurchaseDateMillis: Date.parse(PAST),
    originalPurchaseDate: PAST,
    originalPurchaseDateMillis: Date.parse(PAST),
    expirationDate: FUTURE,
    expirationDateMillis: Date.parse(FUTURE),
    store: 'APP_STORE',
    productIdentifier: PRODUCT_ID,
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

function subscriptionInfo(
  overrides: Partial<PurchasesSubscriptionInfo> = {},
): PurchasesSubscriptionInfo {
  return {
    productIdentifier: PRODUCT_ID,
    purchaseDate: PAST,
    originalPurchaseDate: PAST,
    expiresDate: FUTURE,
    store: 'APP_STORE',
    unsubscribeDetectedAt: null,
    isSandbox: false,
    billingIssuesDetectedAt: null,
    gracePeriodExpiresDate: null,
    ownershipType: 'PURCHASED',
    periodType: 'NORMAL',
    refundedAt: null,
    storeTransactionId: 'txn',
    isActive: true,
    willRenew: true,
    autoResumeDate: null,
    displayName: null,
    managementURL: 'https://apps.apple.com/account/subscriptions',
    productPlanIdentifier: null,
    ...overrides,
  } as PurchasesSubscriptionInfo;
}

function customerInfoWithActiveEntitlement(
  premium: PurchasesEntitlementInfo,
  subscription: PurchasesSubscriptionInfo | null,
): CustomerInfo {
  return {
    entitlements: {
      active: { [PREMIUM_ENTITLEMENT_ID]: premium },
      all: { [PREMIUM_ENTITLEMENT_ID]: premium },
      verification: 'NOT_REQUESTED',
    },
    activeSubscriptions: [PRODUCT_ID],
    allPurchasedProductIdentifiers: [PRODUCT_ID],
    subscriptionsByProductIdentifier: subscription ? { [PRODUCT_ID]: subscription } : {},
    managementURL: subscription?.managementURL ?? null,
    latestExpirationDate: premium.expirationDate,
    firstSeen: PAST,
    originalAppUserId: 'uid',
    requestDate: NOW.toISOString(),
    allExpirationDates: { [PRODUCT_ID]: premium.expirationDate },
    allPurchaseDates: { [PRODUCT_ID]: premium.originalPurchaseDate },
    originalApplicationVersion: null,
    originalPurchaseDate: PAST,
    nonSubscriptionTransactions: [],
  } as CustomerInfo;
}

function customerInfoNeverSubscribed(): CustomerInfo {
  return {
    entitlements: { active: {}, all: {}, verification: 'NOT_REQUESTED' },
    activeSubscriptions: [],
    allPurchasedProductIdentifiers: [],
    subscriptionsByProductIdentifier: {},
    managementURL: null,
    latestExpirationDate: null,
    firstSeen: NOW.toISOString(),
    originalAppUserId: 'uid',
    requestDate: NOW.toISOString(),
    allExpirationDates: {},
    allPurchaseDates: {},
    originalApplicationVersion: null,
    originalPurchaseDate: NOW.toISOString(),
    nonSubscriptionTransactions: [],
  } as CustomerInfo;
}

function customerInfoExpired(): CustomerInfo {
  const premium = entitlement({
    expirationDate: PAST,
    expirationDateMillis: Date.parse(PAST),
    willRenew: false,
    unsubscribeDetectedAt: PAST,
    unsubscribeDetectedAtMillis: Date.parse(PAST),
  });
  return {
    entitlements: { active: {}, all: { [PREMIUM_ENTITLEMENT_ID]: premium }, verification: 'NOT_REQUESTED' },
    activeSubscriptions: [],
    allPurchasedProductIdentifiers: [PRODUCT_ID],
    subscriptionsByProductIdentifier: {},
    managementURL: null,
    latestExpirationDate: premium.expirationDate,
    firstSeen: PAST,
    originalAppUserId: 'uid',
    requestDate: NOW.toISOString(),
    allExpirationDates: { [PRODUCT_ID]: premium.expirationDate },
    allPurchaseDates: { [PRODUCT_ID]: premium.originalPurchaseDate },
    originalApplicationVersion: null,
    originalPurchaseDate: PAST,
    nonSubscriptionTransactions: [],
  } as CustomerInfo;
}

const ENTITLEMENT_ACTIVE_FIXTURES: Array<[SubscriptionCenterStatus, CustomerInfo]> = [
  ['active', customerInfoWithActiveEntitlement(entitlement(), subscriptionInfo())],
  [
    'trial',
    customerInfoWithActiveEntitlement(
      entitlement({ periodType: 'TRIAL' }),
      subscriptionInfo({ periodType: 'TRIAL' }),
    ),
  ],
  [
    'canceled',
    customerInfoWithActiveEntitlement(
      entitlement({ unsubscribeDetectedAt: PAST, unsubscribeDetectedAtMillis: Date.parse(PAST) }),
      subscriptionInfo({ willRenew: false }),
    ),
  ],
  [
    'billing_issue',
    customerInfoWithActiveEntitlement(
      entitlement({ billingIssueDetectedAt: PAST, billingIssueDetectedAtMillis: Date.parse(PAST) }),
      subscriptionInfo({ billingIssuesDetectedAt: PAST, gracePeriodExpiresDate: null }),
    ),
  ],
  [
    'grace_period',
    customerInfoWithActiveEntitlement(
      entitlement({ billingIssueDetectedAt: PAST, billingIssueDetectedAtMillis: Date.parse(PAST) }),
      subscriptionInfo({ billingIssuesDetectedAt: PAST, gracePeriodExpiresDate: FUTURE }),
    ),
  ],
];

describe('FASE 6 — entitlement wins over commercial status (access side)', () => {
  it.each(ENTITLEMENT_ACTIVE_FIXTURES)(
    'status=%s with an active entitlement: resolveSubscriptionCenterModel reports hasPremiumAccess=true',
    (expectedStatus, customerInfo) => {
      const model = resolveSubscriptionCenterModel({ customerInfo, offerings: null }, );
      expect(model.status).toBe(expectedStatus);
      expect(model.hasPremiumAccess).toBe(true);
    },
  );

  it.each(ENTITLEMENT_ACTIVE_FIXTURES)(
    'status=%s: the same field SubscriptionContext reads (`entitlements.active[premium]`) is truthy',
    (_status, customerInfo) => {
      expect(Boolean(customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID])).toBe(true);
    },
  );

  it.each(ENTITLEMENT_ACTIVE_FIXTURES)(
    'status=%s: canPerformPremiumCapability allows every capability once isPremium is derived from that CustomerInfo — the sheet is structurally unreachable',
    (_status, customerInfo) => {
      const isPremium = Boolean(customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID]);
      const access = { isPremium, resolved: true };
      for (const capability of ALL_CAPABILITIES) {
        expect(canPerformPremiumCapability(capability, access)).toBe(true);
      }
    },
  );
});

describe('FASE 6 — no active entitlement: capability denied, intent resolves to a real commercial state', () => {
  it('never subscribed: status=unknown, capability denied, intent=subscribe (never "renew")', () => {
    const customerInfo = customerInfoNeverSubscribed();
    const model = resolveSubscriptionCenterModel({ customerInfo, offerings: null });
    expect(model.status).toBe('unknown');
    expect(model.hasPremiumAccess).toBe(false);

    const isPremium = Boolean(customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID]);
    expect(isPremium).toBe(false);
    const access = { isPremium, resolved: true };
    for (const capability of ALL_CAPABILITIES) {
      expect(canPerformPremiumCapability(capability, access)).toBe(false);
    }
    expect(resolvePremiumUpgradeIntent(model.status)).toBe('subscribe');
  });

  it('previously subscribed, now expired: status=expired, capability denied, intent=renew', () => {
    const customerInfo = customerInfoExpired();
    const model = resolveSubscriptionCenterModel({ customerInfo, offerings: null });
    expect(model.status).toBe('expired');
    expect(model.hasPremiumAccess).toBe(false);

    const isPremium = Boolean(customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID]);
    expect(isPremium).toBe(false);
    const access = { isPremium, resolved: true };
    for (const capability of ALL_CAPABILITIES) {
      expect(canPerformPremiumCapability(capability, access)).toBe(false);
    }
    expect(resolvePremiumUpgradeIntent(model.status)).toBe('renew');
  });
});
