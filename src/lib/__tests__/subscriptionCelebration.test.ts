import { describe, expect, it, vi } from 'vitest';

import * as subscriptionCelebration from '../subscriptionCelebration';
import {
  classifyCompletedSubscriptionPurchase,
  emitSubscriptionPurchaseCelebration,
  emitSubscriptionRestoreCelebrationBoundary,
  subscribeToSubscriptionPurchaseCelebrations,
  subscribeToSubscriptionRestoreCelebrationBoundaries,
} from '../subscriptionCelebration';
import type { CustomerInfo } from 'react-native-purchases';

function customerInfo({
  active,
  known,
  latestPurchaseDate = null,
}: {
  active: boolean;
  known: boolean;
  latestPurchaseDate?: string | null;
}): CustomerInfo {
  const entitlement = known
    ? ({ latestPurchaseDate, expirationDate: null } as CustomerInfo['entitlements']['all'][string])
    : null;
  return {
    entitlements: {
      active: active && entitlement ? { premium: entitlement } : {},
      all: entitlement ? { premium: entitlement } : {},
    },
  } as CustomerInfo;
}

describe('subscription celebration classification', () => {
  it('classifies only an explicit first purchase as activated', () => {
    expect(classifyCompletedSubscriptionPurchase(
      customerInfo({ active: false, known: false }),
      customerInfo({
        active: true,
        known: true,
        latestPurchaseDate: '2026-09-15T12:00:00.000Z',
      }),
    )).toBe('activated');
  });

  it('classifies an explicit purchase with Premium history as renewed', () => {
    expect(classifyCompletedSubscriptionPurchase(
      customerInfo({
        active: false,
        known: true,
        latestPurchaseDate: '2026-08-01T12:00:00.000Z',
      }),
      customerInfo({
        active: true,
        known: true,
        latestPurchaseDate: '2026-09-15T12:00:00.000Z',
      }),
    )).toBe('renewed');
  });

  it('does not exist as a passive CustomerInfo-diffing path anymore', () => {
    // Regression guard: this module used to export `resolveSubscriptionCelebration`,
    // which inferred a "renewed" celebration from any CustomerInfo snapshot
    // advancing its latest purchase date — including auto-renewals delivered
    // silently by RevenueCat, app startup and foreground syncs. The only
    // sanctioned way to classify a celebratable event is
    // `classifyCompletedSubscriptionPurchase`, called exclusively right after
    // a manual in-app purchase resolves.
    expect((subscriptionCelebration as Record<string, unknown>).resolveSubscriptionCelebration)
      .toBeUndefined();
  });
});

describe('subscription celebration event bus', () => {
  it('delivers a purchase celebration only to purchase listeners', () => {
    const purchaseListener = vi.fn();
    const restoreListener = vi.fn();
    const unsubscribePurchase = subscribeToSubscriptionPurchaseCelebrations(purchaseListener);
    const unsubscribeRestore = subscribeToSubscriptionRestoreCelebrationBoundaries(restoreListener);

    emitSubscriptionPurchaseCelebration({
      uid: 'user-1',
      kind: 'renewed',
      latestPurchaseDate: '2026-09-15T12:00:00.000Z',
    });

    expect(purchaseListener).toHaveBeenCalledTimes(1);
    expect(purchaseListener).toHaveBeenCalledWith({
      uid: 'user-1',
      kind: 'renewed',
      latestPurchaseDate: '2026-09-15T12:00:00.000Z',
    });
    expect(restoreListener).not.toHaveBeenCalled();

    unsubscribePurchase();
    unsubscribeRestore();
  });

  it('delivers a restore boundary only to restore listeners, never as a purchase', () => {
    const purchaseListener = vi.fn();
    const restoreListener = vi.fn();
    const unsubscribePurchase = subscribeToSubscriptionPurchaseCelebrations(purchaseListener);
    const unsubscribeRestore = subscribeToSubscriptionRestoreCelebrationBoundaries(restoreListener);

    emitSubscriptionRestoreCelebrationBoundary({ uid: 'user-1', phase: 'started' });
    emitSubscriptionRestoreCelebrationBoundary({
      uid: 'user-1',
      phase: 'finished',
      latestPurchaseDate: '2026-09-15T12:00:00.000Z',
    });

    expect(restoreListener).toHaveBeenCalledTimes(2);
    expect(purchaseListener).not.toHaveBeenCalled();

    unsubscribePurchase();
    unsubscribeRestore();
  });
});
