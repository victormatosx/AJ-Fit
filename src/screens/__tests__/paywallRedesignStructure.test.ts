import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source-inspection suite (no React renderer in this Node-only vitest
 * config — same constraint documented in `paywallDevOverride.test.ts`/
 * `paywallAndroidPromoWiring.test.ts`). Covers the compact UI/UX redesign
 * that follows the reference composition's density/hierarchy much more
 * closely: full-width photo-strip hero with overlaid controls/headline →
 * compact plan rows →
 * compact promo code → CTA visible without excessive scroll → legal
 * disclosure/links. Every commercial code path stays untouched —
 * RevenueCat offerings/purchase/restore/promo/entitlement logic lives in
 * `src/lib/subscriptionOffer.ts` and `handlePurchase`/`handleRestore`,
 * neither of which this redesign pass touches.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const PAYWALL_SOURCE = readFileSync('src/screens/PaywallScreen.tsx', 'utf8');
const PAYWALL_CODE = stripComments(PAYWALL_SOURCE);

function loadCommon(lang: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`src/i18n/resources/${lang}/common.json`, 'utf8'));
}

const PT = loadCommon('pt-BR');
const EN = loadCommon('en');
const ES = loadCommon('es');

function leaf(root: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, root);
}

describe('Paywall redesign — plan rendering, selection and real pricing', () => {
  it('centers the plan selector prompt above the cards', () => {
    const promptStart = PAYWALL_CODE.indexOf("{t('paywall.plans.selectorPrompt')}");
    const promptBlock = PAYWALL_CODE.slice(Math.max(0, promptStart - 180), promptStart);
    expect(promptBlock).toContain("textAlign: 'center'");
  });

  it('renders the selector prompt fully white, with no accent highlight', () => {
    const promptStart = PAYWALL_CODE.indexOf("{t('paywall.plans.selectorPrompt')}");
    const promptBlock = PAYWALL_CODE.slice(Math.max(0, promptStart - 180), promptStart);
    expect(promptBlock).toContain('color="#FFFFFF"');
    expect(PAYWALL_CODE).not.toContain('PlanSelectorTitle');
  });

  it('still renders every offering package via PackageCard, keyed by identifier, with selection wired to setSelectedId', () => {
    expect(PAYWALL_CODE).toContain('packages.map((pkg) => {');
    expect(PAYWALL_CODE).toContain('key={pkg.identifier}');
    expect(PAYWALL_CODE).not.toContain('position={index + 1}');
    expect(PAYWALL_CODE).toContain("selected={pkg.identifier === selectedPackage?.identifier}");
    expect(PAYWALL_CODE).toContain('onSelect={() => setSelectedId(pkg.identifier)}');
  });

  it('PackageCard still displays the real store price via packagePriceString, never a literal', () => {
    expect(PAYWALL_CODE).toContain('{packagePriceString(pkg)}');
  });

  it('shows the seven-day title on every plan with a Store-confirmed eligible iOS trial and colors the free word blue', () => {
    expect(PAYWALL_CODE).toContain("trialDuration?.unit === 'day'");
    expect(PAYWALL_CODE).toContain('trialDuration.count === 7');
    expect(PAYWALL_CODE).toContain("t('paywall.plans.trialTitle', { plan: packageTitle(pkg) })");
    expect(PAYWALL_CODE).toContain('<PlanCardTitle title={title} accentColor={theme.colors.primaryEmphasis} />');
    expect(leaf(PT, 'paywall.plans.trialTitle')).toBe('7 dias grátis + {{plan}}');
  });

  it('no hardcoded currency/price literal exists anywhere in the screen', () => {
    for (const forbidden of ['R$ 39,90', 'R$ 24,90', 'R$ 799,90', 'R$ 99,90', '9.99', '35.99']) {
      expect(PAYWALL_CODE).not.toContain(forbidden);
    }
  });

  it('the price is never repeated inside the same plan row — the secondary offerLine never contains packagePriceString/renewalPriceString output', () => {
    const fnStart = PAYWALL_CODE.indexOf('function PackageCard({');
    const fnEnd = PAYWALL_CODE.indexOf('\nfunction ', fnStart + 10);
    const fnBody = PAYWALL_CODE.slice(fnStart, fnEnd);
    // packagePriceString(pkg) must appear exactly once inside PackageCard's own render.
    expect(fnBody.match(/packagePriceString\(pkg\)/g)?.length).toBe(1);
  });

  it('PackageCard is a compact row (well under the old ~110px+ card height) with a single secondary offer line', () => {
    const fnStart = PAYWALL_CODE.indexOf('function PackageCard({');
    const fnEnd = PAYWALL_CODE.indexOf('\nfunction ', fnStart + 10);
    const fnBody = PAYWALL_CODE.slice(fnStart, fnEnd);
    expect(fnBody).toContain('minHeight: 70,');
    expect(fnBody).toContain('offerLine');
    expect(fnBody).toContain('numberOfLines={2}');
    expect(fnBody).not.toContain('promotionalTerms');
  });

  it('uses the AJ Fit card language: balanced corners, mono slash, readable title and circular selector', () => {
    const fnStart = PAYWALL_CODE.indexOf('function PackageCard({');
    const fnEnd = PAYWALL_CODE.indexOf('\nfunction ', fnStart + 10);
    const body = PAYWALL_CODE.slice(fnStart, fnEnd);
    expect(body).toContain('borderRadius: 10,');
    expect(body).toContain('letterSpacing: -1.2,');
    expect(body).toContain('fontFamily: theme.fonts.uiBold,');
    expect(body).toContain('borderRadius: 9,');
    expect(body).not.toContain('position');
    expect(body).not.toContain('<Display');
  });
});

