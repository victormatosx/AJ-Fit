import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source-inspection suite (no React renderer in this Node-only vitest
 * config). Confirms the Paywall's Developer entry point is a SECOND UI over
 * the exact same `DevSubscriptionOverrideContext`/shared sheet already used
 * by Settings > Developer — not a new override mechanism, not a navigation
 * bypass. Behavioral coverage of the override itself (each simulated state,
 * the security gate, persistence) already lives in
 * `src/dev/__tests__/subscriptionOverride.test.ts` and
 * `subscriptionOverrideStorage.test.ts` — not duplicated here.
 */
const SOURCE = readFileSync('src/screens/PaywallScreen.tsx', 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const SETTINGS_SOURCE = readFileSync('src/screens/SettingsScreen.tsx', 'utf8');

describe('Paywall dev subscription override wiring', () => {
  it('reads the SAME context used by Settings > Developer — no second override mechanism', () => {
    expect(SOURCE).toContain("from '../dev/DevSubscriptionOverrideContext'");
    expect(SOURCE).toContain('useDevSubscriptionOverrideContext()');
  });

  it('reuses the exact same shared sheet/labels as Settings, not a Paywall-local duplicate', () => {
    expect(SOURCE).toContain("from '../dev/DevSubscriptionOverridePickerSheet'");
    expect(SOURCE).toContain('DevSubscriptionOverridePickerSheet');
    expect(SOURCE).toContain('DEV_OVERRIDE_LABELS');
  });

  it('the row and the sheet are both gated by `devOverrideAllowed`', () => {
    expect(SOURCE).toMatch(/\{devOverrideAllowed \? \(\s*<DevSubscriptionOverrideRow/);
    expect(SOURCE).toMatch(/\{devOverrideAllowed \? \(\s*<DevSubscriptionOverridePickerSheet/);
  });

  it('selecting an option forwards straight to the context setter — no local override state', () => {
    expect(SOURCE).toContain('onSelect={(next) => {\n            void setDevOverride(next);');
  });

  it('never introduces a navigation bypass — Paywall stays screen-agnostic about how it closes', () => {
    for (const forbidden of [
      'navigation.navigate',
      'skipPaywall',
      'bypassNavigation',
      'setScreen(',
      "resolvedScreen = '",
    ]) {
      expect(CODE).not.toContain(forbidden);
    }
  });

  it('never touches AsyncStorage directly — persistence stays inside subscriptionOverrideStorage.ts', () => {
    expect(CODE).not.toContain('AsyncStorage');
    expect(CODE).not.toContain('ajfit-dev-subscription-override');
  });

  it('never touches RevenueCat/Firestore/backend from the new wiring', () => {
    for (const forbidden of ['Purchases.configure', 'firestore', 'httpsCallable']) {
      expect(CODE).not.toContain(forbidden);
    }
  });

  it('does not add a second entitlement/isPremium derivation — Paywall still only consumes useSubscription()', () => {
    expect(CODE).not.toMatch(/const isPremium\s*=/);
    expect(SOURCE).toContain("from '../hooks/useSubscription'");
  });

  it('Settings > Developer also imports the SAME shared sheet — one component, two entry points', () => {
    expect(SETTINGS_SOURCE).toContain("from '../dev/DevSubscriptionOverridePickerSheet'");
    expect(SETTINGS_SOURCE).toContain('DevSubscriptionOverridePickerSheet');
  });
});
