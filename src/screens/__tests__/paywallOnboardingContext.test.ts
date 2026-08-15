import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const paywallScreen = read('screens/PaywallScreen.tsx');
const appRoot = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8');

/**
 * Regression guard for Fase H (docs/onboarding_funnel_architecture.md
 * §Paywall): `entryContext` must stay copy-only, and the deliberate
 * X-closes-via-logout behavior (§43 of the product spec) must survive
 * untouched — see App.tsx's `onClose` prop passed to PaywallScreen.
 */
describe('PaywallScreen entryContext boundary', () => {
  it('accepts an optional, copy-only entryContext prop', () => {
    expect(paywallScreen).toContain('entryContext?: OnboardingAuthContext | null');
    expect(paywallScreen).toContain("entryContext?.origin === 'planCompleted'");
  });

  it('keeps RevenueCat/purchase/restore/promo/entitlement logic untouched by entryContext', () => {
    for (const forbiddenNeighbor of [
      'purchase(',
      'purchaseOption(',
      'restore(',
      'applyCode(',
      'entitlements.active',
    ]) {
      // None of the commercial call/entitlement sites should be adjacent to
      // entryContext on the same line — it must never gate a commercial path.
      const lines = paywallScreen.split('\n').filter((l) => l.includes(forbiddenNeighbor));
      for (const line of lines) expect(line).not.toContain('entryContext');
    }
  });

  it('preserves the documented onClose -> logout() behavior (product debt, not a bug)', () => {
    expect(appRoot).toContain("resolvedScreen === 'paywall'");
    expect(appRoot).toContain('await logout();');
    expect(appRoot).toContain('entryContext={onboardingAuthContext}');
  });
});
