import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Fase 6 (docs/13_assinaturas_e_billing.md): "ASSINAR vs RENOVAR vs estados
 * de assinatura". Source-inspection suite, same pattern as the other
 * premium*Fase*.test.ts files — no component renderer in this Node-only
 * suite. Behavioral proof that entitlement always wins over commercial
 * status lives in `src/lib/__tests__/premiumEntitlementPrecedence.test.ts`
 * (real CustomerInfo fixtures, real production functions); this file only
 * proves the wiring: PremiumRequiredSheet actually consumes capability+
 * intent together, PremiumAction/requestPremiumAction stayed simple, and
 * SubscriptionCenterScreen (already correct pre-Fase-6) was not touched.
 */
function source(path: string): string {
  return readFileSync(path, 'utf8');
}
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('FASE 6 — PremiumRequiredSheet resolves copy from capability + intent together', () => {
  const sheet = source('src/components/premium/PremiumRequiredSheet.tsx');
  const code = stripComments(sheet);

  it('calls resolvePremiumActionCopy with both capability and intent, not capability alone', () => {
    expect(code).toContain('resolvePremiumActionCopy({');
    expect(code).toMatch(/resolvePremiumActionCopy\(\{\s*capability:[\s\S]{0,40}intent,/);
  });

  it('still never imports RevenueCat/Firestore/CustomerInfo/PaywallScreen directly — Fase 6 only added a domain lookup, not new infrastructure knowledge', () => {
    for (const forbidden of ['Purchases.', 'firestore', 'CustomerInfo', 'PaywallScreen', 'purchasePackage']) {
      expect(code).not.toContain(forbidden);
    }
  });
});

describe('FASE 6 — PremiumAction remains ignorant of commercial context', () => {
  const code = stripComments(source('src/components/premium/PremiumAction.tsx'));

  it('never imports subscriptionCenter, premiumUpgradeIntent, or premiumCapabilityCopy', () => {
    for (const forbidden of ['subscriptionCenter', 'premiumUpgradeIntent', 'premiumCapabilityCopy', 'SubscriptionCenterStatus', 'expirationDate']) {
      expect(code).not.toContain(forbidden);
    }
  });
});

describe('FASE 6 — requestPremiumAction/usePremiumAction API stayed simple', () => {
  const ctx = source('src/state/PremiumActionContext.tsx');
  const code = stripComments(ctx);

  it('RequestPremiumActionArgs is still exactly { capability, onAllowed } — no status/expired/wasSubscriber/billingIssue params leaked to features', () => {
    const typeBody = code.slice(
      code.indexOf('type RequestPremiumActionArgs = {'),
      code.indexOf('};', code.indexOf('type RequestPremiumActionArgs = {')),
    );
    expect(typeBody).toContain('capability: PremiumCapability;');
    expect(typeBody).toContain('onAllowed:');
    for (const forbidden of ['status', 'expired', 'wasSubscriber', 'billingIssue', 'intent']) {
      expect(typeBody.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('the provider — not the feature — resolves status/intent internally', () => {
    expect(code).toContain('resolveSubscriptionCenterModel({');
    expect(code).toContain('resolvePremiumUpgradeIntent(status)');
  });
});

describe('FASE 6 — SubscriptionCenterScreen already correctly separates access from commercial presentation (audited, not rewritten)', () => {
  const screen = source('src/screens/SubscriptionCenterScreen.tsx');
  const code = stripComments(screen);

  it('never blocks access based on status — hasPremiumAccess/canPerform only, no `if (status === ...) deny` pattern', () => {
    expect(code).not.toContain('canPerform');
    expect(code).not.toMatch(/status\s*===\s*'(expired|canceled|billing_issue|grace_period)'\s*\)\s*\{\s*(return null|deny)/);
  });

  it('canceled status renders full access with an informational date, and has a safe no-date fallback', () => {
    expect(code).toContain("case 'canceled':");
    expect(code).toContain('canceledNoDate');
  });

  it('billing_issue/grace_period route to the real subscription management flow (manageSubscription), not an invented destination', () => {
    expect(code).toContain('managePayment');
    expect(code).toContain('manageSubscription({');
  });

  it('dates are formatted through Intl.DateTimeFormat with the active locale — never hardcoded month names', () => {
    expect(code).toContain("new Intl.DateTimeFormat(locale,");
    expect(code).toContain('i18n.resolvedLanguage');
  });
});

describe('FASE 6 — regression: Fases 1–5 unchanged', () => {
  it('Fase 1: premiumGate.ts still opens AppShell unconditionally', () => {
    expect(source('src/lib/premiumGate.ts')).toContain("return 'app';");
  });

  it('Fase 2: canPerform (usePremiumCapabilities) is untouched by this fase', () => {
    const hook = source('src/hooks/usePremiumCapabilities.ts');
    expect(hook).not.toContain('subscriptionCenter');
    expect(hook).not.toContain('premiumUpgradeIntent');
  });

  it('Fase 3: capability guards (defense-in-depth) are all still present', () => {
    expect(source('src/screens/WorkoutScreen.tsx')).toContain("if (!canPerform('START_WORKOUT')) onDone();");
    const assessment = stripComments(source('src/screens/AssessmentScreen.tsx'));
    const handleSaveBodies = [...assessment.matchAll(/const handleSave = async \(\) => \{[\s\S]*?\n  \};/g)];
    expect(handleSaveBodies.length).toBe(2);
  });

  it('Fase 4: PremiumRequiredSheet is still the only blocked-action sheet, reused via PremiumActionProvider', () => {
    const provider = stripComments(source('src/state/PremiumActionContext.tsx'));
    expect(provider).toContain(
      "import { PremiumRequiredSheet } from '../components/premium/PremiumRequiredSheet';",
    );
  });

  it('Fase 5: <PremiumAction> is still used at the three migrated visual entry points', () => {
    expect(source('src/screens/AppShell.tsx')).toContain('<PremiumAction capability="START_WORKOUT"');
    expect(source('src/screens/ProgressPhotosScreen.tsx')).toContain(
      '<PremiumAction capability="ADD_PROGRESS_PHOTO"',
    );
    expect(source('src/components/fitness/AssessmentActionCard.tsx')).toContain(
      '<PremiumAction capability="CREATE_ASSESSMENT"',
    );
  });
});

describe('FASE 6 — RevenueCat and backend infra untouched', () => {
  it('revenueCatService.ts has no new imports from this fase', () => {
    const service = source('src/services/revenueCatService.ts');
    expect(service).not.toContain('premiumUpgradeIntent');
    expect(service).not.toContain('premiumCapabilityCopy');
    expect(service).not.toContain('PremiumRequiredSheet');
  });
});
