import { describe, expect, it } from 'vitest';

import {
  classifyCompletedSubscriptionPurchase,
  resolveSubscriptionCelebration,
  type SubscriptionCelebrationSnapshot,
} from '../subscriptionCelebration';
import type { CustomerInfo } from 'react-native-purchases';

function snapshot(
  values: Partial<SubscriptionCelebrationSnapshot> = {},
): SubscriptionCelebrationSnapshot {
  return {
    premiumActive: false,
    hasPremiumHistory: false,
    latestPurchaseDate: null,
    ...values,
  };
}

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

describe('subscription celebration transition', () => {
  it('does not infer a first purchase from entitlement activation', () => {
    expect(resolveSubscriptionCelebration(
      snapshot(),
      snapshot({ premiumActive: true, hasPremiumHistory: true }),
    )).toBeNull();
  });

  it('does not treat restore or revalidation as renewal without a newer transaction', () => {
    expect(resolveSubscriptionCelebration(
      snapshot({ hasPremiumHistory: true, latestPurchaseDate: '2026-08-01T12:00:00.000Z' }),
      snapshot({
        premiumActive: true,
        hasPremiumHistory: true,
        latestPurchaseDate: '2026-08-01T12:00:00.000Z',
      }),
    )).toBeNull();
  });

  it('celebrates only when the latest purchase transaction advances', () => {
    const previous = snapshot({
      premiumActive: true,
      hasPremiumHistory: true,
      latestPurchaseDate: '2026-08-01T12:00:00.000Z',
    });
    expect(resolveSubscriptionCelebration(previous, {
      ...previous,
      latestPurchaseDate: '2026-09-01T12:00:00.000Z',
    })).toBe('renewed');
  });

  it('does not celebrate identical refreshes, cancellation or expiration', () => {
    const active = snapshot({
      premiumActive: true,
      hasPremiumHistory: true,
      latestPurchaseDate: '2026-08-01T12:00:00.000Z',
    });
    expect(resolveSubscriptionCelebration(active, { ...active })).toBeNull();
    expect(resolveSubscriptionCelebration(active, {
      ...active,
      premiumActive: false,
    })).toBeNull();
  });

  it('does not infer a renewal from missing, invalid or older timestamps', () => {
    const active = snapshot({
      premiumActive: true,
      hasPremiumHistory: true,
      latestPurchaseDate: '2026-08-01T12:00:00.000Z',
    });
    expect(resolveSubscriptionCelebration(active, {
      ...active,
      latestPurchaseDate: 'invalid',
    })).toBeNull();
  });

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
});
