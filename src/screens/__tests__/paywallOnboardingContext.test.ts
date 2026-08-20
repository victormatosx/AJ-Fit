import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const paywallScreen = read('screens/PaywallScreen.tsx');
const appRoot = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8');

/**
 * Regression guard for Fase H (docs/onboarding_funnel_architecture.md
 * §Paywall): `entryContext` must stay copy-only.
 *
 * FASE 1 (limited-mode rollout, commit `5fc0fa1`) removed the root Paywall
 * for EVERY non-Premium user. A later audit reintroduced it, but scoped
 * only to accounts that never resolved their initial commercial gate
 * (`commercialGateResolved` in `src/lib/premiumGate.ts`) — an established
 * non-Premium account still opens AppShell unconditionally, unchanged from
 * Fase 1. The reintroduced root branch reuses the pre-Fase-1
 * onClose->logout() rule (docs/24_funil_onboarding_arquitetura.md §8),
 * because that is still the only documented behavior for dismissing this
 * specific (root, pre-app) Paywall. PaywallScreen itself stays untouched
 * and also reachable on demand from inside AppShell (`AppShell.tsx`'s
 * `showPremium` modal), where closing it does NOT log the user out — that
 * is a different context from the one this file guards.
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

  it('root gate renders PaywallScreen only for a pending initial commercial gate, and closing it logs out', () => {
    expect(appRoot).toContain("resolvedScreen === 'paywall'");
    expect(appRoot).toContain('logout()');
  });

  it('the on-demand PaywallScreen inside AppShell is untouched and never calls logout on close', () => {
    const appShell = read('screens/AppShell.tsx');
    const line = appShell.split('\n').find((l) => l.includes('onClose={() => setShowPremium'));
    expect(line).toBeTruthy();
  });
});
