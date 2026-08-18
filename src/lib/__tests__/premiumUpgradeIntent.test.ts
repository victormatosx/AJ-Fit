import { describe, expect, it } from 'vitest';
import { resolvePremiumUpgradeIntent } from '../premiumUpgradeIntent';
import type { SubscriptionCenterStatus } from '../subscriptionCenter';

describe('resolvePremiumUpgradeIntent', () => {
  it('never subscribed (unknown) -> subscribe, never "renew"', () => {
    expect(resolvePremiumUpgradeIntent('unknown')).toBe('subscribe');
  });

  it('expired subscription -> renew', () => {
    expect(resolvePremiumUpgradeIntent('expired')).toBe('renew');
  });

  it.each<SubscriptionCenterStatus>(['active', 'trial', 'canceled', 'billing_issue', 'grace_period'])(
    'defensive fallback for entitlement-active statuses that should never reach a blocked sheet: %s -> unlock (never claims "renew" without proof)',
    (status) => {
      expect(resolvePremiumUpgradeIntent(status)).toBe('unlock');
    },
  );
});
