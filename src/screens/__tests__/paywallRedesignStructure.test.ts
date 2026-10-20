import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source-inspection suite (no React renderer in this Node-only vitest
 * config — same constraint documented in `paywallDevOverride.test.ts`/
 * `paywallAndroidPromoWiring.test.ts`).
 *
 * ## What changed, and why this file changed with it
 *
 * This suite used to lock the *previous* compact redesign: a full-width
 * photo-strip hero with overlaid controls, a display headline inside it,
 * compact plan rows, a header-mounted restore action. The approved
 * acquisition design replaces that composition entirely — AJ stands where the
 * photo was, the commercial content lives in a bottom sheet, the period
 * selector is a segmented control when the offering has exactly two packages,
 * and restore joins terms/privacy in the footer link row.
 *
 * Every assertion below falls into one of two groups, and the distinction is
 * the whole point of this rewrite:
 *
 * - **Commercial and logic guarantees** — real prices only, trial claims only
 *   from confirmed Store eligibility, one purchase action, `handlePurchase`
 *   acting on `effectiveRoute`, promo wiring, restore wiring, every offering
 *   state still reachable, legal disclosure present. These are carried over
 *   verbatim, and several are now checked more tightly than before.
 * - **Composition of the superseded design** — gradient stops, hero height,
 *   `<Display size={30}>`, row `minHeight`, corner radii. These describe a
 *   screen that no longer exists; they are re-pointed at the new composition
 *   rather than deleted, so the new one is locked just as the old one was.
 *
 * No commercial code path moved: RevenueCat offerings/purchase/restore/promo/
 * entitlement logic lives in `src/lib/subscriptionOffer.ts` and
 * `handlePurchase`/`handleRestore`, none of which this redesign touches.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const PAYWALL_SOURCE = readFileSync('src/screens/PaywallScreen.tsx', 'utf8');
