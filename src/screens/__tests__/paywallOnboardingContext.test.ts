import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const paywallScreen = read('screens/PaywallScreen.tsx');
const appRoot = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8');

/**
 * Regression guard for Fase H (docs/onboarding_funnel_architecture.md
 * §Paywall): `entryContext` must stay copy-only.
 *
 * FASE 1 (limited-mode rollout): the root gate no longer renders
 * PaywallScreen as `resolvedScreen === 'paywall'` — `resolvePremiumGate`
 * opens AppShell regardless of `isPremium` once the subscription is
 * resolved (see `src/lib/premiumGate.ts`). The onClose->logout() behavior
 * this file used to guard was specific to that now-removed root branch; it
 * no longer exists in App.tsx. PaywallScreen itself is untouched and stays
 * reachable on demand from inside AppShell (see `AppShell.tsx`'s
 * `showPremium` modal), where closing it does not log the user out.
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

  it('FASE 1: root gate no longer renders PaywallScreen or calls logout() from App.tsx', () => {
    expect(appRoot).not.toContain("resolvedScreen === 'paywall'");
    expect(appRoot).not.toContain('paywall:logout');
  });
});