describe('Paywall redesign — plan offer line: post-trial cadence, never a duplicated price', () => {
  it('confirmed/potential trial plans use the concise post-trial cadence without repeating duration or price', () => {
    const start = PAYWALL_CODE.indexOf('const offerLine =');
    const end = PAYWALL_CODE.indexOf('return (\n                  <PackageCard', start);
    const body = PAYWALL_CODE.slice(start, end);
    expect(body).toContain("t('paywall.trial.afterTrial'");
    expect(body).not.toContain('renewalPriceString');
    expect(body).not.toContain('formatIntroDuration');
    expect(body).toContain('packagePeriodLabel(pkg)');
    expect(body).toContain("resolveAndroidTrialSignal(pkg) === 'possible'");
    expect(leaf(PT, 'paywall.trial.afterTrial')).toBe(
      'Será cobrado apenas após o período gratuito.',
    );
  });
});

describe('Paywall redesign — CTA always acts on the currently selected plan', () => {
  it('the single primary CTA calls handlePurchase, which only ever acts on effectiveRoute (derived from selectedPackage)', () => {
    expect(PAYWALL_CODE).toContain('<CtaButton');
    expect(PAYWALL_CODE).toContain('onPress={handlePurchase}');
    expect(PAYWALL_CODE).toContain(
      "const purchaseRoute: PurchaseRoute | null = useMemo(() => {\n    if (!selectedPackage || Platform.OS !== 'android') return null;",
    );
    expect(PAYWALL_CODE).toContain(
      "const standardIOSRoute: PurchaseRoute | null = useMemo(() => {\n    if (!selectedPackage || Platform.OS !== 'ios') return null;",
    );
  });

  it('renders exactly one CtaButton (primary) — no competing purchase actions', () => {
    expect(PAYWALL_CODE.match(/<CtaButton\b/g)?.length).toBe(1);
  });

  it('CTA label comes from the shared i18n action set, not a hardcoded string', () => {
    expect(PAYWALL_CODE).toContain("<CtaText>{t('actions.continue')}</CtaText>");
    expect(PAYWALL_CODE).not.toMatch(/<CtaText>Continuar<\/CtaText>/);
    expect(leaf(PT, 'actions.continue')).toBe('Continuar');
    expect(leaf(EN, 'actions.continue')).toBe('Continue');
    expect(leaf(ES, 'actions.continue')).toBe('Continuar');
  });

  it('the CTA container sits right after the promo/notices block (no large forced empty space above it)', () => {
    const idx = PAYWALL_CODE.indexOf("<View style={{ marginTop: 'auto', paddingTop: 14 }}>");
    expect(idx).toBeGreaterThan(-1);
  });
});

