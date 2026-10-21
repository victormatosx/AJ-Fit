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

/**
 * Classifies only a purchase explicitly completed through the app. This is
 * the ONLY function allowed to produce a celebratable kind: it is called
 * exclusively right after `performPurchase` resolves a manual, in-app
 * purchase/reactivation, never from a passive `CustomerInfo` sync (RevenueCat
 * listener, restore, app startup, foreground refresh). That keeps automatic
 * renewals and background revalidation from ever being mistaken for a
 * celebratable event.
 */
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
