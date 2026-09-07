import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerInfo } from 'react-native-purchases';

const mockPlatform = vi.hoisted(() => ({ OS: 'ios' }));
vi.mock('react-native', () => ({ Platform: mockPlatform }));

import {
  applyDevSubscriptionOverride,
  createDevSubscriptionOverrideSession,
  isDevSubscriptionOverrideAllowed,
  isDevSubscriptionOverrideState,
  resolveDevSubscriptionOverrideForIdentity,
} from '../subscriptionOverride';
import { PREMIUM_ENTITLEMENT_ID } from '../../lib/subscriptionConstants';

function setDevFlags({ dev, optIn }: { dev: boolean; optIn: boolean }) {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = dev;
  process.env.EXPO_PUBLIC_ENABLE_DEV_SUBSCRIPTION_OVERRIDES = optIn ? '1' : '0';
}

const NOW = new Date('2026-08-25T12:00:00.000Z');

function fakeRealCustomerInfo(overrides: Partial<CustomerInfo> = {}): CustomerInfo {
  return {
    entitlements: { active: {}, all: {}, verification: 'NOT_REQUESTED' as never },
    activeSubscriptions: [],
    allPurchasedProductIdentifiers: [],
    latestExpirationDate: null,
    firstSeen: '2026-01-01T00:00:00.000Z',
    originalAppUserId: 'uid-real-123',
    requestDate: NOW.toISOString(),
    allExpirationDates: {},
    allPurchaseDates: {},
    originalApplicationVersion: null,
    originalPurchaseDate: null,
    managementURL: null,
    nonSubscriptionTransactions: [],
    subscriptionsByProductIdentifier: {},
    ...overrides,
  } as CustomerInfo;
}

