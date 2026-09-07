import { Platform } from 'react-native';
import type { CustomerInfo, PeriodType, PurchasesEntitlementInfo } from 'react-native-purchases';
import { PREMIUM_ENTITLEMENT_ID } from '../lib/subscriptionConstants';

/**
 * Development-only Subscription Override.
 *
 * Lets development/QA builds simulate every subscription state the app can
 * be in — without a real Google Play / App Store purchase, without touching
 * RevenueCat, Firestore, or any backend. This is a pure client-side
 * transform applied ONLY on top of the state RevenueCat already produced:
 *
 *   RevenueCat -> Real Subscription State -> Dev Override -> Effective State -> App
 *
 * `isDevSubscriptionOverrideAllowed()` is the single hard gate every
 * function in this file (and in `subscriptionOverrideStorage.ts`) checks
 * first. It requires BOTH `__DEV__` (a debug JS bundle — baked in at Metro
 * bundle time, not a runtime-editable value, and dead-code-eliminated by the
 * minifier in any release/production build) AND an explicit build-time opt
 * in flag. Neither is trusted alone: an `EXPO_PUBLIC_*` var can be
 * mis-set for a preview/production build, so it is never sufficient by
 * itself — `__DEV__` is what actually keeps this inert in a shipped build.
 */
export const DEV_SUBSCRIPTION_OVERRIDE_STATES = [
  'REAL',
  'FREE',
  'PREMIUM_MONTHLY',
  'PREMIUM_ANNUAL',
  'TRIAL',
  'CANCELED_ACTIVE',
  'EXPIRED',
] as const;

export type DevSubscriptionOverrideState = (typeof DEV_SUBSCRIPTION_OVERRIDE_STATES)[number];

/**
 * In-memory ownership for a single app execution. The UID is part of the
 * state so a render with a different Firebase identity can resolve to REAL
 * immediately, before the cleanup effect commits the new session owner.
 */
export type DevSubscriptionOverrideSession = {
  uid: string | null;
  override: DevSubscriptionOverrideState;
};

export function createDevSubscriptionOverrideSession(
  uid: string | null,
): DevSubscriptionOverrideSession {
  return { uid, override: 'REAL' };
}

export function resolveDevSubscriptionOverrideForIdentity(
  session: DevSubscriptionOverrideSession,
  uid: string | null,
  allowed: boolean,
): DevSubscriptionOverrideState {
  return allowed && session.uid === uid ? session.override : 'REAL';
}

export function isDevSubscriptionOverrideState(
  value: unknown,
): value is DevSubscriptionOverrideState {
  return (
    typeof value === 'string' &&
    (DEV_SUBSCRIPTION_OVERRIDE_STATES as readonly string[]).includes(value)
  );
}

export function isDevSubscriptionOverrideAllowed(): boolean {
  return __DEV__ && process.env.EXPO_PUBLIC_ENABLE_DEV_SUBSCRIPTION_OVERRIDES === '1';
}

type SimulatedOverride = Exclude<DevSubscriptionOverrideState, 'REAL' | 'FREE'>;

