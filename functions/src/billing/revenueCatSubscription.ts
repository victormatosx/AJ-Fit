import { Timestamp } from 'firebase-admin/firestore';
import {
  PREMIUM_ENTITLEMENT_ID,
  REVENUECAT_PROVIDER,
  type SubscriptionStatus,
  type SubscriptionStore,
} from './constants';
import type {
  RevenueCatSubscription,
  RevenueCatSubscriptionEntitlement,
} from './revenueCatApi';
import type { SubscriptionMirror } from './types';

export type RevenueCatPremiumReconciliation =
  | {
      status: 'active' | 'inactive';
      subscription: Partial<SubscriptionMirror>;
      selectedSubscriptionId: string | null;
    }
  | { status: 'ambiguous'; activeCandidateCount: number };

function premiumEntitlement(
  subscription: RevenueCatSubscription,
): RevenueCatSubscriptionEntitlement | undefined {
  return subscription.entitlements.find(
    (entitlement) => entitlement.lookupKey === PREMIUM_ENTITLEMENT_ID,
  );
}

function mapStore(store: string): SubscriptionStore | undefined {
  if (store === 'app_store') return 'APP_STORE';
  if (store === 'play_store') return 'PLAY_STORE';
  return undefined;
}

function mapStatus(subscription: RevenueCatSubscription): SubscriptionStatus | undefined {
  if (subscription.givesAccess && subscription.autoRenewalStatus === 'will_not_renew') {
    return 'CANCELED';
  }

  switch (subscription.status) {
    case 'trialing':
      return 'TRIAL';
    case 'active':
      return 'ACTIVE';
    case 'expired':
      return 'EXPIRED';
    case 'in_grace_period':
    case 'in_billing_retry':
      return 'BILLING_ISSUE';
    default:
      // RevenueCat explicitly permits additional future status values. Do
      // not invent a project status for paused/incomplete/unknown/new ones;
      // `gives_access` remains the authoritative current-access signal.
      return undefined;
  }
}

function storeProductIdentifier(
  subscription: RevenueCatSubscription,
  entitlement: RevenueCatSubscriptionEntitlement,
): string | undefined {
  if (subscription.productId === null) return undefined;
  const matches = [
    ...new Set(
      entitlement.products
        .filter((product) => product.id === subscription.productId)
        .map((product) => product.storeIdentifier),
    ),
  ];
  return matches.length === 1 ? matches[0] : undefined;
}

function normalizeCurrentSubscription(
  subscription: RevenueCatSubscription,
  entitlement: RevenueCatSubscriptionEntitlement,
): Partial<SubscriptionMirror> {
  const mirror: Partial<SubscriptionMirror> = {
    provider: REVENUECAT_PROVIDER,
    entitlementActive: subscription.givesAccess,
    startedAt: Timestamp.fromMillis(subscription.startsAtMs),
    currentPeriodEndsAt:
      subscription.currentPeriodEndsAtMs === null
        ? null
        : Timestamp.fromMillis(subscription.currentPeriodEndsAtMs),
  };

  const status = mapStatus(subscription);
  if (status) mirror.status = status;

  const store = mapStore(subscription.store);
  if (store) mirror.store = store;

  const productId = storeProductIdentifier(subscription, entitlement);
  if (productId) mirror.productId = productId;

  if (subscription.status === 'trialing' && subscription.currentPeriodEndsAtMs !== null) {
    mirror.trialEndsAt = Timestamp.fromMillis(subscription.currentPeriodEndsAtMs);
  }

  if (
    subscription.status !== 'trialing' &&
    subscription.currentPeriodStartsAtMs > subscription.startsAtMs
  ) {
    mirror.lastRenewedAt = Timestamp.fromMillis(subscription.currentPeriodStartsAtMs);
  }

  return mirror;
}

/**
 * Selects the AJ Fit Premium subscription from a complete V2 subscriptions
 * response. The entitlement relationship is authoritative; array order is
 * never used as a business rule.
 *
 * More than one Premium subscription with `gives_access: true` is
 * operationally ambiguous and produces no candidate. A complete response
 * with zero active Premium subscriptions is unequivocal evidence that the
 * mirror must become inactive; a minimal replacement is used when there is
 * no single inactive Premium record whose optional details can be copied.
 */
export function reconcileRevenueCatPremiumSubscriptions(
  subscriptions: readonly RevenueCatSubscription[],
): RevenueCatPremiumReconciliation {
  const premiumSubscriptions = subscriptions.flatMap((subscription) => {
    const entitlement = premiumEntitlement(subscription);
    return entitlement ? [{ subscription, entitlement }] : [];
  });
  const activePremiumSubscriptions = premiumSubscriptions.filter(
    ({ subscription }) => subscription.givesAccess,
  );

  if (activePremiumSubscriptions.length > 1) {
    return { status: 'ambiguous', activeCandidateCount: activePremiumSubscriptions.length };
  }

  if (activePremiumSubscriptions.length === 1) {
    const selected = activePremiumSubscriptions[0];
    return {
      status: 'active',
      subscription: normalizeCurrentSubscription(selected.subscription, selected.entitlement),
      selectedSubscriptionId: selected.subscription.id,
    };
  }

  if (premiumSubscriptions.length === 1) {
    const selected = premiumSubscriptions[0];
    return {
      status: 'inactive',
      subscription: normalizeCurrentSubscription(selected.subscription, selected.entitlement),
      selectedSubscriptionId: selected.subscription.id,
    };
  }

  return {
    status: 'inactive',
    subscription: {
      provider: REVENUECAT_PROVIDER,
      entitlementActive: false,
    },
    selectedSubscriptionId: null,
  };
}
