import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source/i18n-inspection suite (no React renderer in this Node-only vitest
 * config — same constraint as `paywallDevOverride.test.ts`/
 * `paywallAndroidPromoWiring.test.ts`). FASE 6.4: proves the Paywall's
 * commercial rules — trial communicated from real Store eligibility (with
 * or without a coupon), coupon framed as price/discount rather than trial
 * origin, real prices only, no hardcoded product/offering literals.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const PAYWALL_SOURCE = readFileSync('src/screens/PaywallScreen.tsx', 'utf8');
const PAYWALL_CODE = stripComments(PAYWALL_SOURCE);
const SUBSCRIPTION_OFFER_CODE = stripComments(readFileSync('src/lib/subscriptionOffer.ts', 'utf8'));

function loadCommon(lang: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`src/i18n/resources/${lang}/common.json`, 'utf8'));
}

const PT = loadCommon('pt-BR');
const EN = loadCommon('en');
const ES = loadCommon('es');

function promoStrings(root: Record<string, unknown>): Record<string, string> {
  const paywall = root.paywall as { promo: Record<string, unknown> };
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(paywall.promo)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

describe('FASE 6.4 — trial eligibility runs for the STANDARD catalog too (rule 1)', () => {
  it('eligibilityScopeKey is derived from `packages` directly, not gated behind an active promotional catalog resolution', () => {
    const scopeKeyFn = PAYWALL_CODE.slice(
      PAYWALL_CODE.indexOf('const eligibilityScopeKey = useMemo(() => {'),
      PAYWALL_CODE.indexOf('}, [packages]);') + '}, [packages]);'.length,
    );
    expect(scopeKeyFn).not.toContain('iosCatalogResolution');
    expect(scopeKeyFn).not.toContain('promoState');
    expect(scopeKeyFn).toContain('if (packages.length === 0) return null;');
  });

  it('checkIOSIntroEligibility is invoked from an effect scoped by `packages`, not `iosCatalogResolution`', () => {
    const effectSource = PAYWALL_CODE.slice(
      PAYWALL_CODE.indexOf('useEffect(() => {\n    const seq = ++eligibilityRequestSeq.current;'),
      PAYWALL_CODE.indexOf('eligibilityScopeKey, packages]);') + 'eligibilityScopeKey, packages]);'.length,
    );
    expect(effectSource).toContain('checkIOSIntroEligibility(productIds)');
    expect(effectSource).toContain('packages.map((pkg) => pkg.product.identifier)');
  });

  it('the per-package trial badge (offerLine) is computed for iOS unconditionally (Platform.OS check), not gated to an active promo', () => {
    expect(PAYWALL_CODE).toMatch(/const offerLine =\s*Platform\.OS === 'ios'/);
    expect(PAYWALL_CODE).not.toMatch(/offerLine =\s*iosOfferingRoute\?\.kind === 'promotional'/);
  });
});

describe("FASE 6.4 — Android trial signal is independent of the coupon (rule 3) and non-committal", () => {
  it('resolveAndroidTrialSignal is computed from the package alone, never from promoApplied/promoState', () => {
    const fn = SUBSCRIPTION_OFFER_CODE.slice(
      SUBSCRIPTION_OFFER_CODE.indexOf('export function resolveAndroidTrialSignal'),
    );
    const body = fn.slice(0, fn.indexOf('\n}') + 2);
    expect(body).not.toContain('promoApplied');
    expect(body).not.toContain('promoState');
    expect(body).toContain('isBasePlan');
    expect(body).toContain('subscriptionOptionHasFreeTrial');
  });

  it("returns a non-committal 'possible', never 'eligible' — no Android eligibility API exists to call, unlike iOS", () => {
    expect(SUBSCRIPTION_OFFER_CODE).toContain("export type AndroidTrialSignal = 'none' | 'possible'");
    expect(SUBSCRIPTION_OFFER_CODE).not.toMatch(/AndroidTrialSignal\s*=\s*['"]none['"]\s*\|\s*['"]eligible['"]/);
  });

  it('the Android trial marketing remains conditional and carries a Google Play disclosure', () => {
    expect(PAYWALL_CODE).toContain("t('paywall.trial.androidConditionalTitle'");
    expect(PAYWALL_CODE).toContain("t('paywall.legal.androidTrialDisclosure')");
    for (const root of [PT, EN, ES]) {
      const paywall = root.paywall as {
        trial: Record<string, string>;
        legal: Record<string, string>;
      };
      expect(paywall.trial.androidConditionalTitle).toBeTruthy();
      expect(paywall.legal.androidTrialDisclosure).toBeTruthy();
    }
  });
});

describe('FASE 6.4 — coupon copy never frames itself as the origin of the trial (rule 2/3)', () => {
  it.each([
    ['pt-BR', PT],
    ['en', EN],
    ['es', ES],
  ])('%s: freeTrial/ineligible strings lead with the PRICE benefit, not "code applied" immediately followed by the trial fact', (_lang, root) => {
    const strings = promoStrings(root as Record<string, unknown>);
    // Neither string may open with a "code applied" clause directly
    // attached to the trial/ineligibility fact — that phrasing reads as
    // "the code caused/promised the trial". Both should foreground the
    // promotional PRICE instead; the trial/ineligibility fact is a
    // separate, store-determined clause.
    expect(strings.freeTrial.toLowerCase()).not.toMatch(/^(código|code|codigo)\b/);
    expect(strings.ineligible.toLowerCase()).not.toMatch(/^(código|code|codigo)\b/);
    expect(strings.ineligible.toLowerCase()).not.toMatch(/teste|trial|prueba/);
  });

  it.each([
    ['pt-BR', PT],
    ['en', EN],
    ['es', ES],
  ])('%s: promo-applied/blocked copy (i18n, FASE 6.5) never mentions trial/days/free — only the offer/price fact', (_lang, root) => {
    const strings = promoStrings(root as Record<string, unknown>);
    for (const key of ['appliedGeneric', 'appliedWithOffer', 'blockedGeneric']) {
      expect(strings[key]).toBeTruthy();
      expect(strings[key].toLowerCase()).not.toMatch(/dias? grátis|free trial|gratis|trial/i);
    }
  });

  it('FASE 6.5: the promo card copy is i18n-ized (no hardcoded PT strings) — code, label, placeholder, and apply/applied/blocked text all come from t(...)', () => {
    for (const forbidden of [
      "'CÓDIGO PROMOCIONAL'",
      '"Ex.: ARNALDO"',
      "'Código aplicado.'",
      "'Código aplicado. Oferta promocional disponível.'",
      "'Não foi possível disponibilizar esta oferta promocional",
    ]) {
      expect(PAYWALL_CODE).not.toContain(forbidden);
    }
    for (const key of [
      "t('paywall.promo.label')",
      "t('paywall.promo.placeholder')",
      "t('paywall.promo.applyButton')",
      "t('paywall.promo.appliedGeneric')",
      "t('paywall.promo.appliedWithOffer')",
      "t('paywall.promo.blockedGeneric')",
    ]) {
      expect(PAYWALL_CODE).toContain(key);
    }
  });
});

describe('FASE 6.4 — real price only, never a computed discount (rule 8)', () => {
  it('packagePriceString never performs arithmetic on a price (no * or / against a numeric literal near "price")', () => {
    const fn = SUBSCRIPTION_OFFER_CODE.slice(
      SUBSCRIPTION_OFFER_CODE.indexOf('export function packagePriceString'),
    );
    const body = fn.slice(0, fn.indexOf('\n}') + 2);
    expect(body).not.toMatch(/\*\s*0\.\d/);
    expect(body).toContain('fullPricePhase');
    expect(body).toContain('product.priceString');
  });

  it('no hardcoded price literals in production purchase/display logic', () => {
    for (const forbidden of ['R$ 39,90', 'R$ 24,90', '9.99', '29.90', '39.90']) {
      expect(PAYWALL_CODE).not.toContain(forbidden);
      expect(SUBSCRIPTION_OFFER_CODE).not.toContain(forbidden);
    }
  });
});