// Stable, obviously-fake identifiers — can never collide with a real store product id.
const OVERRIDE_PRODUCT_IDS: Record<SimulatedOverride, string> = {
  PREMIUM_MONTHLY: 'dev_override_premium_monthly',
  PREMIUM_ANNUAL: 'dev_override_premium_annual',
  TRIAL: 'dev_override_premium_trial',
  CANCELED_ACTIVE: 'dev_override_premium_canceled',
  EXPIRED: 'dev_override_premium_expired',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function buildEntitlement({
  productIdentifier,
  isActive,
  willRenew,
  periodType,
  purchasedAtMs,
  expirationMs,
  unsubscribedAtMs,
}: {
  productIdentifier: string;
  isActive: boolean;
  willRenew: boolean;
  periodType: PeriodType;
  purchasedAtMs: number;
  expirationMs: number;
  unsubscribedAtMs?: number | null;
}): PurchasesEntitlementInfo {
  return {
    identifier: PREMIUM_ENTITLEMENT_ID,
    isActive,
    willRenew,
    periodType,
    latestPurchaseDate: iso(purchasedAtMs),
    latestPurchaseDateMillis: purchasedAtMs,
    originalPurchaseDate: iso(purchasedAtMs),
    originalPurchaseDateMillis: purchasedAtMs,
    expirationDate: iso(expirationMs),
    expirationDateMillis: expirationMs,
    store: Platform.OS === 'ios' ? 'APP_STORE' : 'PLAY_STORE',
    productIdentifier,
    productPlanIdentifier: null,
    isSandbox: true,
    unsubscribeDetectedAt: unsubscribedAtMs != null ? iso(unsubscribedAtMs) : null,
    unsubscribeDetectedAtMillis: unsubscribedAtMs ?? null,
    billingIssueDetectedAt: null,
    billingIssueDetectedAtMillis: null,
    ownershipType: 'PURCHASED',
    // Double-cast: VERIFICATION_RESULT is a string enum whose runtime value
    // isn't re-exported from the `react-native-purchases` package entry
    // point (only its type is) — the literal is the exact value the SDK
    // itself would use for `NOT_REQUESTED`.
    verification: 'NOT_REQUESTED' as unknown as PurchasesEntitlementInfo['verification'],
  };
}

/**
 * Deterministic, QA-useful dates for each simulated state — future
 * expirations for still-active states, a past one for `EXPIRED`, matching
 * the same relationship real RevenueCat data would have.
 */
function buildOverrideEntitlement(
  override: SimulatedOverride,
  nowMs: number,
): PurchasesEntitlementInfo {
  const productIdentifier = OVERRIDE_PRODUCT_IDS[override];
  switch (override) {
    case 'PREMIUM_MONTHLY':
      return buildEntitlement({
        productIdentifier,
        isActive: true,
        willRenew: true,
        periodType: 'NORMAL',
        purchasedAtMs: nowMs - 5 * DAY_MS,
        expirationMs: nowMs + 25 * DAY_MS,
      });
    case 'PREMIUM_ANNUAL':
      return buildEntitlement({
        productIdentifier,
        isActive: true,
        willRenew: true,
        periodType: 'NORMAL',
        purchasedAtMs: nowMs - 5 * DAY_MS,
        expirationMs: nowMs + 360 * DAY_MS,
      });
    case 'TRIAL':
      return buildEntitlement({
        productIdentifier,
        isActive: true,
        willRenew: true,
        periodType: 'TRIAL',
        purchasedAtMs: nowMs,
        expirationMs: nowMs + 3 * DAY_MS,
      });
    case 'CANCELED_ACTIVE':
      return buildEntitlement({
        productIdentifier,
        isActive: true,
        willRenew: false,
        periodType: 'NORMAL',
        purchasedAtMs: nowMs - 20 * DAY_MS,
        expirationMs: nowMs + 10 * DAY_MS,
        unsubscribedAtMs: nowMs - 1 * DAY_MS,
      });
    case 'EXPIRED':
      return buildEntitlement({
        productIdentifier,
        isActive: false,
        willRenew: false,
        periodType: 'NORMAL',
        purchasedAtMs: nowMs - 40 * DAY_MS,
        expirationMs: nowMs - 1 * DAY_MS,
        unsubscribedAtMs: nowMs - 10 * DAY_MS,
      });
  }
}

/**
 * Pure transform: RevenueCat's real `CustomerInfo` -> the "effective"
 * `CustomerInfo` the rest of the app consumes. Returns `realCustomerInfo`
 * completely unchanged (same reference) whenever the override is not
 * allowed, is `'REAL'`, or the real state hasn't resolved yet — this
 * function can never manufacture Premium access on its own; it only ever
 * reshapes an already-resolved real snapshot.
 */
export function applyDevSubscriptionOverride(
  realCustomerInfo: CustomerInfo | null,
  override: DevSubscriptionOverrideState,
  now: Date = new Date(),
): CustomerInfo | null {
  if (!isDevSubscriptionOverrideAllowed() || override === 'REAL' || !realCustomerInfo) {
    return realCustomerInfo;
  }

  if (override === 'FREE') {
    return {
      ...realCustomerInfo,
      entitlements: { ...realCustomerInfo.entitlements, active: {}, all: {} },
      activeSubscriptions: [],
      allPurchasedProductIdentifiers: [],
      latestExpirationDate: null,
      allExpirationDates: {},
      allPurchaseDates: {},
      managementURL: null,
      subscriptionsByProductIdentifier: {},
    };
  }

  const nowMs = now.getTime();
  const entitlement = buildOverrideEntitlement(override, nowMs);
  const active: Record<string, PurchasesEntitlementInfo> = entitlement.isActive
    ? { [PREMIUM_ENTITLEMENT_ID]: entitlement }
    : {};

  return {
    ...realCustomerInfo,
    entitlements: {
      ...realCustomerInfo.entitlements,
      active,
      all: { [PREMIUM_ENTITLEMENT_ID]: entitlement },
    },
    activeSubscriptions: entitlement.isActive ? [entitlement.productIdentifier] : [],
    allPurchasedProductIdentifiers: [entitlement.productIdentifier],
    latestExpirationDate: entitlement.expirationDate,
    allExpirationDates: { [entitlement.productIdentifier]: entitlement.expirationDate },
    allPurchaseDates: { [entitlement.productIdentifier]: entitlement.latestPurchaseDate },
    managementURL: null,
    subscriptionsByProductIdentifier: {
      [entitlement.productIdentifier]: {
        productIdentifier: entitlement.productIdentifier,
        purchaseDate: entitlement.latestPurchaseDate,
        originalPurchaseDate: entitlement.originalPurchaseDate,
        expiresDate: entitlement.expirationDate,
        store: entitlement.store,
        unsubscribeDetectedAt: entitlement.unsubscribeDetectedAt,
        isSandbox: entitlement.isSandbox,
        billingIssuesDetectedAt: entitlement.billingIssueDetectedAt,
        gracePeriodExpiresDate: null,
        ownershipType: entitlement.ownershipType,
        periodType: entitlement.periodType as PeriodType,
        refundedAt: null,
        storeTransactionId: null,
        isActive: entitlement.isActive,
        willRenew: entitlement.willRenew,
        autoResumeDate: null,
        displayName: null,
        managementURL: null,
        productPlanIdentifier: null,
      },
    },
  };
}
