import type { CustomerInfo } from 'react-native-purchases';

import { PREMIUM_ENTITLEMENT_ID } from './subscriptionConstants';

export type SubscriptionCelebrationKind = 'activated' | 'renewed';

export type SubscriptionCelebrationSnapshot = {
  premiumActive: boolean;
  hasPremiumHistory: boolean;
  latestPurchaseDate: string | null;
};

export type SubscriptionPurchaseCelebrationEvent = {
  uid: string;
  kind: SubscriptionCelebrationKind;
  latestPurchaseDate: string | null;
};

type SubscriptionPurchaseCelebrationListener = (
  event: SubscriptionPurchaseCelebrationEvent,
) => void;

export type SubscriptionRestoreCelebrationBoundary = {
  uid: string;
  phase: 'started' | 'finished';
  latestPurchaseDate?: string | null;
};

type SubscriptionRestoreCelebrationListener = (
  event: SubscriptionRestoreCelebrationBoundary,
) => void;

const purchaseCelebrationListeners = new Set<SubscriptionPurchaseCelebrationListener>();
const restoreCelebrationListeners = new Set<SubscriptionRestoreCelebrationListener>();

export function subscriptionCelebrationState(
  customerInfo: CustomerInfo | null,
): SubscriptionCelebrationSnapshot | null {
  if (!customerInfo) return null;
  const active = customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID] ?? null;
  const known = active ?? customerInfo.entitlements.all[PREMIUM_ENTITLEMENT_ID] ?? null;
  return {
    premiumActive: active !== null,
    hasPremiumHistory: known !== null,
    latestPurchaseDate: known?.latestPurchaseDate ?? null,
  };
}

function advanced(previous: string | null, next: string | null): boolean {
  if (!previous || !next) return false;
  const previousMs = Date.parse(previous);
  const nextMs = Date.parse(next);
  return Number.isFinite(previousMs) && Number.isFinite(nextMs) && nextMs > previousMs;
}

/**
 * Detects a real renewal observed outside the in-app purchase flow. A renewal
 * must advance the latest transaction date; entitlement activation or a new
 * expiration date alone can also happen during restore/revalidation and must
 * stay silent.
 */
export function resolveSubscriptionCelebration(
  previous: SubscriptionCelebrationSnapshot,
  next: SubscriptionCelebrationSnapshot,
): SubscriptionCelebrationKind | null {
  if (
    next.premiumActive &&
    previous.hasPremiumHistory &&
    advanced(previous.latestPurchaseDate, next.latestPurchaseDate)
  ) {
    return 'renewed';
  }

  return null;
}

/** Classifies only a purchase explicitly completed through the app. */
export function classifyCompletedSubscriptionPurchase(
  previousCustomerInfo: CustomerInfo,
  nextCustomerInfo: CustomerInfo,
): SubscriptionCelebrationKind | null {
  const previous = subscriptionCelebrationState(previousCustomerInfo);
  const next = subscriptionCelebrationState(nextCustomerInfo);
  if (!previous || !next?.premiumActive) return null;
  return previous.hasPremiumHistory ? 'renewed' : 'activated';
}

/**
 * A tiny synchronous event seam keeps purchase provenance explicit. CustomerInfo
 * alone cannot distinguish a new purchase from restoring an existing one.
 */
export function emitSubscriptionPurchaseCelebration(
  event: SubscriptionPurchaseCelebrationEvent,
): void {
  purchaseCelebrationListeners.forEach((listener) => listener(event));
}

export function subscribeToSubscriptionPurchaseCelebrations(
  listener: SubscriptionPurchaseCelebrationListener,
): () => void {
  purchaseCelebrationListeners.add(listener);
  return () => {
    purchaseCelebrationListeners.delete(listener);
  };
}

export function emitSubscriptionRestoreCelebrationBoundary(
  event: SubscriptionRestoreCelebrationBoundary,
): void {
  restoreCelebrationListeners.forEach((listener) => listener(event));
}

export function subscribeToSubscriptionRestoreCelebrationBoundaries(
  listener: SubscriptionRestoreCelebrationListener,
): () => void {
  restoreCelebrationListeners.add(listener);
  return () => {
    restoreCelebrationListeners.delete(listener);
  };
}