describe('Paywall redesign — restore moved to a discreet header action, same handleRestore', () => {
  it('PaywallHeader receives onRestore/isRestoring wired to the same handleRestore/restoreState used everywhere else', () => {
    expect(PAYWALL_CODE).toContain('onRestore={handleRestore}');
    expect(PAYWALL_CODE).toContain('isRestoring={isRestoring}');
  });

  it('no standalone large "restore purchases" CtaButton remains — restore is header-only now', () => {
    expect(PAYWALL_CODE).not.toContain('function RestoreButton(');
    expect(PAYWALL_CODE).not.toMatch(/<CtaButton ghost onPress=\{onPress\}/);
  });

  it('the header restore control is i18n-driven and carries an accessibility label', () => {
    expect(PAYWALL_CODE).toContain("t('paywall.header.restore')");
    expect(PAYWALL_CODE).toContain("t('paywall.header.restoreAccessibilityLabel')");
    for (const root of [PT, EN, ES]) {
      expect(typeof leaf(root, 'paywall.header.restore')).toBe('string');
      expect(leaf(root, 'paywall.header.restore')).not.toBe('');
      expect(typeof leaf(root, 'paywall.header.restoreAccessibilityLabel')).toBe('string');
    }
  });
});

describe('Paywall redesign — promo code card unchanged (existing validation/loading/error logic), just visually compact', () => {
  it('still renders PromoCodeCard gated by PROMO_CODE_SUPPORTED_PLATFORM, wired to the same handlers/state', () => {
    expect(PAYWALL_CODE).toContain('{PROMO_CODE_SUPPORTED_PLATFORM && (');
    expect(PAYWALL_CODE).toContain('<PromoCodeCard');
    expect(PAYWALL_CODE).toContain('onApply={handleApplyPromoCode}');
    expect(PAYWALL_CODE).toContain('promoState={promoState}');
    expect(PAYWALL_CODE).toContain('purchaseRoute={effectiveRoute}');
  });

  it('the promo input/apply row height was reduced from the original 46 to a more compact 42', () => {
    const start = PAYWALL_CODE.indexOf('function PromoCodeCard({');
    const body = PAYWALL_CODE.slice(start, PAYWALL_CODE.indexOf('\nfunction ', start + 10));
    expect(body).toContain('height: 42,');
    expect(body).not.toContain('height: 46,');
  });
});

describe('Paywall redesign — loading/error/offline/empty states preserved', () => {
  it('CenteredState still covers every offeringViewState kind and legal/notices remain reachable from it', () => {
    for (const kind of ['loading', 'offline', 'error', 'empty', 'unavailable']) {
      expect(PAYWALL_CODE).toContain(`${kind}:`);
    }
    expect(PAYWALL_CODE).toContain("if (centerState === 'loading') return <FullScreenLoading />;");
  });

  it('purchase/restore ActionNotices are still rendered in both the centered-state and ready-state branches', () => {
    const occurrences = PAYWALL_CODE.match(
      /<ActionNotices purchaseState=\{purchaseState\} restoreState=\{restoreState\} \/>/g,
    );
    expect(occurrences?.length).toBe(2);
  });
});

