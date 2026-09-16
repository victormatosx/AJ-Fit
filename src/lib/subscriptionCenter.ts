import type {
  CustomerInfo,
  PurchasesEntitlementInfo,
  PurchasesOfferings,
  PurchasesPackage,
  PurchasesSubscriptionInfo,
  Store,
} from 'react-native-purchases';
import { PREMIUM_ENTITLEMENT_ID } from './subscriptionConstants';

export type SubscriptionCenterStatus =
  | 'active'
  | 'trial'
  | 'canceled'
  | 'billing_issue'
  | 'grace_period'
  | 'expired'
  | 'unknown';

export type SubscriptionPlanKind = 'monthly' | 'annual' | 'other' | 'unknown';

type DateLike = Date | string | number | { toDate(): Date } | null | undefined;

/**
 * Read-only subset of `users/{uid}.subscription` used to enrich the screen.
 * It never grants or revokes access; only CustomerInfo's active `premium`
 * entitlement is allowed to do that.
 */
export type SubscriptionMirrorSnapshot = {
  status?: 'TRIAL' | 'ACTIVE' | 'CANCELED' | 'BILLING_ISSUE' | 'EXPIRED';
  entitlementActive?: boolean;
  productId?: string;
  store?: 'APP_STORE' | 'PLAY_STORE';
  startedAt?: DateLike;
  trialEndsAt?: DateLike;
  currentPeriodEndsAt?: DateLike;
  canceledAt?: DateLike;
  lastRenewedAt?: DateLike;
};

export type SubscriptionCenterModel = {
  status: SubscriptionCenterStatus;
  hasPremiumAccess: boolean;
  /**
   * True only when the CURRENTLY ACTIVE `premium` entitlement's own `store`
   * field (as reported live by CustomerInfo — never Firestore) is
   * `'PROMOTIONAL'`, RevenueCat's own signal for an entitlement granted via
   * the promotional/grant API rather than a store purchase (verified
   * against `Store` in `@revenuecat/purchases-typescript-internal`, which
   * `react-native-purchases` re-exports — see subscriptionCenter's own
   * audit report). This is presentation-only: it never feeds
   * `hasPremiumAccess`, and it does not invent knowledge about a
   * SIMULTANEOUS paid subscription — `entitlements.active['premium']` is a
   * single merged entitlement per RevenueCat's own data model, so if a real
   * subscription is the one RevenueCat currently surfaces as active, `store`
   * reports that instead and this stays `false`, exactly reflecting what
   * CustomerInfo says right now.
   */
  isAdministrativeGrant: boolean;
  productIdentifier: string | null;
  productPackage: PurchasesPackage | null;
  planKind: SubscriptionPlanKind;
  planDisplayName: string | null;
  localizedPrice: string | null;
  store: Store | null;
  startedAt: Date | null;
  latestPurchaseAt: Date | null;
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  canceledAt: Date | null;
  billingIssueDetectedAt: Date | null;
  gracePeriodEndsAt: Date | null;
  willRenew: boolean | null;
  managementURL: string | null;
};

export type SubscriptionCenterViewState = 'loading' | 'error' | 'ready';

/**
 * Restore purchases only helps when RevenueCat hasn't linked an existing
 * purchase to this account — every other status already has a recognized
 * entitlement, so restoring can't change anything about it.
 *
 * - `expired` / `unknown`: no active entitlement is known here, so a prior
 *   purchase may exist that RevenueCat just hasn't reattached yet.
 * - Everything else (`active`, `trial`, `canceled`, `billing_issue`,
 *   `grace_period`): the entitlement is already recognized and active;
 *   showing restore there doesn't fix anything and only invites confusion.
 */
export function isRestoreVisible(status: SubscriptionCenterStatus): boolean {
  return status === 'expired' || status === 'unknown';
}

export function resolveSubscriptionCenterViewState({
  loading,
  customerInfo,
  error,
}: {
  loading: boolean;
  customerInfo: CustomerInfo | null;
  error: string | null;
}): SubscriptionCenterViewState {
  if (customerInfo) return 'ready';
  if (loading || !error) return 'loading';
  return 'error';
}