const PAYWALL_CODE = stripComments(PAYWALL_SOURCE);
const HERO_IMAGE_CODE = stripComments(
  readFileSync('src/screens/paywall/paywallHeroImage.ts', 'utf8'),
);
const STORE_PRICE_PARTS_CODE = stripComments(
  readFileSync('src/screens/paywall/storePriceParts.ts', 'utf8'),
);

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
  it('uses the segmented selector only for a two-package offering, and the card list otherwise', () => {
    // The design describes the segmented control for exactly two packages;
    // any other count keeps the vertical list, so a three-package offering
    // can never be silently truncated to fit a two-slot control.
    expect(PAYWALL_CODE).toContain('const useSegmentedSelector = packages.length === 2;');
    expect(PAYWALL_CODE).toContain('{useSegmentedSelector ? (');
    expect(PAYWALL_CODE).toContain('<AqSegmented');
    expect(PAYWALL_CODE).toContain('<PackageCard');
  });

  it('keeps the plan selector prompt as i18n copy, now labelling the selector for assistive tech', () => {
    expect(PAYWALL_CODE).toContain("accessibilityLabel={t('paywall.plans.selectorPrompt')}");
    expect(PAYWALL_CODE).not.toContain('PlanSelectorTitle');
    expect(leaf(PT, 'paywall.plans.selectorPrompt')).toBe('Escolha seu plano ideal');
  });

  it('still renders every offering package, keyed by identifier, with selection wired to setSelectedId', () => {
    // Both branches must map over the real `packages` and write the real
    // selection state — neither may invent an ordering or a default.
    expect(PAYWALL_CODE).toContain('packages.map((pkg) => {');
    expect(PAYWALL_CODE).toContain('packages.map((pkg) => ({');
    expect(PAYWALL_CODE).toContain('key={pkg.identifier}');
    expect(PAYWALL_CODE).not.toContain('position={index + 1}');
    expect(PAYWALL_CODE).toContain("selected={pkg.identifier === selectedPackage?.identifier}");
    expect(PAYWALL_CODE).toContain('onSelect={() => setSelectedId(pkg.identifier)}');
    expect(PAYWALL_CODE).toContain('onSelect={(identifier) => setSelectedId(identifier)}');
  });

  it('PackageCard still displays the real store price via packagePriceString, never a literal', () => {
    expect(PAYWALL_CODE).toContain('{packagePriceString(pkg)}');
  });

  it('the headline price is a store string, never recomputed — and its typesetting is provably lossless', () => {
    // `pricePerMonthString` when RevenueCat supplies it, the package's own
    // `priceString` otherwise.
    expect(PAYWALL_CODE).toContain(
      'selectedPackage.product.pricePerMonthString ?? selectedPackage.product.priceString',
    );
    // The design sets the whole units at 50 and the fraction at 19, which
    // needs the formatted price in pieces. The guarantee that replaced
    // "never split" is stricter than a blanket ban and is enforced in code,
    // not only here: `splitStorePrice` returns substrings of the original
    // and refuses unless they reassemble into it character for character,
    // so a locale whose separator, symbol position or fraction length this
    // does not recognise falls through to the whole string instead of
    // rendering a wrong price. `storePricePartsParsing.test.ts` exercises
    // that behaviour against real store formats.
    expect(PAYWALL_CODE).toContain(
      "import { splitStorePrice } from './paywall/storePriceParts';",
    );
    expect(STORE_PRICE_PARTS_CODE).toContain(
      'if (`${prefix}${whole}${separator}${fraction}${suffix}` !== trimmed) return null;',
    );
    expect(PAYWALL_CODE).toContain('const parts = splitStorePrice(price);');
    // The fallback branch renders the untouched string.
    expect(PAYWALL_CODE).toContain('{price}');
    // Still no arithmetic or digit-stripping on a price anywhere.
    expect(PAYWALL_CODE).not.toMatch(/\.split\(['"][.,]['"]\)/);
    expect(PAYWALL_CODE).not.toMatch(/replace\(\/\[\^0-9\]/);
    expect(PAYWALL_CODE).not.toMatch(/parseFloat\(|Number\(.*price/i);
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

  it('the discount badge is fixed copy on the longer period, never a figure computed in code', () => {
    // The design seals the longer period with "-X%". The product owner
    // directed (2026-10-17) that the plan prices are fixed and the seal is
    // to be reproduced as copy, so the percentage lives in i18n as a fixed
    // string on the ANNUAL package only.
    //
    // What this still guards is the thing that was always the real risk: no
    // discount is CALCULATED here. A percentage derived in the screen would
    // drift silently the day a store price changes and nobody noticed; a
    // fixed string is at least visible in the translation files, where a
    // price change is a copy change like any other.
    expect(PAYWALL_CODE).toContain("badge: pkg.packageType === 'ANNUAL'");
    expect(PAYWALL_CODE).toContain("t('paywall.plans.annualDiscountBadge')");
    expect(PAYWALL_CODE).toContain('badgeVariant="chip"');
    // No arithmetic over prices anywhere in the screen.
    expect(PAYWALL_CODE).not.toMatch(/price\w*\s*[*/]\s*\d/i);
    expect(PAYWALL_CODE).not.toMatch(/\d+\s*-\s*\w*[Pp]rice/);
    for (const root of [PT, EN, ES]) {
      expect(String(leaf(root, 'paywall.plans.annualDiscountBadge'))).toMatch(/^-\d+%$/);
    }
  });

  it('the price is never repeated inside the same plan row — the secondary offerLine never contains packagePriceString/renewalPriceString output', () => {
    const fnStart = PAYWALL_CODE.indexOf('function PackageCard({');
    const fnEnd = PAYWALL_CODE.indexOf('\nfunction ', fnStart + 10);
    const fnBody = PAYWALL_CODE.slice(fnStart, fnEnd);
    // packagePriceString(pkg) must appear exactly once inside PackageCard's own render.
    expect(fnBody.match(/packagePriceString\(pkg\)/g)?.length).toBe(1);
  });

  it('PackageCard is a compact row with a single secondary offer line', () => {
    const fnStart = PAYWALL_CODE.indexOf('function PackageCard({');
    const fnEnd = PAYWALL_CODE.indexOf('\nfunction ', fnStart + 10);
    const fnBody = PAYWALL_CODE.slice(fnStart, fnEnd);
    expect(fnBody).toContain('minHeight: 70,');
    expect(fnBody).toContain('offerLine');
    expect(fnBody).toContain('numberOfLines={2}');
    expect(fnBody).not.toContain('promotionalTerms');
  });
});

describe('Paywall redesign — plan offer line: post-trial cadence, never a duplicated price', () => {
  it('confirmed/potential trial plans use the concise post-trial cadence without repeating duration or price', () => {
    const start = PAYWALL_CODE.indexOf('const offerLine =');
    const end = PAYWALL_CODE.indexOf('return (\n                      <PackageCard', start);
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
    expect(PAYWALL_CODE).toContain('<AqPrimaryButton');
    expect(PAYWALL_CODE).toContain('onPress={handlePurchase}');
    expect(PAYWALL_CODE).toContain(
      "const purchaseRoute: PurchaseRoute | null = useMemo(() => {\n    if (!selectedPackage || Platform.OS !== 'android') return null;",
    );
    expect(PAYWALL_CODE).toContain(
      "const standardIOSRoute: PurchaseRoute | null = useMemo(() => {\n    if (!selectedPackage || Platform.OS !== 'ios') return null;",
    );
  });

  it('renders exactly one purchase button — no competing purchase actions', () => {
    expect(PAYWALL_CODE.match(/<AqPrimaryButton\b/g)?.length).toBe(1);
    // The app-wide gradient CTA is deliberately not reused here (see
    // `AcquisitionControls`), so its reappearance would be a regression.
    expect(PAYWALL_CODE).not.toContain('<CtaButton');
  });

  it("the CTA's disabled expression still comes from the route, never from presentation state", () => {
    const start = PAYWALL_CODE.indexOf('<AqPrimaryButton');
    const body = PAYWALL_CODE.slice(start, start + 1200);
    expect(body).toContain('busy ||');
    expect(body).toContain('!effectiveRoute ||');
    expect(body).toContain("effectiveRoute.kind === 'blocked' ||");
    expect(body).toContain(
      "(effectiveRoute.kind === 'ios_promo_package' &&\n                    selectedIntroReadiness.status !== 'ready')",
    );
  });

  it('CTA label comes from i18n, and promises the trial through the single presented-duration value', () => {
    // `presentedTrialDuration` is the one place that decides whether this
    // screen is talking about a trial at all — Store-confirmed duration when
    // StoreKit supplies one, the fixed offer duration otherwise, and `null`
    // on Android unless its own signal says otherwise. The CTA reads it
    // rather than re-deciding, so it can never promise a trial the rest of
    // the sheet is not also showing.
    expect(PAYWALL_CODE).toContain(
      "const presentedTrialDuration =\n    trialDurationLabel ??\n    (Platform.OS === 'android' ? null : t('paywall.sheet.fixedTrialDuration'));",
    );
    expect(PAYWALL_CODE).toContain(
      "const purchaseLabel = presentedTrialDuration\n    ? t('paywall.sheet.startTrial', { duration: presentedTrialDuration })\n    : t('actions.continue');",
    );
    expect(PAYWALL_CODE).not.toMatch(/label="[^"]*[Cc]ontinuar/);
    expect(leaf(PT, 'actions.continue')).toBe('Continuar');
    expect(leaf(EN, 'actions.continue')).toBe('Continue');
    expect(leaf(ES, 'actions.continue')).toBe('Continuar');
    for (const root of [PT, EN, ES]) {
      expect(typeof leaf(root, 'paywall.sheet.startTrial')).toBe('string');
    }
  });

  it('the "free today" sub-label appears only for a Store-confirmed zero introductory price', () => {
    expect(PAYWALL_CODE).toContain(
      "const zeroCostTodayString = selectedIntroPresentation?.kind === 'free_trial'\n    && selectedIntroPresentation.terms.introductoryPrice === 0\n    ? selectedIntroPresentation.terms.introductoryPriceString\n    : null;",
    );
    expect(PAYWALL_CODE).toContain(
      "t('paywall.sheet.startTrialToday', { price: zeroCostTodayString })",
    );
  });

  it('the CTA sits inside the sheet content with no forced empty space above it', () => {
    expect(PAYWALL_CODE).not.toContain("marginTop: 'auto'");
  });
});

describe('Paywall redesign — restore is a footer link action, same handleRestore', () => {
  it('LegalLinks receives onRestore/isRestoring wired to the same handleRestore/restoreState used everywhere else', () => {
    expect(PAYWALL_CODE).toContain('onRestore={handleRestore}');
    expect(PAYWALL_CODE).toContain('isRestoring={isRestoring}');
  });

  it('no standalone large "restore purchases" button remains', () => {
    expect(PAYWALL_CODE).not.toContain('function RestoreButton(');
    expect(PAYWALL_CODE).not.toMatch(/<CtaButton ghost onPress=\{onPress\}/);
  });

  it('the restore control is i18n-driven, carries an accessibility label, and lives in the link row', () => {
    const start = PAYWALL_CODE.indexOf('function LegalLinks({');
    const end = PAYWALL_CODE.indexOf('\nfunction ', start + 10);
    const body = PAYWALL_CODE.slice(start, end === -1 ? undefined : end);
    expect(body).toContain("tCommon('paywall.header.restore')");
    expect(body).toContain("accessibilityLabel={tCommon('paywall.header.restoreAccessibilityLabel')}");
    for (const root of [PT, EN, ES]) {
      expect(typeof leaf(root, 'paywall.header.restore')).toBe('string');
      expect(leaf(root, 'paywall.header.restore')).not.toBe('');
      expect(typeof leaf(root, 'paywall.header.restoreAccessibilityLabel')).toBe('string');
    }
  });

  it('the close affordance is available from the first frame — never revealed on a timer', () => {
    // On the root Paywall this control is the logout path. The prototype
    // fades it in after two seconds; hiding the only exit, even briefly, is
    // a trap, so the delay is deliberately not reproduced.
    const start = PAYWALL_CODE.indexOf('function PaywallHeader({');
    const end = PAYWALL_CODE.indexOf('\nfunction ', start + 10);
    const body = PAYWALL_CODE.slice(start, end);
    expect(body).toContain('accessibilityLabel={closeAccessibilityLabel}');
    expect(body).toContain('onPress={onClose}');
    expect(body).not.toContain('setTimeout');
    expect(body).not.toContain('useEffect');
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

  it('the headline takes the two-part design form only off presentedTrialDuration, and Android keeps its hedged sentence whole', () => {
    // The approved design draws the headline in two parts — the trial phrase
    // in accent, the promise after it. The accent part is built from
    // `presentedTrialDuration` and nothing else.
    //
    // The guarantee that matters here is Android's: Google Play decides
    // eligibility per account, so its reviewed sentence carries a mandatory
    // "até/up to …*" hedge, and a two-part headline would have split or
    // reworded that hedge away. The explicit `android_possible` exclusion
    // below is what keeps that sentence whole in `headlineTail`, where
    // `TrialHeroTitle` accents the localized "free" word inside it.
    expect(PAYWALL_CODE).toContain(
      "const headlineAccent =\n    presentedTrialDuration && trialHighlight?.kind !== 'android_possible'\n      ? t('paywall.sheet.trialHeadline', { duration: presentedTrialDuration })\n      : null;",
    );
    expect(PAYWALL_CODE).toContain(
      "const headlineTail = headlineAccent\n    ? t('paywall.sheet.trialHeadlineTail')\n    : trialHeroTitle ?? t('paywall.hero.title');",
    );
    expect(PAYWALL_CODE).toContain('const trialHeroTitle = trialHighlight');
    expect(PAYWALL_CODE).toContain("t('paywall.trial.confirmedTitle'");
    expect(PAYWALL_CODE).toContain("t('paywall.trial.androidConditionalTitle'");
    expect(PAYWALL_CODE).toContain("t('paywall.trial.androidConditionalTitleGeneric')");
    // The accent phrase itself still never states a duration of its own.
    for (const root of [PT, EN, ES]) {
      expect(String(leaf(root, 'paywall.sheet.trialHeadline'))).toContain('{{duration}}');
    }
  });

  it('the fixed trial duration is copy, and Android can never reach it', () => {
    // The fallback that makes the design's headline visible without a
    // Store-confirmed offer. Fixed by instruction (2026-10-17): the AJ Fit
    // trial is a fixed 7 days. It is a translatable string, not a literal in
    // the screen, and the `Platform.OS === 'android'` guard is the whole
    // reason Google Play's eligibility rules are still respected.
    expect(PAYWALL_CODE).toContain("Platform.OS === 'android' ? null : t('paywall.sheet.fixedTrialDuration')");
    expect(PAYWALL_CODE).not.toMatch(/['"]7\s*(dias|days|días)['"]/i);
    for (const root of [PT, EN, ES]) {
      expect(String(leaf(root, 'paywall.sheet.fixedTrialDuration'))).toMatch(/7/);
    }
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

  it('keeps the accent emphasis on the localized free word in the headline', () => {
    const start = PAYWALL_CODE.indexOf('function PaywallHeadline({');
    const end = PAYWALL_CODE.indexOf('\nfunction ', start + 10);
    const body = PAYWALL_CODE.slice(start, end);
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

  it('the reassurance card carries the design copy through i18n, never a literal in the screen', () => {
    // The design's card, drawn as designed (hairline border, filled accent
    // check, bold lead clause) and carrying the design's own words. The
    // product owner approved that copy as fixed (2026-10-17): the cancel
    // terms do not vary with the store's answer, so the card is not gated
    // on one.
    //
    // What stays enforced is that the promise is COPY, reviewable and
    // translatable in the resource files, rather than a string typed into a
    // render tree where no copy review would ever see it.
    expect(PAYWALL_CODE).toContain(
      'function AssuranceCard({ lead, text }: { lead: string; text: string })',
    );
    expect(PAYWALL_CODE).toContain("lead={t('paywall.sheet.assuranceLead')}");
    expect(PAYWALL_CODE).toContain("text={t('paywall.sheet.assuranceBody')}");
    expect(PAYWALL_CODE.match(/<AssuranceCard\b/g)?.length).toBe(1);
    expect(PAYWALL_CODE).not.toMatch(/risco zero|risk free|riesgo cero/i);
    expect(PAYWALL_CODE).not.toMatch(/2\s*toques|2\s*taps/i);
    for (const root of [PT, EN, ES]) {
      expect(String(leaf(root, 'paywall.sheet.assuranceLead')).length).toBeGreaterThan(0);
      expect(String(leaf(root, 'paywall.sheet.assuranceBody')).length).toBeGreaterThan(20);
    }
    // Still no first-charge date, because none is computed today.
    expect(PAYWALL_CODE).not.toMatch(/firstChargeDate|primeira cobran[çc]a em/i);
  });

  it('the fixed commercial figures live in i18n only — no money or percentage literal in the screen', () => {
    // The fixed savings figure and the fixed "free today" line are copy, for
    // the same reason as above: a price typed into JSX is invisible to copy
    // review and to translation, and it is the thing that goes stale.
    expect(PAYWALL_CODE).toContain("t('paywall.sheet.annualSavings')");
    expect(PAYWALL_CODE).toContain("t('paywall.sheet.fixedZeroToday')");
    expect(PAYWALL_CODE).not.toMatch(/R\$\s?\d/);
    expect(PAYWALL_CODE).not.toMatch(/\d+%/);
    for (const root of [PT, EN, ES]) {
      expect(String(leaf(root, 'paywall.sheet.annualSavings'))).toMatch(/\d/);
      expect(String(leaf(root, 'paywall.sheet.fixedZeroToday'))).toMatch(/0/);
      expect(String(leaf(root, 'paywall.sheet.monthlySupporting')).length).toBeGreaterThan(0);
      expect(String(leaf(root, 'paywall.sheet.annualSupporting'))).toContain('{{price}}');
    }
  });
});

describe('Paywall redesign — legal disclosure and links', () => {
  it('renders a renewal/auto-charge disclosure and keeps the privacy/terms links reachable', () => {
    expect(PAYWALL_CODE).toContain("t('paywall.legal.renewalDisclosure')");
    expect(PAYWALL_CODE).toContain('<LegalLinks');
    expect(PAYWALL_CODE).toContain('onOpen={setLegalDocument}');
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
    'paywall.hero.title',
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
    'paywall.sheet.subtitle',
    'paywall.sheet.afterTrialLabel',
    'paywall.sheet.startTrial',
    'paywall.sheet.startTrialToday',
    'paywall.sheet.trialHeadline',
    'paywall.sheet.trialHeadlineTail',
    'paywall.sheet.perMonthSuffix',
    'paywall.plans.annualDiscountBadge',
    'paywall.sheet.fixedTrialDuration',
    'paywall.sheet.fixedZeroToday',
    'paywall.sheet.annualSupporting',
    'paywall.sheet.annualSavings',
    'paywall.sheet.monthlySupporting',
    'paywall.sheet.assuranceLead',
    'paywall.sheet.assuranceBody',
    'paywall.promo.appliedCode',
    'paywall.aj.intro',
    'paywall.aj.introWithName',
    'paywall.aj.introTrial',
    'paywall.aj.couponApplied',
    'paywall.aj.activating',
    'paywall.aj.activatingTrial',
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

  it('the headline never hardcodes "AJ FIT PREMIUM"/"Escolha seu plano" as bare JSX text', () => {
    expect(PAYWALL_CODE).not.toMatch(/>AJ FIT PREMIUM</);
    expect(PAYWALL_CODE).not.toMatch(/>Escolha seu plano</);
  });

  it('entryContext-driven plan intro stays copy-only and goes through i18n', () => {
    expect(PAYWALL_CODE).toContain("entryContext?.origin === 'planCompleted'");
    expect(PAYWALL_CODE).toContain("t('paywall.plans.subtitlePlanCompleted')");
    expect(PAYWALL_CODE).toContain("t('paywall.sheet.subtitle')");
    // AJ addresses the user by the funnel-provided name and nothing else.
    expect(PAYWALL_CODE).toContain('const entryName = entryContext?.name ?? null;');
    expect(PAYWALL_CODE).toContain("t('paywall.aj.introWithName', { name: entryName })");
  });

  it('AJ never announces a trial, a coupon benefit or a purchase outcome it cannot source', () => {
    const start = PAYWALL_CODE.indexOf('const ajLines = ():');
    const end = PAYWALL_CODE.indexOf('const ajMood =', start);
    const body = PAYWALL_CODE.slice(start, end);
    // Trial line gated on the confirmed duration; coupon line on the applied
    // code; every outcome line is the existing classified message.
    expect(body).toContain('if (presentedTrialDuration) {');
    expect(body).toContain("promoApplied && promoState.applied?.code");
    expect(body).toContain('purchaseState.message');
    expect(body).toContain('restoreState.message');
    // A cancelled purchase is silent, exactly as the design specifies.
    expect(body).toContain("if (purchaseState.kind === 'cancelled') return [];");
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

describe('Paywall redesign — AJ replaces the photo hero', () => {
  it('the screen no longer renders a hero photograph', () => {
    expect(PAYWALL_CODE).not.toContain('function PaywallHeroVisual(');
    expect(PAYWALL_CODE).not.toContain('resizeMode="cover"');
    expect(PAYWALL_CODE).not.toMatch(/https?:\/\/.*\.(png|jpe?g|webp)/i);
  });

  it('AJ occupies that area as a single inline mascot, never inside a Modal', () => {
    expect(PAYWALL_CODE).toContain('<AjSheetScreenAssistant');
    expect(PAYWALL_CODE.match(/<AjSheetScreenAssistant\b/g)?.length).toBe(1);
    expect(PAYWALL_CODE).toContain('<AqSheet');
  });

  it('the sex-resolved hero asset mapping is preserved, so reinstating the photo is a render change only', () => {
    // Intent carried over verbatim from the superseded composition: the
    // highlight is resolved by the questionnaire's `sex` answer, with a
    // neutral fallback, from bundled assets only.
    expect(HERO_IMAGE_CODE).toContain("sex === 'm'");
    expect(HERO_IMAGE_CODE).toContain("sex === 'f'");
    expect(HERO_IMAGE_CODE).toContain('PAYWALL_HERO_IMAGE_DEFAULT');
    expect(HERO_IMAGE_CODE).toContain("require('../../../assets/paywall/paywall-asset.webp')");
    expect(HERO_IMAGE_CODE).toContain("require('../../../assets/paywall/paywall-asset-mas.webp')");
    expect(HERO_IMAGE_CODE).toContain("require('../../../assets/paywall/paywall-asset-fem.webp')");
    expect(HERO_IMAGE_CODE).not.toMatch(/https?:\/\//);
  });

  it('the mascot layer never intercepts touches meant for the sheet', () => {
    // The screen itself no longer draws any decorative layer — the only thing
    // floating over the content is AJ, who sits in front of the sheet and
    // must be transparent to every touch aimed at it.
    const assistant = stripComments(
      readFileSync('src/components/aj/AjSheetScreenAssistant.tsx', 'utf8'),
    );
    expect(assistant).toContain('pointerEvents="none"');
  });
});