describe('isDevSubscriptionOverrideState', () => {
  it('accepts only the seven documented states', () => {
    for (const s of [
      'REAL',
      'FREE',
      'PREMIUM_MONTHLY',
      'PREMIUM_ANNUAL',
      'TRIAL',
      'CANCELED_ACTIVE',
      'EXPIRED',
    ]) {
      expect(isDevSubscriptionOverrideState(s)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    for (const bad of [null, undefined, '', 'PREMIUM', 'premium_monthly', 42, {}]) {
      expect(isDevSubscriptionOverrideState(bad)).toBe(false);
    }
  });
});

describe('isDevSubscriptionOverrideAllowed', () => {
  afterEach(() => setDevFlags({ dev: false, optIn: false }));

  it('requires BOTH __DEV__ and the explicit opt-in flag', () => {
    setDevFlags({ dev: true, optIn: true });
    expect(isDevSubscriptionOverrideAllowed()).toBe(true);
  });

  it('is false when __DEV__ is true but the flag is unset (production-like misconfiguration)', () => {
    setDevFlags({ dev: true, optIn: false });
    expect(isDevSubscriptionOverrideAllowed()).toBe(false);
  });

  it('is false when the flag is set but __DEV__ is false — the critical production guarantee', () => {
    setDevFlags({ dev: false, optIn: true });
    expect(isDevSubscriptionOverrideAllowed()).toBe(false);
  });

  it('is false when neither is set', () => {
    setDevFlags({ dev: false, optIn: false });
    expect(isDevSubscriptionOverrideAllowed()).toBe(false);
  });
});

describe('session-scoped override identity', () => {
  it('cold start always creates REAL, with no persisted state input', () => {
    expect(createDevSubscriptionOverrideSession('user-a')).toEqual({
      uid: 'user-a',
      override: 'REAL',
    });
  });

  it('resets synchronously on logout and UID change', () => {
    const premiumSession = { uid: 'user-a', override: 'PREMIUM_MONTHLY' } as const;
    expect(resolveDevSubscriptionOverrideForIdentity(premiumSession, null, true)).toBe('REAL');
    expect(resolveDevSubscriptionOverrideForIdentity(premiumSession, 'user-b', true)).toBe('REAL');
  });

  it('keeps an explicit simulation only for its current identity', () => {
    const premiumSession = { uid: 'user-a', override: 'PREMIUM_MONTHLY' } as const;
    expect(resolveDevSubscriptionOverrideForIdentity(premiumSession, 'user-a', true)).toBe(
      'PREMIUM_MONTHLY',
    );
  });

  it('selecting REAL removes the simulation immediately for the same UID', () => {
    const realSession = { uid: 'user-a', override: 'REAL' } as const;
    expect(resolveDevSubscriptionOverrideForIdentity(realSession, 'user-a', true)).toBe('REAL');
  });

  it('a newly-created account cannot inherit the previous account override', () => {
    const previousAccount = { uid: 'user-a', override: 'PREMIUM_ANNUAL' } as const;
    expect(resolveDevSubscriptionOverrideForIdentity(previousAccount, 'new-user', true)).toBe(
      'REAL',
    );
  });

  it('production/disallowed builds always resolve REAL', () => {
    const premiumSession = { uid: 'user-a', override: 'PREMIUM_MONTHLY' } as const;
    expect(resolveDevSubscriptionOverrideForIdentity(premiumSession, 'user-a', false)).toBe('REAL');
  });
});

describe('applyDevSubscriptionOverride', () => {
  beforeEach(() => setDevFlags({ dev: true, optIn: true }));
  afterEach(() => setDevFlags({ dev: false, optIn: false }));

  it('REAL: returns the exact same CustomerInfo reference — no transform at all', () => {
    const real = fakeRealCustomerInfo();
    expect(applyDevSubscriptionOverride(real, 'REAL', NOW)).toBe(real);
  });

  it('null real CustomerInfo: returns null regardless of override (never manufactures state from nothing)', () => {
    expect(applyDevSubscriptionOverride(null, 'PREMIUM_MONTHLY', NOW)).toBeNull();
  });

  it('FREE: no active entitlement', () => {
    const real = fakeRealCustomerInfo();
    const effective = applyDevSubscriptionOverride(real, 'FREE', NOW)!;
    expect(effective.entitlements.active[PREMIUM_ENTITLEMENT_ID]).toBeUndefined();
    expect(effective.activeSubscriptions).toEqual([]);
  });

  it('PREMIUM_MONTHLY: Premium active, monthly product id, no trial', () => {
    const real = fakeRealCustomerInfo();
    const originalReal = structuredClone(real);
    const effective = applyDevSubscriptionOverride(real, 'PREMIUM_MONTHLY', NOW)!;
    const entitlement = effective.entitlements.active[PREMIUM_ENTITLEMENT_ID];
    expect(entitlement).toBeDefined();
    expect(entitlement.isActive).toBe(true);
    expect(entitlement.willRenew).toBe(true);
    expect(entitlement.periodType).toBe('NORMAL');
    expect(entitlement.productIdentifier).toContain('monthly');
    expect(new Date(entitlement.expirationDate!).getTime()).toBeGreaterThan(NOW.getTime());
    expect(real).toEqual(originalReal);
    expect(effective).not.toBe(real);
  });

  it('PREMIUM_ANNUAL: Premium active, annual product id, no trial, further-out expiration than monthly', () => {
    const real = fakeRealCustomerInfo();
    const monthly = applyDevSubscriptionOverride(real, 'PREMIUM_MONTHLY', NOW)!;
    const annual = applyDevSubscriptionOverride(real, 'PREMIUM_ANNUAL', NOW)!;
    const monthlyEntitlement = monthly.entitlements.active[PREMIUM_ENTITLEMENT_ID];
    const annualEntitlement = annual.entitlements.active[PREMIUM_ENTITLEMENT_ID];
    expect(annualEntitlement.isActive).toBe(true);
    expect(annualEntitlement.periodType).toBe('NORMAL');
    expect(annualEntitlement.productIdentifier).toContain('annual');
    expect(new Date(annualEntitlement.expirationDate!).getTime()).toBeGreaterThan(
      new Date(monthlyEntitlement.expirationDate!).getTime(),
    );
    expect(
      new Date(annualEntitlement.expirationDate!).getTime()
        - new Date(annualEntitlement.latestPurchaseDate).getTime(),
    ).toBe(365 * 24 * 60 * 60 * 1000);
  });

  it('TRIAL: Premium active, trial period, expiration a few days in the future', () => {
    const real = fakeRealCustomerInfo();
    const effective = applyDevSubscriptionOverride(real, 'TRIAL', NOW)!;
    const entitlement = effective.entitlements.active[PREMIUM_ENTITLEMENT_ID];
    expect(entitlement.isActive).toBe(true);
    expect(entitlement.periodType).toBe('TRIAL');
    const daysUntilExpiration =
      (new Date(entitlement.expirationDate!).getTime() - NOW.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysUntilExpiration).toBeGreaterThan(0);
    expect(daysUntilExpiration).toBeLessThanOrEqual(7);
  });

  it('CANCELED_ACTIVE: Premium still true even though canceled, until expiration', () => {
    const real = fakeRealCustomerInfo();
    const effective = applyDevSubscriptionOverride(real, 'CANCELED_ACTIVE', NOW)!;
    const entitlement = effective.entitlements.active[PREMIUM_ENTITLEMENT_ID];
    expect(entitlement.isActive).toBe(true);
    expect(entitlement.willRenew).toBe(false);
    expect(entitlement.unsubscribeDetectedAt).not.toBeNull();
    expect(new Date(entitlement.expirationDate!).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('EXPIRED: Premium false, expiration date in the past', () => {
    const real = fakeRealCustomerInfo();
    const effective = applyDevSubscriptionOverride(real, 'EXPIRED', NOW)!;
    expect(effective.entitlements.active[PREMIUM_ENTITLEMENT_ID]).toBeUndefined();
    const entitlement = effective.entitlements.all[PREMIUM_ENTITLEMENT_ID];
    expect(entitlement.isActive).toBe(false);
    expect(new Date(entitlement.expirationDate!).getTime()).toBeLessThan(NOW.getTime());
  });

  it('never grants Premium via any override when overrides are not allowed', () => {
    setDevFlags({ dev: false, optIn: false });
    const real = fakeRealCustomerInfo();
    for (const override of [
      'FREE',
      'PREMIUM_MONTHLY',
      'PREMIUM_ANNUAL',
      'TRIAL',
      'CANCELED_ACTIVE',
      'EXPIRED',
    ] as const) {
      const effective = applyDevSubscriptionOverride(real, override, NOW);
      expect(effective).toBe(real);
      expect(effective!.entitlements.active[PREMIUM_ENTITLEMENT_ID]).toBeUndefined();
    }
  });

  it('never grants Premium when __DEV__ true but opt-in flag is off', () => {
    setDevFlags({ dev: true, optIn: false });
    const real = fakeRealCustomerInfo();
    const effective = applyDevSubscriptionOverride(real, 'PREMIUM_ANNUAL', NOW);
    expect(effective).toBe(real);
  });
});