describe('Paywall redesign — trial information remains driven by real Store eligibility', () => {
  it('trialHighlight is derived only from selectedIntroPresentation (iOS) and resolveAndroidTrialSignal (Android) — no other eligibility source', () => {
    const start = PAYWALL_CODE.indexOf('const trialHighlight = useMemo');
    const end = PAYWALL_CODE.indexOf('}, [selectedIntroPresentation, selectedPackage]);', start);
    expect(start).toBeGreaterThan(-1);
    const body = PAYWALL_CODE.slice(start, end);
    expect(body).toContain("selectedIntroPresentation?.kind === 'free_trial'");
    expect(body).toContain('resolveAndroidTrialSignal(selectedPackage)');
    expect(body).not.toContain('promoApplied');
    expect(body).not.toContain('promoState');
  });

  it('the hero headline is fixed to the plan-ready message and never replaced by trial duration', () => {
    const start = PAYWALL_CODE.indexOf('function PaywallHeroVisual({');
    const end = PAYWALL_CODE.indexOf('\nfunction ', start + 10);
    const body = PAYWALL_CODE.slice(start, end);
    expect(body).toContain("t('paywall.hero.title')");
    expect(body).not.toContain("t('paywall.trial.title'");
  });

  it("Android's non-committal 'possible' status still never claims a guaranteed trial", () => {
    expect(PAYWALL_CODE).toContain("kind: 'android_possible'");
    expect(PAYWALL_CODE).toContain("t('paywall.trial.androidConditionalTitle'");
    expect(PAYWALL_CODE).toContain("t('paywall.legal.androidTrialDisclosure')");
    for (const root of [PT, EN, ES]) {
      const title = String(leaf(root, 'paywall.trial.androidConditionalTitle'));
      // "até/up to/hasta" — explicitly conditional, never a guarantee.
      expect(title.toLowerCase()).toMatch(/até|up to|hasta/);
    }
  });

  it('iOS strong trial marketing is reachable only from a confirmed free_trial presentation', () => {
    const start = PAYWALL_CODE.indexOf('const trialHighlight = useMemo');
    const end = PAYWALL_CODE.indexOf('}, [selectedIntroPresentation, selectedPackage]);', start);
    const body = PAYWALL_CODE.slice(start, end);
    expect(body).toContain("Platform.OS === 'ios'");
    expect(body).toContain("selectedIntroPresentation?.kind === 'free_trial'");
    expect(body).toContain("kind: 'ios_confirmed'");
    expect(body).not.toContain("kind === 'standard'");
    expect(body).not.toContain("status === 'checking'");
  });

  it('Android strong marketing stays possible/conditional and reads duration from the Store free phase', () => {
    expect(PAYWALL_CODE).toContain("resolveAndroidTrialSignal(selectedPackage) === 'possible'");
    expect(PAYWALL_CODE).toContain("kind: 'android_possible'");
    expect(PAYWALL_CODE).toContain('phase.billingPeriod.unit');
    expect(PAYWALL_CODE).toContain('phase.billingPeriod.value');
    expect(PAYWALL_CODE).not.toMatch(/duration:\s*\{\s*count:\s*7/);
  });

  it('places trial copy directly under the hero headline in the same display font at a smaller size', () => {
    const start = PAYWALL_CODE.indexOf('function PaywallHeroVisual({');
    const end = PAYWALL_CODE.indexOf('\nfunction ', start + 10);
    const body = PAYWALL_CODE.slice(start, end);
    expect(body).toContain('<Display size={30}');
    expect(body).toContain('<Display size={18}');
    expect(body).toContain('<TrialHeroTitle');
    expect(PAYWALL_CODE).not.toContain('function TrialHighlight(');
    expect(leaf(PT, 'paywall.trial.confirmedTitle')).toBe(
      'Experimente por {{duration}} grátis',
    );
  });

  it('an ineligible/checking/no-offer iOS presentation or a `none` Android signal falls through to `null`', () => {
    const start = PAYWALL_CODE.indexOf('const trialHighlight = useMemo');
    const end = PAYWALL_CODE.indexOf('}, [selectedIntroPresentation, selectedPackage]);', start);
    const body = PAYWALL_CODE.slice(start, end);
    expect(body).toContain('return null;');
    expect(PAYWALL_CODE).toContain("t('paywall.hero.title')");
  });

  it('never hardcodes "7 dias"/"7 days" as an unconditional claim in the headline copy', () => {
    expect(PAYWALL_CODE).not.toMatch(/>\s*7\s*(dias|days|días)\s*grátis/i);
  });

  it('the marketing paragraph below the headline was removed — no more restating price/period text there (info now lives only on the plan row)', () => {
    expect(PAYWALL_CODE).not.toContain("t('paywall.trial.body'");
    expect(PAYWALL_CODE).not.toContain("t('paywall.trial.androidBody'");
  });
});

describe('Paywall redesign — legal disclosure and links', () => {
  it('renders a renewal/auto-charge disclosure and keeps the privacy/terms links reachable', () => {
    expect(PAYWALL_CODE).toContain("t('paywall.legal.renewalDisclosure')");
    expect(PAYWALL_CODE).toContain('<LegalLinks onOpen={setLegalDocument} />');
    for (const root of [PT, EN, ES]) {
      const disclosure = String(leaf(root, 'paywall.legal.renewalDisclosure'));
      expect(disclosure.length).toBeGreaterThan(20);
    }
  });

  it('adds the Google Play eligibility disclosure only beside legal copy for Android possible', () => {
    expect(PAYWALL_CODE).toContain("trialHighlight?.kind === 'android_possible'");
    expect(PAYWALL_CODE).toContain("t('paywall.legal.androidTrialDisclosure')");
    for (const root of [PT, EN, ES]) {
      const disclosure = String(leaf(root, 'paywall.legal.androidTrialDisclosure'));
      expect(disclosure.length).toBeGreaterThan(80);
    }
  });

  it('LegalLinks still opens the same privacy/terms document kinds via the existing modal', () => {
    expect(PAYWALL_CODE).toContain("onPress={() => onOpen('privacy')}");
    expect(PAYWALL_CODE).toContain("onPress={() => onOpen('terms')}");
    expect(PAYWALL_CODE).toContain('<LegalDocumentModal document={legalDocument} onClose={() => setLegalDocument(null)} />');
  });
});

describe('Paywall redesign — i18n coverage for new copy, no new hardcoded strings', () => {
  const NEW_KEYS = [
    'paywall.header.restore',
    'paywall.header.restoreAccessibilityLabel',
    'paywall.hero.eyebrow',
    'paywall.hero.title',
    'paywall.hero.imageAccessibilityLabel',
    'paywall.trial.title',
    'paywall.trial.subtitle',
    'paywall.trial.checking',
    'paywall.trial.androidTitle',
    'paywall.trial.compactBadge',
    'paywall.trial.confirmedTitle',
    'paywall.trial.androidConditionalTitle',
    'paywall.trial.androidConditionalTitleGeneric',
    'paywall.trial.afterTrial',
    'paywall.plans.title',
    'paywall.plans.selectorPrompt',
    'paywall.plans.introAfterTrial',
    'paywall.plans.subtitleDefault',
    'paywall.plans.subtitlePlanCompleted',
    'paywall.plans.cadence.monthly',
    'paywall.plans.cadence.annual',
    'paywall.legal.renewalDisclosure',
    'paywall.legal.androidTrialDisclosure',
  ];

  it.each(NEW_KEYS)('%s exists as a non-empty string in pt-BR, en and es', (key) => {
    for (const root of [PT, EN, ES]) {
      const value = leaf(root, key);
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    }
  });

  it('the removed trial.body/androidBody keys are no longer present (dead copy cleaned up, not left orphaned)', () => {
    for (const root of [PT, EN, ES]) {
      expect(leaf(root, 'paywall.trial.body')).toBeUndefined();
      expect(leaf(root, 'paywall.trial.androidBody')).toBeUndefined();
    }
  });

  it('the eyebrow/headline no longer hardcode "AJ FIT PREMIUM"/"Escolha seu plano" as bare JSX text', () => {
    expect(PAYWALL_CODE).not.toMatch(/>AJ FIT PREMIUM</);
    expect(PAYWALL_CODE).not.toMatch(/>Escolha seu plano</);
    expect(PAYWALL_CODE).toContain("t('paywall.hero.eyebrow')");
  });

  it('entryContext-driven plan intro stays copy-only and goes through i18n', () => {
    expect(PAYWALL_CODE).toContain("entryContext?.origin === 'planCompleted'");
    expect(PAYWALL_CODE).toContain("t('paywall.plans.subtitlePlanCompleted')");
    expect(PAYWALL_CODE).toContain("t('paywall.plans.subtitleDefault')");
    expect(PAYWALL_CODE).toContain("t('paywall.plans.selectorPrompt')");
    expect(leaf(PT, 'paywall.plans.selectorPrompt')).toBe(
      'Escolha seu plano ideal',
    );
    expect(PAYWALL_CODE).toContain('<Display\n              size={17}');
  });

  it('colors and uppercases only the localized free word with the AJ Fit blue emphasis', () => {
    const start = PAYWALL_CODE.indexOf('function TrialHeroTitle(');
    const end = PAYWALL_CODE.indexOf('\nfunction ', start + 10);
    const body = PAYWALL_CODE.slice(start, end);
    expect(body).toContain('/grátis|gratis|free/i');
    expect(body).toContain("color: accentColor, textTransform: 'uppercase'");
    expect(PAYWALL_CODE).toContain('accentColor={theme.colors.primaryEmphasis}');
  });

});

describe('Paywall redesign — edge-to-edge static image hero', () => {
  it('uses the requested bundled paywall assets (no remote image)', () => {
    expect(PAYWALL_CODE).toContain("require('../../assets/paywall/paywall-asset.webp')");
    expect(PAYWALL_CODE).not.toContain("require('../../assets/antes-depois/");
    expect(PAYWALL_CODE).not.toMatch(/https?:\/\/.*\.(png|jpe?g|webp)/i);
  });

  it('picks the hero image from the questionnaire sex answer, defaulting to the neutral asset', () => {
    expect(PAYWALL_CODE).toContain("require('../../assets/paywall/paywall-asset-mas.webp')");
    expect(PAYWALL_CODE).toContain("require('../../assets/paywall/paywall-asset-fem.webp')");
    const start = PAYWALL_CODE.indexOf('function resolvePaywallHeroImage(');
    const end = PAYWALL_CODE.indexOf('\n}', start);
    const body = PAYWALL_CODE.slice(start, end);
    expect(body).toContain("sex === 'm'");
    expect(body).toContain("sex === 'f'");
    expect(body).toContain('PAYWALL_HERO_IMAGE_DEFAULT');
    expect(PAYWALL_CODE).toContain('resolvePaywallHeroImage(questionnaire?.answers.sex)');
  });

  it('the imagery is accessible and decorative layers do not intercept touches', () => {
    expect(PAYWALL_CODE).toContain('accessibilityLabel={t(\'paywall.hero.imageAccessibilityLabel\')}');
    expect(PAYWALL_CODE).toContain('pointerEvents="none"');
  });

  it('renders the single image with edge-to-edge cover and no card treatment', () => {
    const start = PAYWALL_CODE.indexOf('function PaywallHeroVisual()');
    const resolvedStart = start === -1 ? PAYWALL_CODE.indexOf('function PaywallHeroVisual({') : start;
    const end = PAYWALL_CODE.indexOf('\nfunction ', resolvedStart + 10);
    const body = PAYWALL_CODE.slice(resolvedStart, end);
    expect(body).toContain('source={heroImage}');
    expect(body).toContain('resizeMode="cover"');
    expect(body).not.toContain('rotate:');
    expect(body).not.toContain('borderColor: theme.colors.cardBorder');
  });

  it('uses a responsive ~32% viewport height clamped for small and large phones', () => {
    const start = PAYWALL_CODE.indexOf('function PaywallHeroVisual({');
    const end = PAYWALL_CODE.indexOf('\nfunction ', start + 10);
    const body = PAYWALL_CODE.slice(start, end);
    expect(body).toContain('Math.min(310, Math.max(240, height * 0.32))');
  });

  it('overlays close, restore, eyebrow and headline inside the hero and blends into the screen background', () => {
    const start = PAYWALL_CODE.indexOf('function PaywallHeroVisual({');
    const end = PAYWALL_CODE.indexOf('\nfunction ', start + 10);
    const body = PAYWALL_CODE.slice(start, end);
    expect(body).toContain('<PaywallHeader');
    expect(body).toContain('overlay');
    expect(body).toContain("t('paywall.hero.eyebrow')");
    expect(body).toContain("t('paywall.hero.title')");
    expect(body).toContain('theme.colors.background,');
    expect(body).toContain('locations={[0, 0.28, 0.58, 0.82, 1]}');
  });
});
