import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Fase 4 (docs/13_assinaturas_e_billing.md): the definitive blocked-action
 * UX — `PremiumActionProvider`/`usePremiumAction` (the controller),
 * `PremiumRequiredSheet` (the shared visual), and their wiring into
 * AppShell/AssessmentScreen/ProgressPhotosScreen. Source-inspection suite,
 * same pattern as `premiumCapabilitiesPolicyFase3.test.ts` — no component
 * renderer in this Node-only suite. Pure-logic pieces
 * (`resolvePremiumUpgradeIntent`, `resolvePremiumActionCopy`) have real
 * behavioral tests in `src/lib/__tests__/`.
 */
function source(path: string): string {
  return readFileSync(path, 'utf8');
}
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('FASE 4 — PremiumActionContext does not duplicate authorization', () => {
  const ctx = source('src/state/PremiumActionContext.tsx');
  const code = stripComments(ctx);

  it('requestPremiumAction decides allowed/blocked via canPerform from usePremiumCapabilities — no other source', () => {
    expect(ctx).toContain(
      "import { usePremiumCapabilities } from '../hooks/usePremiumCapabilities';",
    );
    const body = code.slice(
      code.indexOf('const requestPremiumAction = useCallback('),
      code.indexOf('[canPerform],'),
    );
    expect(body).toContain('if (canPerform(capability)) {');
    expect(body).toContain('onAllowed();');
    expect(body).toContain('setPending(capability);');
  });

  it('never calls RevenueCat, Firestore or AsyncStorage directly', () => {
    for (const forbidden of ['Purchases.', 'revenueCatService', 'firestore', 'AsyncStorage', 'getCustomerInfo']) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('never manually forces isPremium — status is only read for CTA copy, never for the allow/deny decision', () => {
    expect(code).not.toContain('setIsPremium');
    expect(code).not.toContain('isPremium =');
  });

  it('reuses resolveSubscriptionCenterModel instead of re-deriving subscription status', () => {
    expect(ctx).toContain(
      "import { resolveSubscriptionCenterModel } from '../lib/subscriptionCenter';",
    );
    expect(code).toContain('resolveSubscriptionCenterModel({');
  });

  it('onRequestUpgrade is the caller-supplied trigger — the provider mounts no PaywallScreen of its own', () => {
    expect(code).not.toContain('<PaywallScreen');
    expect(code).not.toContain("from './PaywallScreen'");
    expect(code).not.toContain("from '../screens/PaywallScreen'");
    expect(code).not.toContain('purchasePackage');
    expect(code).not.toContain('purchase(');
  });

  it('dismiss only clears local pending state — no logout, no navigation, no tab change', () => {
    const dismissBody = code.slice(
      code.indexOf('const dismiss = useCallback('),
      code.indexOf(', []);', code.indexOf('const dismiss = useCallback(')) + 6,
    );
    expect(dismissBody).toContain('setPending(null)');
    for (const forbidden of ['logout', 'setTab', 'navigate']) {
      expect(dismissBody).not.toContain(forbidden);
    }
  });

  it('accepting the upgrade closes the sheet before triggering the existing Paywall trigger — no stale callback stored for later', () => {
    const body = code.slice(
      code.indexOf('const handleRequestUpgrade = useCallback('),
      code.indexOf('[onRequestUpgrade],'),
    );
    expect(body.indexOf('setPending(null)')).toBeLessThan(body.indexOf('onRequestUpgrade()'));
  });
});

describe('FASE 4 — PremiumRequiredSheet is a shared, compact, on-brand sheet', () => {
  const sheet = source('src/components/premium/PremiumRequiredSheet.tsx');
  const code = stripComments(sheet);

  it('uses the app\'s existing bottom-sheet Modal pattern (transparent + slide), not a full-screen takeover', () => {
    expect(sheet).toContain('animationType="slide"');
    expect(sheet).toContain('transparent');
  });

  it('never calls RevenueCat/purchase directly — the primary CTA only calls onRequestUpgrade', () => {
    for (const forbidden of ['Purchases.', 'purchasePackage', 'purchase(', 'restorePurchases']) {
      expect(code).not.toContain(forbidden);
    }
    expect(sheet).toContain('onPress={onRequestUpgrade}');
  });

  it('has a secondary, discreet dismiss action distinct from the primary CTA', () => {
    expect(sheet).toContain("t('premiumAction.cta.dismiss')");
    expect(code).toContain('onPress={onDismiss}');
  });

  it('is accessible: labelled CTA, labelled dismiss, no reliance on the lock icon alone', () => {
    expect(sheet).toContain('accessibilityLabel={tLoose(CTA_KEY[intent])}');
    expect(sheet).toContain("accessibilityLabel={t('premiumAction.cta.dismiss')}");
    expect(sheet).toContain('accessibilityRole="button"');
  });

  it('reuses design tokens/components instead of a parallel visual language', () => {
    expect(sheet).toContain("from '../../theme/tokens'");
    expect(sheet).toContain("from '../ui/CtaButton'");
    expect(sheet).toContain("from '../ui/Icon'");
    expect(sheet).toContain("from '../ui/Display'");
  });

  it('resolves copy per capability via the pure lookup, never hardcoding capability-specific text inline', () => {
    expect(sheet).toContain(
      "import { resolvePremiumActionCopy } from '../../lib/premiumCapabilityCopy';",
    );
  });
});

describe('FASE 4 — AppShell wiring reuses the existing on-demand Paywall (no second instance)', () => {
  const appShell = source('src/screens/AppShell.tsx');
  const code = stripComments(appShell);

  it('exactly one <PaywallScreen mount exists in the whole file', () => {
    const matches = code.match(/<PaywallScreen/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('PremiumActionProvider wraps AppShellContent, wired to the same setShowPremium the Subscription Center already used', () => {
    expect(appShell).toContain(
      '<PremiumActionProvider onRequestUpgrade={() => setShowPremium(true)}>',
    );
    // Same trigger as the pre-existing renew flow from SubscriptionCenterScreen.
    expect(appShell).toContain('onRenew={() => {');
    expect(appShell).toContain('setShowPremium(true);');
  });

  it('StartWorkoutConfirmation shows a discreet lock indicator instead of hiding/disabling the CTA', () => {
    // FASE 5: `locked` is now derived by <PremiumAction>'s render prop
    // rather than a `canPerform` read passed in as a prop — see
    // premiumCapabilitiesPolicyFase3.test.ts for the <PremiumAction> wiring
    // itself.
    expect(appShell).toContain("Icon name={locked ? 'lock' : 'play'}");
  });
});

describe('FASE 4 — read paths remain ungated (no Fase 3 regression)', () => {
  const untouchedScreens = [
    'src/screens/ProfileScreen.tsx',
    'src/screens/EditProfileScreen.tsx',
    'src/screens/SettingsScreen.tsx',
    'src/screens/SupportFormScreen.tsx',
    'src/screens/SubscriptionCenterScreen.tsx',
    'src/screens/ConsistencyScreen.tsx',
    'src/screens/HomeScreen.tsx',
    'src/screens/ProgressScreen.tsx',
  ];

  it.each(untouchedScreens)('%s never imports the Premium action controller', (path) => {
    expect(source(path)).not.toContain('usePremiumAction');
  });

  it('ProgressPhotosScreen gallery reads and the locked-vault branch stay independent of requestPremiumAction', () => {
    const code = stripComments(source('src/screens/ProgressPhotosScreen.tsx'));
    expect(code).not.toMatch(/requestPremiumAction[\s\S]{0,60}(loadGallery|subscribeToGallery)/);
    const lockedBranch = code.slice(
      code.lastIndexOf('if (shouldShowPhotoVaultLocked(unlocked, showLocked)) {'),
      code.indexOf('return (\n    <View'),
    );
    expect(lockedBranch).not.toContain('requestPremiumAction');
    expect(lockedBranch).not.toContain('canPerform');
  });

  it('AssessmentScreen never gates viewing history — only the two "nova avaliação" entry points and their save handlers', () => {
    const code = stripComments(source('src/screens/AssessmentScreen.tsx'));
    expect(code).not.toMatch(/requestPremiumAction[\s\S]{0,80}(assessments\.map|historyRows)/);
  });
});

describe('FASE 4 — no historical data is hidden behind a lock', () => {
  it('no new opacity/blur/overlay was introduced conditioned on canPerform in the touched screens', () => {
    for (const path of [
      'src/screens/ProgressPhotosScreen.tsx',
      'src/screens/AssessmentScreen.tsx',
      'src/screens/AppShell.tsx',
    ]) {
      const code = stripComments(source(path));
      expect(code).not.toMatch(/canPerform\([^)]*\)\s*\?\s*[\d.]+\s*:\s*1/); // opacity ternary
      expect(code).not.toMatch(/blurRadius/);
    }
  });
});

describe('FASE 4 — root gate and RevenueCat infra remain untouched', () => {
  it('premiumGate.ts still opens AppShell unconditionally', () => {
    const gate = source('src/lib/premiumGate.ts');
    expect(gate).toContain("return 'app';");
  });

  it('revenueCatService.ts was not touched by this fase (no Premium-action imports)', () => {
    const service = source('src/services/revenueCatService.ts');
    expect(service).not.toContain('PremiumActionContext');
    expect(service).not.toContain('PremiumRequiredSheet');
  });
});