function toDate(value: DateLike): Date | null {
  if (value == null) return null;
  const date =
    value instanceof Date
      ? value
      : typeof value === 'object' && 'toDate' in value
        ? value.toDate()
        : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getSubscriptionInfo(
  customerInfo: CustomerInfo | null,
  productIdentifier: string | null,
): PurchasesSubscriptionInfo | null {
  if (!customerInfo || !productIdentifier) return null;
  return customerInfo.subscriptionsByProductIdentifier?.[productIdentifier] ?? null;
}

function allPackages(offerings: PurchasesOfferings | null): PurchasesPackage[] {
  if (!offerings) return [];
  return Object.values(offerings.all).flatMap((offering) => offering.availablePackages);
}

function optionMatchesProduct(pkg: PurchasesPackage, productIdentifier: string): boolean {
  const options = pkg.product.subscriptionOptions ?? [];
  return options.some(
    (option) =>
      option.storeProductId === productIdentifier || option.productId === productIdentifier,
  );
}

function optionMatchesPlan(pkg: PurchasesPackage, productPlanIdentifier: string): boolean {
  const options = pkg.product.subscriptionOptions ?? [];
  return options.some((option) => option.id.split(':')[0] === productPlanIdentifier);
}

/**
 * Resolves the live Store product without assuming product-id naming.
 * This searches every RevenueCat Offering so active promotional SKUs can be
 * described even when they are not part of the current acquisition Offering.
 */
export function findSubscriptionPackage(
  offerings: PurchasesOfferings | null,
  productIdentifier: string | null,
  productPlanIdentifier: string | null,
): PurchasesPackage | null {
  if (!productIdentifier) return null;

  const ranked = allPackages(offerings)
    .map((pkg, index) => {
      let score = 0;
      if (pkg.product.identifier === productIdentifier) score += 100;
      if (optionMatchesProduct(pkg, productIdentifier)) score += 80;
      if (productPlanIdentifier && optionMatchesPlan(pkg, productPlanIdentifier)) score += 30;
      if (offerings?.current?.identifier === pkg.offeringIdentifier) score += 1;
      return { pkg, score, index };
    })
    .filter(({ score }) => score >= 80)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return ranked[0]?.pkg ?? null;
}

function resolvePlanKind(pkg: PurchasesPackage | null): SubscriptionPlanKind {
  if (!pkg) return 'unknown';
  if (pkg.packageType === 'MONTHLY' || pkg.product.subscriptionPeriod === 'P1M') {
    return 'monthly';
  }
  if (pkg.packageType === 'ANNUAL' || pkg.product.subscriptionPeriod === 'P1Y') {
    return 'annual';
  }
  return 'other';
}

function reliableStore(
  entitlement: PurchasesEntitlementInfo | null,
  subscription: PurchasesSubscriptionInfo | null,
  mirror: SubscriptionMirrorSnapshot | null,
): Store | null {
  if (entitlement?.store && entitlement.store !== 'UNKNOWN_STORE') return entitlement.store;
  if (subscription?.store && subscription.store !== 'UNKNOWN_STORE') return subscription.store;
  return mirror?.store ?? null;
}

function resolveStatus({
  activeEntitlement,
  entitlement,
  subscription,
  mirror,
  now,
}: {
  activeEntitlement: PurchasesEntitlementInfo | null;
  entitlement: PurchasesEntitlementInfo | null;
  subscription: PurchasesSubscriptionInfo | null;
  mirror: SubscriptionMirrorSnapshot | null;
  now: Date;
}): SubscriptionCenterStatus {
  if (!activeEntitlement) {
    const hasSubscriptionHistory = Boolean(
      entitlement ||
        mirror?.status ||
        mirror?.productId ||
        toDate(mirror?.currentPeriodEndsAt),
    );
    return hasSubscriptionHistory ? 'expired' : 'unknown';
  }

  const billingIssueDetectedAt =
    toDate(entitlement?.billingIssueDetectedAt) ??
    toDate(subscription?.billingIssuesDetectedAt);
  const hasBillingIssue = Boolean(billingIssueDetectedAt);
  const gracePeriodEndsAt = toDate(subscription?.gracePeriodExpiresDate);
  if (hasBillingIssue && gracePeriodEndsAt && gracePeriodEndsAt.getTime() > now.getTime()) {
    return 'grace_period';
  }
  if (hasBillingIssue) return 'billing_issue';

  const store = reliableStore(entitlement, subscription, mirror);
  const periodType = (subscription?.periodType ?? entitlement?.periodType ?? '').toUpperCase();
  const expiration = toDate(entitlement?.expirationDate) ?? toDate(subscription?.expiresDate);
  const cancellationDetected = Boolean(
    toDate(entitlement?.unsubscribeDetectedAt) ??
      toDate(subscription?.unsubscribeDetectedAt),
  );
  const nonRenewingStoreSubscription = Boolean(
    expiration &&
      periodType !== 'PREPAID' &&
      (store === 'APP_STORE' || store === 'PLAY_STORE') &&
      (subscription ? !subscription.willRenew : !entitlement?.willRenew),
  );
  if (cancellationDetected || nonRenewingStoreSubscription) {
    return 'canceled';
  }
  if (periodType === 'TRIAL') return 'trial';
  return 'active';
}

export function resolveSubscriptionCenterModel({
  customerInfo,
  offerings,
  mirror = null,
  now = new Date(),
}: {
  customerInfo: CustomerInfo | null;
  offerings: PurchasesOfferings | null;
  mirror?: SubscriptionMirrorSnapshot | null;
  now?: Date;
}): SubscriptionCenterModel {
  const activeEntitlement =
    customerInfo?.entitlements.active[PREMIUM_ENTITLEMENT_ID] ?? null;
  const entitlement =
    activeEntitlement ?? customerInfo?.entitlements.all[PREMIUM_ENTITLEMENT_ID] ?? null;
  const productIdentifier = entitlement?.productIdentifier ?? mirror?.productId ?? null;
  const subscription = getSubscriptionInfo(customerInfo, productIdentifier);
  const productPackage = findSubscriptionPackage(
    offerings,
    productIdentifier,
    subscription?.productPlanIdentifier ?? entitlement?.productPlanIdentifier ?? null,
  );
  const periodType = (subscription?.periodType ?? entitlement?.periodType ?? '').toUpperCase();
  const currentPeriodEndsAt =
    toDate(entitlement?.expirationDate) ??
    toDate(subscription?.expiresDate) ??
    toDate(mirror?.currentPeriodEndsAt);
  const status = resolveStatus({
    activeEntitlement,
    entitlement,
    subscription,
    mirror,
    now,
  });

  return {
    status,
    hasPremiumAccess: Boolean(activeEntitlement),
    isAdministrativeGrant: activeEntitlement?.store === 'PROMOTIONAL',
    productIdentifier,
    productPackage,
    planKind: resolvePlanKind(productPackage),
    planDisplayName: subscription?.displayName ?? productPackage?.product.title ?? null,
    localizedPrice: productPackage?.product.priceString ?? null,
    store: reliableStore(entitlement, subscription, mirror),
    startedAt:
      toDate(entitlement?.originalPurchaseDate) ??
      toDate(subscription?.originalPurchaseDate) ??
      toDate(mirror?.startedAt),
    latestPurchaseAt:
      toDate(entitlement?.latestPurchaseDate) ??
      toDate(subscription?.purchaseDate) ??
      toDate(mirror?.lastRenewedAt),
    trialEndsAt:
      periodType === 'TRIAL'
        ? currentPeriodEndsAt
        : null,
    currentPeriodEndsAt,
    canceledAt:
      toDate(entitlement?.unsubscribeDetectedAt) ??
      toDate(subscription?.unsubscribeDetectedAt) ??
      (status === 'canceled' ? toDate(mirror?.canceledAt) : null),
    billingIssueDetectedAt:
      toDate(entitlement?.billingIssueDetectedAt) ??
      toDate(subscription?.billingIssuesDetectedAt),
    gracePeriodEndsAt: toDate(subscription?.gracePeriodExpiresDate),
    willRenew:
      typeof subscription?.willRenew === 'boolean'
        ? subscription.willRenew
        : typeof entitlement?.willRenew === 'boolean'
          ? entitlement.willRenew
          : null,
    managementURL: subscription?.managementURL ?? customerInfo?.managementURL ?? null,
  };
}
