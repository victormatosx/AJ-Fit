import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source-inspection suite (no React renderer in this Node-only vitest
 * config). Confirms `SubscriptionContext` wires the Dev Subscription
 * Override in through the single documented seam — RevenueCat -> Real State
 * -> Dev Override -> Effective State -> App — and never lets `configured`/
 * `loading` (the real identity-resolution machinery) depend on it.
 */
const SOURCE = readFileSync('src/state/SubscriptionContext.tsx', 'utf8');

describe('SubscriptionContext dev override wiring', () => {
  it('derives the public `customerInfo` from applyDevSubscriptionOverride(realCustomerInfo, devOverride)', () => {
    expect(SOURCE).toContain(
      'applyDevSubscriptionOverride(realCustomerInfo, devOverride)',
    );
  });

  it('derives isPremium from the post-override snapshot and exposes its effective alias', () => {
    expect(SOURCE).toMatch(
      /const isPremium = useMemo\(\s*\(\) => Boolean\(customerInfo\?\.entitlements\.active\[PREMIUM_ENTITLEMENT_ID\]\)/,
    );
    expect(SOURCE).toContain('const effectiveIsPremium = isPremium;');
  });

  it('retains explicit real and effective snapshots and Premium flags', () => {
    for (const field of [
      'realCustomerInfo',
      'effectiveCustomerInfo',
      'realIsPremium',
      'effectiveIsPremium',
    ]) {
      expect(SOURCE).toContain(field);
    }
  });

  it('`configured`/`loading` are computed from realCustomerInfo, never from the overridden one', () => {
    expect(SOURCE).toContain('const configured = !initializing && (uid === null || realCustomerInfo !== null);');
    expect(SOURCE).not.toContain('customerInfo !== null && !initializing');
  });

  it('reads the override from the dedicated, independently-gated context', () => {
    expect(SOURCE).toContain("from '../dev/DevSubscriptionOverrideContext'");
    expect(SOURCE).toContain('useDevSubscriptionOverrideContext()');
  });
});
