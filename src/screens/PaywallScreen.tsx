import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { PurchasesPackage } from 'react-native-purchases';
import { logInfo, logWarn } from '../lib/logger';
import { requestCommercialGateConfirmation } from '../services/commercialGate';
import type { OnboardingAuthContext } from '../onboarding/authContext';
import { useAuth } from '../state/AuthContext';
import { ScreenBg } from '../components/ui/ScreenBg';
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { Display, MonoLabel } from '../components/ui/Display';
import { FullScreenLoading } from '../components/ui/FullScreenLoading';
import { Icon } from '../components/ui/Icon';
import { useSubscription } from '../hooks/useSubscription';
import { usePromoCode } from '../hooks/usePromoCode';
import {
  applyAndroidPromoPackageOverrides,
  classifyPurchaseResult,
  classifyRestoreResult,
  getCurrentOfferingPackages,
  packagePeriodLabel,
  packagePriceString,
  packageTitle,
  resolveAndroidPlanKind,
  resolveAndroidPurchaseRoute,
  resolveAndroidTrialSignal,
  resolveAuthorizedAndroidOffer,
  resolveIOSOfferingRoute,
  resolveIOSPlanKind,
  resolveIOSPromotionalCatalog,
  resolveOfferingViewState,
  resolveSelectedPackage,
  type PurchaseRoute,
} from '../lib/subscriptionOffer';
import {
  resolveIOSIntroOfferPresentation,
  resolveIOSPromoPurchaseReadiness,
  type IOSIntroEligibilityState,
  type IOSIntroOfferPresentation,
} from '../lib/iosIntroOffer';
import {
  executeIOSPromoPurchase,
  iosPromoPurchaseSnapshotKey,
  type IOSPromoPurchaseAttempt,
  type IOSPromoPurchaseSnapshot,
} from '../lib/iosPromoPurchase';
import { isPromoCodeUiSupported } from '../lib/promoCodePlatform';
import type { PromoCodeState } from '../lib/promoCodeState';
import {
  logSubscriptionDiagnostic,
  logSubscriptionPurchaseOutcome,
  normalizeBlockedReasonForDiagnostic,
  normalizeIntroEligibilityForDiagnostic,
  type SubscriptionPurchaseContext,
} from '../lib/subscriptionDiagnostics';
import {
  checkIOSIntroEligibility,
  PREMIUM_ENTITLEMENT_ID,
} from '../services/revenueCatService';
import { authorizePromoPurchase } from '../services/promoCodeService';
import { useTheme } from '../theme';
import { useDevSubscriptionOverrideContext } from '../dev/DevSubscriptionOverrideContext';
import {
  DevSubscriptionOverridePickerSheet,
  DEV_OVERRIDE_LABELS,
} from '../dev/DevSubscriptionOverridePickerSheet';
import { LegalDocumentModal, type LegalDocumentKind } from '../components/legal/LegalDocumentModal';

/**
 * FASE iOS-3 — derived from `isPromoCodeUiSupported` (see its doc comment,
 * src/lib/promoCodePlatform.ts) instead of an inline `Platform.OS ===
 * 'android'` check. iOS now renders the same "CÓDIGO PROMOCIONAL" input as
 * Android (validating an AJ Fit code against the backend is already
 * platform-agnostic since FASE iOS-2). On iOS, only a complete backend
 * `iosPromotion` can select a promotional commercial route; otherwise the
 * standard package flow remains authoritative.
 */
const PROMO_CODE_SUPPORTED_PLATFORM = isPromoCodeUiSupported(Platform.OS);

/**
 * Temporary UI-only kill switch for the Dev/QA Subscription Override row on
 * this screen (see its render site below). Does not touch
 * DevSubscriptionOverrideContext or Settings > Developer — flip back to
 * `false` to restore this screen's entry point into that same logic.
 */
const HIDE_DEV_OVERRIDE_ROW = true;

/**
 * Reused by the trial highlight and the existing promo detail so the two
 * never drift on how a trial duration is worded.
 */
const INTRO_DURATION_UNIT_KEY = {
  day: 'paywall.promo.duration.day',
  week: 'paywall.promo.duration.week',
  month: 'paywall.promo.duration.month',
  year: 'paywall.promo.duration.year',
} as const;

function formatIntroDuration(
  t: TFunction,
  duration: { count: number; unit: keyof typeof INTRO_DURATION_UNIT_KEY },
): string {
  return t(INTRO_DURATION_UNIT_KEY[duration.unit], { count: duration.count });
}

type TrialDuration = { count: number; unit: keyof typeof INTRO_DURATION_UNIT_KEY };

/** Presentation-only conversion: a Store-reported week becomes seven days. */
function marketingTrialDuration(duration: TrialDuration): TrialDuration {
  return duration.unit === 'week'
    ? { count: duration.count * 7, unit: 'day' }
    : duration;
}

/**
 * Reads the real Google Play free phase without changing Android's existing
 * non-committal eligibility signal. If multiple visible trial offers disagree
 * on duration, the UI deliberately falls back to generic conditional copy.
 */
function androidFreeTrialDuration(pkg: PurchasesPackage): TrialDuration | null {
  const durations = (pkg.product.subscriptionOptions ?? [])
    .filter((option) => !option.isBasePlan && option.freePhase !== null)
    .map((option): TrialDuration | null => {
      const phase = option.freePhase;
      if (!phase) return null;
      const rawUnit = phase.billingPeriod.unit.toLowerCase();
      if (!(rawUnit in INTRO_DURATION_UNIT_KEY)) return null;
      const cycles = phase.billingCycleCount && phase.billingCycleCount > 0
        ? phase.billingCycleCount
        : 1;
      const count = phase.billingPeriod.value * cycles;
      if (!Number.isInteger(count) || count <= 0) return null;
      return { count, unit: rawUnit as TrialDuration['unit'] };
    })
    .filter((duration): duration is TrialDuration => duration !== null);
  if (durations.length === 0) return null;
  const [first] = durations;
  return durations.every(
    (duration) => duration.count === first.count && duration.unit === first.unit,
  )
    ? marketingTrialDuration(first)
    : null;
}

const PAYWALL_HERO_IMAGE_DEFAULT = require('../../assets/paywall/paywall-asset.webp');
const PAYWALL_HERO_IMAGE_MASCULINO = require('../../assets/paywall/paywall-asset-mas.webp');
const PAYWALL_HERO_IMAGE_FEMININO = require('../../assets/paywall/paywall-asset-fem.webp');

/** `sex` comes from the user's questionnaire answers (`Quiz['sex']`) — `null` covers both "not answered yet" and any flow that skipped it, and always falls back to the neutral asset. */
function resolvePaywallHeroImage(sex: 'm' | 'f' | null | undefined) {
  if (sex === 'm') return PAYWALL_HERO_IMAGE_MASCULINO;
  if (sex === 'f') return PAYWALL_HERO_IMAGE_FEMININO;
  return PAYWALL_HERO_IMAGE_DEFAULT;
}

type PurchaseUiState =
  | { kind: 'idle' }
  | { kind: 'purchasing' }
  | { kind: 'cancelled' }
  | { kind: 'notice'; message: string }
  | { kind: 'error'; message: string; offline: boolean };

type RestoreUiState =
  | { kind: 'idle' }
  | { kind: 'restoring' }
  | { kind: 'notice'; message: string }
  | { kind: 'error'; message: string; offline: boolean };

type IOSPromoRoute = { kind: 'ios_promo_package'; attempt: IOSPromoPurchaseAttempt };
type EffectivePurchaseRoute =
  | PurchaseRoute
  | IOSPromoRoute
  | { kind: 'blocked'; reason: string };

export function PaywallScreen({
  onClose,
  closeAccessibilityLabel = 'Sair desta conta',
  entryContext,
}: {
  onClose: () => void | Promise<void>;
  closeAccessibilityLabel?: string;
  /**
   * Copy-only context from the onboarding funnel (see
   * src/onboarding/authContext.ts) — narrative framing only. Never read by
   * offerings/purchase/restore/promo-code/entitlement logic below.
   */
  entryContext?: OnboardingAuthContext | null;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('common');
  const {
    offerings,
    offeringsLoading,
    offeringsError,
    offeringsOffline,
    offeringsUnavailable,
    loadOfferings,
    purchase,
    purchaseOption,
    restore,
  } = useSubscription();
  const { questionnaire } = useAuth();
  const heroImage = resolvePaywallHeroImage(questionnaire?.answers.sex);

  // Dev/QA only — same DevSubscriptionOverrideContext as Settings > Developer
  // (see docs/13_assinaturas_e_billing.md). Lets a brand-new account, which
  // has no Premium yet and is blocked here by the real navigation gate,
  // simulate a Premium state without buying. This screen only ever writes
  // to `setOverride`; the gate that actually opens AppShell is unaware this
  // entry point exists — it just reacts to `isPremium` becoming true like it
  // would for a real purchase.
  const {
    allowed: devOverrideAllowed,
    override: devOverride,
    setOverride: setDevOverride,
  } = useDevSubscriptionOverrideContext();
  const [devOverridePickerOpen, setDevOverridePickerOpen] = useState(false);
  const [legalDocument, setLegalDocument] = useState<LegalDocumentKind | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [purchaseState, setPurchaseState] = useState<PurchaseUiState>({ kind: 'idle' });
  const [restoreState, setRestoreState] = useState<RestoreUiState>({ kind: 'idle' });
  const [closing, setClosing] = useState(false);
  const actionInFlight = useRef(false);
  const closeInFlight = useRef(false);
  const mounted = useRef(true);
  const eligibilityRequestSeq = useRef(0);
  const promoSnapshotKeyRef = useRef<string | null>(null);

  // FASE 4: promo/influencer state is identity-scoped by PromoCodeProvider
  // (uid + generation + attempt seq) and survives an ordinary Paywall
  // remount. `promoInput` remains display/input only and never authorizes a
  // commercial route.
  const { state: promoState, applyCode } = usePromoCode();
  const [promoInput, setPromoInput] = useState('');

  // Fase 4C.3 §4/§6: the single source of truth for "is a promo code
  // currently authorized" — derived fresh on every render (see
  // `resolveAuthorizedAndroidOffer`'s/`resolveAndroidPurchaseRoute`'s doc
  // comments, subscriptionOffer.ts), moved above `packages` so the Android
  // promo-package display override (FASE 6.3) can depend on it too.
  const promoApplied = PROMO_CODE_SUPPORTED_PLATFORM && promoState.phase === 'applied' && promoState.applied !== null;

  useEffect(() => {
    loadOfferings();
  }, [loadOfferings]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const standardPackages = useMemo(() => getCurrentOfferingPackages(offerings), [offerings]);

  // FASE 5 — authorization still comes ONLY from the typed backend snapshot;
  // the Fase 4 resolver remains the sole Offering/package authority.
  const iosOfferingRoute = useMemo(
    () =>
      Platform.OS === 'ios'
        ? resolveIOSOfferingRoute(promoState.applied?.iosPromotion ?? null)
        : null,
    [promoState.applied],
  );
  const iosCatalogResolution = useMemo(() => {
    if (!iosOfferingRoute || iosOfferingRoute.kind !== 'promotional') return null;
    return resolveIOSPromotionalCatalog(offerings, iosOfferingRoute);
  }, [iosOfferingRoute, offerings]);
  // FASE 6.3 — Android 'new'-shape display override: replaces each standard
  // package with its resolved promotional package for whichever plan has a
  // successfully-resolved 'new'-shape authorization, so the price/plan card
  // shown never diverges from what `purchasePackage` will actually buy (see
  // `applyAndroidPromoPackageOverrides`'s doc comment). LEGACY-shape plans
  // are untouched here — legacy's price display gap is pre-existing and out
  // of scope for this change.
  const androidPackages = useMemo(() => {
    if (Platform.OS !== 'android' || !promoApplied || !promoState.applied) return standardPackages;
    return applyAndroidPromoPackageOverrides(
      standardPackages,
      offerings,
      promoState.applied.androidStoreConfig,
    );
  }, [offerings, promoApplied, promoState.applied, standardPackages]);
  const packages = useMemo(() => {
    if (iosOfferingRoute?.kind === 'promotional') {
      if (iosCatalogResolution?.status !== 'resolved') return [];
      const { monthlyPackage, annualPackage } = iosCatalogResolution;
      // Keep the same plan order the standard (non-promotional) catalog
      // uses — the promotional resolution only picks WHICH packages back
      // each plan, never the display order, so the card list must not
      // reshuffle (e.g. Annual dropping below Monthly) just because a
      // coupon got applied.
      const byType: Partial<Record<string, PurchasesPackage>> = {
        MONTHLY: monthlyPackage,
        ANNUAL: annualPackage,
      };
      const orderedFromStandard = standardPackages
        .map((pkg) => byType[pkg.packageType])
        .filter((pkg): pkg is PurchasesPackage => !!pkg);
      return orderedFromStandard.length === 2
        ? orderedFromStandard
        : [monthlyPackage, annualPackage];
    }
    return Platform.OS === 'android' ? androidPackages : standardPackages;
  }, [androidPackages, iosCatalogResolution, iosOfferingRoute, standardPackages]);
  const selectedPackage = useMemo(
    () => resolveSelectedPackage(packages, selectedId),
    [packages, selectedId],
  );

  // FASE 6.4 -- scoped to whatever `packages` currently is (standard OR
  // promotional), not just the promotional catalog: rule 1 requires trial
  // to be communicated from real Store eligibility EVEN without a coupon,
  // so this must run for the standard catalog too. `checkIOSIntroEligibility`
  // itself already no-ops (returns 'unknown' for every product) on Android
  // (`revenueCatService.ts`), so running this unconditionally is harmless
  // there -- the Android-specific trial signal is entirely separate
  // (`resolveAndroidTrialSignal`, never derived from this iOS-only check).
  const eligibilityScopeKey = useMemo(() => {
    if (packages.length === 0) return null;
    return packages.map((pkg) => pkg.product.identifier).join('\u001f');
  }, [packages]);

  const [iosEligibilitySnapshot, setIOSEligibilitySnapshot] = useState<{
    scopeKey: string | null;
    byProductId: Record<string, IOSIntroEligibilityState>;
  }>({ scopeKey: null, byProductId: {} });

  useEffect(() => {
    const seq = ++eligibilityRequestSeq.current;
    if (!eligibilityScopeKey || packages.length === 0) {
      setIOSEligibilitySnapshot({ scopeKey: null, byProductId: {} });
      return;
    }
    const productIds = packages.map((pkg) => pkg.product.identifier);
    setIOSEligibilitySnapshot({
      scopeKey: eligibilityScopeKey,
      byProductId: Object.fromEntries(
        productIds.map((id) => [id, { status: 'checking' } as const]),
      ),
    });
    let cancelled = false;
    void checkIOSIntroEligibility(productIds)
      .then((result) => {
        if (cancelled || !mounted.current || seq !== eligibilityRequestSeq.current) return;
        setIOSEligibilitySnapshot({ scopeKey: eligibilityScopeKey, byProductId: result });
        packages.forEach((pkg) => {
          const plan = resolveIOSPlanKind(pkg);
          if (!plan) return;
          const state = result[pkg.product.identifier] ?? { status: 'unknown' as const };
          const presentation = resolveIOSIntroOfferPresentation(pkg, state);
          logSubscriptionDiagnostic({
            event: 'subscription_intro_eligibility',
            plan,
            eligibility: normalizeIntroEligibilityForDiagnostic(state),
            hasValidFreeIntro: presentation.kind === 'free_trial',
          });
        });
      })
      .catch(() => {
        if (cancelled || !mounted.current || seq !== eligibilityRequestSeq.current) return;
        setIOSEligibilitySnapshot({
          scopeKey: eligibilityScopeKey,
          byProductId: Object.fromEntries(
            productIds.map((id) => [id, { status: 'error' } as const]),
          ),
        });
        packages.forEach((pkg) => {
          const plan = resolveIOSPlanKind(pkg);
          if (!plan) return;
          logSubscriptionDiagnostic({
            event: 'subscription_intro_eligibility',
            plan,
            eligibility: 'error',
            hasValidFreeIntro: false,
          });
        });
      });
    return () => {
      cancelled = true;
    };
  }, [eligibilityScopeKey, packages]);

  useEffect(() => {
    if (
      iosOfferingRoute?.kind !== 'promotional' ||
      !iosCatalogResolution ||
      iosCatalogResolution.status !== 'error'
    ) {
      return;
    }
    // Symbolic catalog diagnostics only: never logs UID, coupon, Offering,
    // Product ID, or the authorization payload.
    logWarn('promoCode', iosCatalogResolution.reason);
  }, [iosCatalogResolution, iosOfferingRoute]);

  useEffect(() => {
    const nextId = selectedPackage?.identifier ?? null;
    if (nextId !== selectedId) setSelectedId(nextId);
  }, [selectedId, selectedPackage]);

  // FASE 6.4 — always 'checking' (never the old promo-only 'idle' default)
  // while the scoped eligibility snapshot hasn't caught up yet: this now
  // runs for the standard catalog too (see `eligibilityScopeKey` above), so
  // there's no "irrelevant, don't bother" case left to special-case.
  const introPresentations = useMemo<Record<string, IOSIntroOfferPresentation>>(
    () =>
      Object.fromEntries(
        packages.map((pkg) => [
          pkg.product.identifier,
          resolveIOSIntroOfferPresentation(
            pkg,
            eligibilityScopeKey && iosEligibilitySnapshot.scopeKey === eligibilityScopeKey
              ? iosEligibilitySnapshot.byProductId[pkg.product.identifier] ?? { status: 'unknown' }
              : { status: 'checking' },
          ),
        ]),
      ),
    [eligibilityScopeKey, iosEligibilitySnapshot, packages],
  );
  const selectedIntroPresentation = selectedPackage
    ? introPresentations[selectedPackage.product.identifier] ?? null
    : null;
  const selectedIntroReadiness = selectedIntroPresentation
    ? resolveIOSPromoPurchaseReadiness(selectedIntroPresentation)
    : { status: 'blocked' as const, reason: 'checking' as const };
  const introText = useCallback(
    (presentation: IOSIntroOfferPresentation | null, pkg: PurchasesPackage | null) => {
      if (!presentation || !pkg) return null;
      const plan = resolveIOSPlanKind(pkg);
      const period = plan ? t(`paywall.promo.period.${plan}`) : '';
      if (presentation.kind === 'free_trial') {
        const duration = formatIntroDuration(t, presentation.terms.duration);
        return {
          tone: 'neutral' as const,
          message: t('paywall.promo.freeTrial', {
            duration,
            price: presentation.terms.renewalPriceString,
            period,
          }),
          badge: t('paywall.promo.trialBadge', {
            duration,
            price: presentation.terms.renewalPriceString,
            period,
          }),
        };
      }
      if (presentation.kind === 'standard' && presentation.reason === 'ineligible') {
        return {
          tone: 'neutral' as const,
          message: t('paywall.promo.ineligible', {
            price: pkg.product.priceString,
            period,
          }),
          badge: null,
        };
      }
      if (presentation.kind === 'checking' || presentation.kind === 'neutral') {
        return { tone: 'neutral' as const, message: t('paywall.promo.checking'), badge: null };
      }
      if (
        presentation.kind === 'configuration_error' ||
        (presentation.kind === 'standard' && presentation.reason === 'no_intro_offer')
      ) {
        return {
          tone: 'error' as const,
          message: t('paywall.promo.configurationUnavailable'),
          badge: null,
        };
      }
      return {
        tone: 'error' as const,
        message: t('paywall.promo.eligibilityUnavailable'),
        badge: null,
      };
    },
    [t],
  );
  const selectedIntroText = introText(selectedIntroPresentation, selectedPackage);

  const trialEligibilityChecking =
    Platform.OS === 'ios' &&
    (selectedIntroPresentation?.kind === 'checking' ||
      selectedIntroPresentation?.kind === 'neutral');

  type TrialHighlightPresentation =
    | { kind: 'ios_confirmed'; duration: TrialDuration }
    | { kind: 'android_possible'; duration: TrialDuration | null };
  const trialHighlight = useMemo<TrialHighlightPresentation | null>(() => {
    if (!selectedPackage) return null;
    if (
      Platform.OS === 'ios' &&
      selectedIntroPresentation?.kind === 'free_trial'
    ) {
      return {
        kind: 'ios_confirmed',
        duration: marketingTrialDuration(selectedIntroPresentation.terms.duration),
      };
    }
    if (
      Platform.OS === 'android' &&
      resolveAndroidTrialSignal(selectedPackage) === 'possible'
    ) {
      return {
        kind: 'android_possible',
        duration: androidFreeTrialDuration(selectedPackage),
      };
    }
    return null;
  }, [selectedIntroPresentation, selectedPackage]);
  const trialHeroTitle = trialHighlight
    ? trialHighlight.kind === 'ios_confirmed'
      ? t('paywall.trial.confirmedTitle', {
          duration: formatIntroDuration(t, trialHighlight.duration),
        })
      : trialHighlight.duration
        ? t('paywall.trial.androidConditionalTitle', {
            duration: formatIntroDuration(t, trialHighlight.duration),
          })
        : t('paywall.trial.androidConditionalTitleGeneric')
    : null;

  // Android only — `null` on iOS (guarded so `promoState.applied.androidStoreConfig`,
  // which is always `null` for an iOS-platform validation response per the
  // backend contract, is never fed into Android's live-catalog matching).
  // `selectedPackage` may already be a FASE 6.3 promo-package override (see
  // `androidPackages` above) when the authorized offer is 'new'-shape and
  // resolved successfully — `resolveAndroidPurchaseRoute` re-resolves the
  // 'new' case independently from `offerings` regardless, so it never
  // trusts `selectedPackage`'s identity as the purchase target for that
  // shape; it's only used here (and inside `resolveAuthorizedAndroidOffer`)
  // to determine which plan (monthly/annual) is currently selected.
  const purchaseRoute: PurchaseRoute | null = useMemo(() => {
    if (!selectedPackage || Platform.OS !== 'android') return null;
    const authorizedOffer =
      promoApplied && promoState.applied
        ? resolveAuthorizedAndroidOffer(selectedPackage, promoState.applied.androidStoreConfig)
        : null;
    return resolveAndroidPurchaseRoute(selectedPackage, promoApplied, authorizedOffer, offerings);
  }, [selectedPackage, promoApplied, promoState.applied, offerings]);

  // FASE 6 — the ordinary iOS route is the selected package itself. A
  // validated coupon never changes this route unless the backend supplied a
  // complete `iosPromotion` authorization, handled separately below.
  const standardIOSRoute: PurchaseRoute | null = useMemo(() => {
    if (!selectedPackage || Platform.OS !== 'ios') return null;
    return { kind: 'package', package: selectedPackage };
  }, [selectedPackage]);

  /** The route that actually governs the CTA/`handlePurchase` on this platform. */
  const effectiveRoute: EffectivePurchaseRoute | null = useMemo(() => {
    if (Platform.OS === 'android') return purchaseRoute;
    if (iosOfferingRoute?.kind === 'standard') {
      // A code that is valid only under the retired Offer Code contract must
      // not silently buy the standard SKU. The backend may keep that legacy
      // wire data during rollout, but this client does not consume it.
      if (promoApplied) return { kind: 'blocked', reason: 'promo_ios_unavailable' };
      return standardIOSRoute;
    }
    if (iosOfferingRoute?.kind === 'blocked') {
      return { kind: 'blocked', reason: 'promo_authorization_invalid' };
    }
    if (
      iosCatalogResolution?.status !== 'resolved' ||
      !selectedPackage ||
      !promoState.applied
    ) {
      return { kind: 'blocked', reason: 'promo_catalog_error' };
    }
    const plan = resolveIOSPlanKind(selectedPackage);
    if (!plan) return { kind: 'blocked', reason: 'promo_catalog_error' };
    return {
      kind: 'ios_promo_package',
      attempt: {
        plan,
        authorization: iosCatalogResolution.route.authorization,
        package: selectedPackage,
      },
    };
  }, [
    iosCatalogResolution,
    iosOfferingRoute,
    promoApplied,
    promoState.applied,
    purchaseRoute,
    selectedPackage,
    standardIOSRoute,
  ]);

  // FASE 6.5 — cross-platform now (was iOS-only): Android's purchase route
  // is equally observable, using the SAME event schema
  // (`subscriptionDiagnostics.ts`'s `SubscriptionPurchaseRoute` now spans
  // both platforms — see its doc comment). Never derives `route`/`plan`
  // from the coupon code/campaign/offering identity — only from which SDK
  // call `effectiveRoute` actually leads to.
  const purchaseDiagnosticContext = useMemo<SubscriptionPurchaseContext | null>(() => {
    if (!effectiveRoute || effectiveRoute.kind === 'blocked') return null;
    if (effectiveRoute.kind === 'ios_promo_package') {
      return { route: 'promo_package', plan: effectiveRoute.attempt.plan };
    }
    if (effectiveRoute.kind === 'subscription_option') {
      // Android LEGACY: the option itself carries no packageType — the plan
      // comes from whichever (standard) package is currently selected.
      const plan = selectedPackage ? resolveAndroidPlanKind(selectedPackage) : null;
      return plan ? { route: 'legacy_subscription_option', plan } : null;
    }
    if (effectiveRoute.kind !== 'package') return null;
    const plan =
      Platform.OS === 'ios'
        ? resolveIOSPlanKind(effectiveRoute.package)
        : resolveAndroidPlanKind(effectiveRoute.package);
    if (!plan) return null;
    // On Android, `{kind:'package'}` means either "no promo" (standard) or
    // a resolved FASE 5.7/6.3 NEW-shape promo — `promoApplied` is the only
    // way to distinguish them, since both produce the same route shape.
    const route = Platform.OS === 'android' && promoApplied ? 'promo_package' : 'standard';
    return { route, plan };
  }, [effectiveRoute, promoApplied, selectedPackage]);

  useEffect(() => {
    if (!purchaseDiagnosticContext) return;
    logSubscriptionDiagnostic({
      event: 'subscription_purchase_route_resolved',
      ...purchaseDiagnosticContext,
    });
  }, [purchaseDiagnosticContext?.plan, purchaseDiagnosticContext?.route]);

  // FASE 6.5 — the blocked counterpart: fires whenever the route is a
  // fail-closed stop (invalid/unresolvable offering, package, or base plan)
  // on EITHER platform. `plan` is best-effort from `selectedPackage` (still
  // meaningful even though no purchase target exists); `reason` is
  // allowlisted — never the raw blocked-reason string transported verbatim.
  useEffect(() => {
    if (!effectiveRoute || effectiveRoute.kind !== 'blocked') return;
    const plan = selectedPackage
      ? Platform.OS === 'ios'
        ? resolveIOSPlanKind(selectedPackage)
        : resolveAndroidPlanKind(selectedPackage)
      : null;
    logSubscriptionDiagnostic({
      event: 'subscription_purchase_route_blocked',
      plan,
      reason: normalizeBlockedReasonForDiagnostic(effectiveRoute.reason),
    });
  }, [effectiveRoute, selectedPackage]);

  const currentPromoSnapshot = useMemo<IOSPromoPurchaseSnapshot | null>(() => {
    if (effectiveRoute?.kind !== 'ios_promo_package' || !promoState.applied) return null;
    return {
      uid: promoState.applied.uid,
      generation: promoState.applied.generation,
      code: promoState.applied.code,
      attempt: effectiveRoute.attempt,
    };
  }, [effectiveRoute, promoState.applied]);
  promoSnapshotKeyRef.current = currentPromoSnapshot
    ? iosPromoPurchaseSnapshotKey(currentPromoSnapshot)
    : null;

  // Fase 4C.2/4C.3 §22: sanitized, state-only logs — never the full code,
  // never SubscriptionOption/CustomerInfo contents.
  useEffect(() => {
    if (!purchaseRoute) return;
    if (purchaseRoute.kind === 'subscription_option') {
      logInfo('promoCode', 'promo_option_match');
    } else if (purchaseRoute.kind === 'blocked') {
      if (purchaseRoute.reason === 'promo_ambiguous') {
        logWarn('promoCode', 'promo_option_ambiguous');
      } else {
        logInfo('promoCode', purchaseRoute.reason);
      }
    }
  }, [purchaseRoute]);

  const handleClose = useCallback(async () => {
    if (closeInFlight.current || actionInFlight.current) return;
    closeInFlight.current = true;
    setClosing(true);
    try {
      await onClose();
    } finally {
      closeInFlight.current = false;
      if (mounted.current) setClosing(false);
    }
  }, [onClose]);

  const handlePurchase = useCallback(async () => {
    // Fase 4C.3 §5/§13, extended by FASE 5/6: `effectiveRoute` is captured
    // here, at the moment the user taps — the exact same route (package,
    // Android SubscriptionOption, or authorized iOS Promo SKU) this
    // closure captured is what runs, regardless of anything that happens to
    // `promoState` while the action is in flight (`busy` already disables
    // the promo input/apply button and package selector below). A
    // `'blocked'` route is never acted on — the CTA is already disabled for
    // it, this is a second guard, never a silent fallback to
    // `purchase(selectedPackage)`.
    if (
      !effectiveRoute ||
      effectiveRoute.kind === 'blocked' ||
      actionInFlight.current ||
      (effectiveRoute.kind === 'ios_promo_package' && selectedIntroReadiness.status !== 'ready')
    ) return;
    actionInFlight.current = true;
    setPurchaseState({ kind: 'purchasing' });
    setRestoreState({ kind: 'idle' });

    try {
      let outcome;
      if (effectiveRoute.kind === 'ios_promo_package') {
        if (!currentPromoSnapshot) return;
        const snapshotKey = iosPromoPurchaseSnapshotKey(currentPromoSnapshot);
        const execution = await executeIOSPromoPurchase({
          attempt: currentPromoSnapshot.attempt,
          authorize: authorizePromoPurchase,
          purchase,
          isCurrent: () =>
            mounted.current && promoSnapshotKeyRef.current === snapshotKey,
        });
        if (!mounted.current) return;
        if (execution.status !== 'purchased') {
          if (execution.status === 'stale') {
            setPurchaseState({ kind: 'idle' });
            return;
          }
          if (execution.status === 'intent_invalid') {
            logWarn(
              'promoCode',
              execution.reason === 'expired'
                ? 'promo_purchase_intent_expired'
                : 'promo_purchase_intent_mismatch',
              { reason: execution.reason },
            );
          }
          logSubscriptionDiagnostic({
            event: 'promo_purchase_intent_failed',
            plan: currentPromoSnapshot.attempt.plan,
            errorCategory: 'authorization_error',
          });
          const message =
            execution.status === 'authorization_failed' &&
            execution.outcome.reason === 'conflict'
              ? t('paywall.promo.errors.authorizationConflict')
              : execution.status === 'authorization_failed' &&
                  execution.outcome.reason === 'unauthenticated'
                ? t('paywall.promo.errors.unauthenticated')
                : execution.status === 'intent_invalid' && execution.reason === 'expired'
                  ? t('paywall.promo.errors.intentExpired')
                  : execution.status === 'intent_invalid'
                    ? t('paywall.promo.errors.intentMismatch')
                  : t('paywall.promo.errors.authorization');
          setPurchaseState({ kind: 'error', message, offline: false });
          return;
        }
        outcome = execution.result;
      } else {
        if (
          (effectiveRoute.kind === 'package' || effectiveRoute.kind === 'subscription_option') &&
          purchaseDiagnosticContext
        ) {
          logSubscriptionDiagnostic({
            event: 'subscription_purchase_started',
            ...purchaseDiagnosticContext,
          });
        }
        outcome = effectiveRoute.kind === 'package'
          ? await purchase(effectiveRoute.package)
          : await purchaseOption(effectiveRoute.option);
      }
      if (purchaseDiagnosticContext) {
        logSubscriptionPurchaseOutcome(
          purchaseDiagnosticContext,
          outcome,
          PREMIUM_ENTITLEMENT_ID,
        );
      }
      if (!mounted.current) return;

      switch (classifyPurchaseResult(outcome, PREMIUM_ENTITLEMENT_ID)) {
        case 'premium':
          // No navigation here. SubscriptionContext already received this
          // CustomerInfo; the root gate is the only code allowed to open AppShell.
          setPurchaseState({
            kind: 'notice',
            message: 'Assinatura confirmada. Seu acesso Premium está ativo.',
          });
          // Best-effort, fire-and-forget: accelerates the DURABLE server
          // marker (`metadata.commercialGateResolvedAt`) so a later
          // cancellation doesn't incorrectly reopen this Paywall if the
          // async RevenueCat webhook is delayed or never arrives. Never
          // awaited — `isPremium` above already carries the UX right now,
          // and the webhook remains the authoritative fallback regardless
          // of this call's outcome. See src/services/commercialGate.ts.
          void requestCommercialGateConfirmation();
          break;
        case 'missing-entitlement':
          setPurchaseState({
            kind: 'notice',
            message: 'A compra foi processada, mas o acesso Premium ainda não foi identificado. Tente restaurar as compras.',
          });
          break;
        case 'cancelled':
          setPurchaseState({ kind: 'cancelled' });
          break;
        case 'error':
          if (outcome.status === 'error') {
            setPurchaseState({
              kind: 'error',
              message: outcome.message,
              offline: outcome.offline,
            });
          }
          break;
      }
    } finally {
      actionInFlight.current = false;
    }
  }, [
    currentPromoSnapshot,
    effectiveRoute,
    purchaseDiagnosticContext,
    purchase,
    purchaseOption,
    selectedIntroReadiness.status,
    t,
  ]);

  const handleRestore = useCallback(async () => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setRestoreState({ kind: 'restoring' });
    setPurchaseState({ kind: 'idle' });

    try {
      const outcome = await restore();
      if (!mounted.current) return;

      const result = classifyRestoreResult(outcome, PREMIUM_ENTITLEMENT_ID);
      if (result === 'premium') {
        // Same as purchase: CustomerInfo drives SubscriptionContext and the gate.
        setRestoreState({
          kind: 'notice',
          message: 'Compra restaurada. Seu acesso Premium está ativo.',
        });
        // See the identical call in handlePurchase above — restore is not a
        // separate code path for this confirmation, deliberately: the
        // backend re-derives entitlement from RevenueCat directly, it does
        // not care HOW the client arrived at an active CustomerInfo.
        void requestCommercialGateConfirmation();
      } else if (result === 'missing-entitlement') {
        setRestoreState({
          kind: 'notice',
          message: 'Não encontramos nenhuma assinatura ativa para esta conta.',
        });
      } else if (outcome.status === 'error') {
        setRestoreState({
          kind: 'error',
          message: outcome.offeringsUnavailable
            ? 'As assinaturas não estão disponíveis na loja neste momento.'
            : outcome.message,
          offline: outcome.offline,
        });
      }
    } finally {
      actionInFlight.current = false;
    }
  }, [restore]);

  const isPurchasing = purchaseState.kind === 'purchasing';
  const isRestoring = restoreState.kind === 'restoring';
  const busy = isPurchasing || isRestoring || closing;

  // Fase 4C.2 §21: no NEW guard needed — `busy` already reflects
  // `isPurchasing`, so the promo input/button below (wired to
  // `disabled={busy}`) is already blocked while a purchase is in flight.
  // This is exactly where Fase 4C.3's future "block code changes during
  // purchasing" requirement connects — nothing to change here later,
  // `busy` already includes it.
  const handleApplyPromoCode = useCallback(() => {
    if (!promoInput.trim() || busy) return;
    void applyCode(promoInput);
  }, [applyCode, promoInput, busy]);
  const offeringViewState = resolveOfferingViewState({
    offerings,
    loading: offeringsLoading,
    error: offeringsError,
    offline: offeringsOffline,
    unavailable: offeringsUnavailable,
  });
  const centerState: CenteredStateKind | null =
    offeringViewState === 'ready' ? null : offeringViewState;

  // Keep the visual surface continuous when the Premium gate resolves to the
  // Paywall before its commercial Offerings request finishes. Offerings still
  // start only inside the Paywall and never block a Premium user from AppShell.
  if (centerState === 'loading') return <FullScreenLoading />;

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* Dev/QA only — temporarily hidden from the Paywall UI per request
            while the paywall UI/UX is redesigned. The underlying
            DevSubscriptionOverrideContext logic (Settings > Developer) is
            untouched — only this screen's entry point into it is hidden.
            Flip HIDE_DEV_OVERRIDE_ROW back to re-enable. */}
        {devOverrideAllowed && !HIDE_DEV_OVERRIDE_ROW ? (
          <DevSubscriptionOverrideRow
            current={devOverride}
            onPress={() => setDevOverridePickerOpen(true)}
          />
        ) : null}

        {centerState ? (
          <View style={{ flex: 1 }}>
            <PaywallHeader
              onClose={handleClose}
              onRestore={handleRestore}
              isRestoring={isRestoring}
              disabled={busy}
              closeAccessibilityLabel={closeAccessibilityLabel}
            />
            <CenteredState
              kind={centerState}
              message={offeringsError}
              onRetry={loadOfferings}
            />
            <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
              <ActionNotices purchaseState={purchaseState} restoreState={restoreState} />
              <LegalLinks onOpen={setLegalDocument} />
            </View>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: 22,
              paddingTop: 6,
              paddingBottom: 22,
              flexGrow: 1,
            }}
            showsVerticalScrollIndicator={false}
          >
            <PaywallHeroVisual
              onClose={handleClose}
              onRestore={handleRestore}
              isRestoring={isRestoring}
              disabled={busy}
              closeAccessibilityLabel={closeAccessibilityLabel}
              trialTitle={trialHeroTitle}
              heroImage={heroImage}
            />

            {!trialHighlight ? (
              <Text
                style={{
                  marginTop: 10,
                  fontFamily: theme.fonts.uiMed,
                  fontSize: 12.5,
                  lineHeight: 17,
                  color: theme.colors.textMuted,
                }}
              >
                {trialEligibilityChecking
                  ? t('paywall.trial.checking')
                  : entryContext?.origin === 'planCompleted'
                    ? t('paywall.plans.subtitlePlanCompleted')
                    : t('paywall.plans.subtitleDefault')}
              </Text>
            ) : null}

            <View style={{ gap: 8, marginTop: 8 }}>
              {packages.map((pkg) => {
                const presentation = introPresentations[pkg.product.identifier] ?? null;
                const trialDuration =
                  presentation?.kind === 'free_trial'
                    ? marketingTrialDuration(presentation.terms.duration)
                    : null;
                const title =
                  Platform.OS === 'ios' &&
                  trialDuration?.unit === 'day' &&
                  trialDuration.count === 7
                    ? t('paywall.plans.trialTitle', { plan: packageTitle(pkg) })
                    : packageTitle(pkg);
                const offerLine =
                  Platform.OS === 'ios'
                    ? presentation?.kind === 'free_trial'
                      ? t('paywall.trial.afterTrial')
                      : packagePeriodLabel(pkg)
                    : Platform.OS === 'android' && resolveAndroidTrialSignal(pkg) === 'possible'
                      ? t('paywall.trial.afterTrial')
                      : packagePeriodLabel(pkg);
                const bestValue = pkg.packageType === 'ANNUAL';
                const valueLine =
                  bestValue && pkg.product.pricePerMonthString
                    ? t('paywall.plans.annualValueLine', {
                        price: pkg.product.pricePerMonthString,
                      })
                    : null;
                return (
                  <PackageCard
                    key={pkg.identifier}
                    pkg={pkg}
                    title={title}
                    selected={pkg.identifier === selectedPackage?.identifier}
                    disabled={busy}
                    offerLine={offerLine}
                    bestValue={bestValue}
                    valueLine={valueLine}
                    onSelect={() => setSelectedId(pkg.identifier)}
                  />
                );
              })}
            </View>

            <ActionNotices purchaseState={purchaseState} restoreState={restoreState} />

            <View style={{ marginTop: 'auto', paddingTop: 14 }}>
              {PROMO_CODE_SUPPORTED_PLATFORM && (
                <PromoCodeCard
                  value={promoInput}
                  onChangeValue={setPromoInput}
                  onApply={handleApplyPromoCode}
                  promoState={promoState}
                  purchaseRoute={effectiveRoute}
                  iosPromoNotice={
                    iosOfferingRoute?.kind === 'promotional'
                      ? iosCatalogResolution?.status === 'error'
                        ? { tone: 'error' as const, message: t('paywall.promo.catalogUnavailable') }
                        : selectedIntroText
                      : null
                  }
                  disabled={busy}
                />
              )}
              <CtaButton
                style={PROMO_CODE_SUPPORTED_PLATFORM ? { marginTop: 16 } : undefined}
                onPress={handlePurchase}
                accessibilityState={{
                  disabled:
                    busy ||
                    !effectiveRoute ||
                    effectiveRoute.kind === 'blocked' ||
                    (effectiveRoute.kind === 'ios_promo_package' &&
                      selectedIntroReadiness.status !== 'ready'),
                  busy: isPurchasing,
                }}
                disabled={
                  busy ||
                  !effectiveRoute ||
                  effectiveRoute.kind === 'blocked' ||
                  (effectiveRoute.kind === 'ios_promo_package' &&
                    selectedIntroReadiness.status !== 'ready')
                }
              >
                {isPurchasing ? (
                  <ActivityIndicator color={theme.colors.primaryForeground} />
                ) : (
                  <CtaText>{t('actions.continue')}</CtaText>
                )}
              </CtaButton>
              <Text
                style={{
                  marginTop: 10,
                  fontFamily: theme.fonts.ui,
                  fontSize: 10.5,
                  lineHeight: 15,
                  color: theme.colors.textFaint,
                  textAlign: 'center',
                }}
              >
                {t('paywall.legal.renewalDisclosure')}
              </Text>
              {trialHighlight?.kind === 'android_possible' ? (
                <Text
                  style={{
                    marginTop: 6,
                    fontFamily: theme.fonts.ui,
                    fontSize: 10.5,
                    lineHeight: 15,
                    color: theme.colors.textFaint,
                    textAlign: 'center',
                  }}
                >
                  {t('paywall.legal.androidTrialDisclosure')}
                </Text>
              ) : null}
              <LegalLinks onOpen={setLegalDocument} />
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
      {devOverrideAllowed && !HIDE_DEV_OVERRIDE_ROW ? (
        <DevSubscriptionOverridePickerSheet
          visible={devOverridePickerOpen}
          current={devOverride}
          onSelect={(next) => {
            void setDevOverride(next);
            setDevOverridePickerOpen(false);
          }}
          onDismiss={() => setDevOverridePickerOpen(false)}
        />
      ) : null}
      <LegalDocumentModal document={legalDocument} onClose={() => setLegalDocument(null)} />
    </ScreenBg>
  );
}

/**
 * Dev/QA only — discreet, never mounted outside a development build (see
 * `devOverrideAllowed` above). Deliberately does not attempt to look like a
 * real Paywall feature.
 */
function DevSubscriptionOverrideRow({
  current,
  onPress,
}: {
  current: ReturnType<typeof useDevSubscriptionOverrideContext>['override'];
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Developer Subscription Override, current: ${DEV_OVERRIDE_LABELS[current]}`}
      style={{
        marginHorizontal: 22,
        marginBottom: 8,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 10,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: theme.colors.divider,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      }}
    >
      <View>
        <Text
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: 9.5,
            letterSpacing: 1.4,
            color: theme.colors.textFaint,
          }}
        >
          {current === 'REAL' ? 'DEVELOPER' : 'DEV · SIMULATED SUBSCRIPTION'}
        </Text>
        <Text
          style={{
            fontFamily: theme.fonts.uiSemi,
            fontSize: 12.5,
            color: theme.colors.textMuted,
            marginTop: 2,
          }}
        >
          Subscription Override — {DEV_OVERRIDE_LABELS[current]}
        </Text>
      </View>
      <Icon name="chevron-right" size={16} color={theme.colors.textFaint} />
    </Pressable>
  );
}

function PaywallHeader({
  onClose,
  onRestore,
  isRestoring,
  disabled,
  closeAccessibilityLabel,
  overlay = false,
}: {
  onClose: () => void;
  onRestore: () => void;
  isRestoring: boolean;
  disabled: boolean;
  closeAccessibilityLabel: string;
  overlay?: boolean;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('common');
  return (
    <View
      style={{
        paddingHorizontal: 22,
        paddingTop: 12,
        paddingBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        ...(overlay
          ? { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3 }
          : null),
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={closeAccessibilityLabel}
        onPress={onClose}
        disabled={disabled}
        style={{
          width: 42,
          height: 42,
          borderRadius: 21,
          backgroundColor: overlay ? 'rgba(0,0,0,0.38)' : theme.colors.cardBackgroundElevated,
          borderWidth: 1,
          borderColor: overlay ? 'rgba(255,255,255,0.18)' : theme.colors.divider,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <Icon name="x" size={18} color={overlay ? '#FFFFFF' : theme.colors.textPrimary} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('paywall.header.restoreAccessibilityLabel')}
        onPress={onRestore}
        disabled={disabled}
        hitSlop={8}
        style={{
          paddingVertical: 8,
          paddingHorizontal: overlay ? 12 : 4,
          borderRadius: 18,
          backgroundColor: overlay ? 'rgba(0,0,0,0.38)' : 'transparent',
          opacity: disabled && !isRestoring ? 0.4 : 1,
        }}
      >
        {isRestoring ? (
          <ActivityIndicator size="small" color={overlay ? '#FFFFFF' : theme.colors.textMuted} />
        ) : (
          <Text
            style={{
              fontFamily: theme.fonts.uiSemi,
              fontSize: 13,
              color: overlay ? '#FFFFFF' : theme.colors.textMuted,
            }}
          >
            {t('paywall.header.restore')}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

/**
 * Static, edge-to-edge hero image whose lower gradient merges the photography
 * into the Paywall surface rather than ending on a hard seam.
 */
function PaywallHeroVisual({
  onClose,
  onRestore,
  isRestoring,
  disabled,
  closeAccessibilityLabel,
  trialTitle,
  heroImage,
}: {
  onClose: () => void;
  onRestore: () => void;
  isRestoring: boolean;
  disabled: boolean;
  closeAccessibilityLabel: string;
  trialTitle: string | null;
  heroImage: ReturnType<typeof resolvePaywallHeroImage>;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('common');
  const { width, height } = useWindowDimensions();
  const heroHeight = Math.min(310, Math.max(240, height * 0.32));

  return (
    <View
      style={{
        width,
        height: heroHeight,
        marginHorizontal: -22,
        marginTop: -6,
        overflow: 'hidden',
        backgroundColor: theme.colors.background,
      }}
    >
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={t('paywall.hero.imageAccessibilityLabel')}
        pointerEvents="none"
        style={{ flex: 1 }}
      >
        <Image
          source={heroImage}
          resizeMode="cover"
          accessible={false}
          style={{ width: '100%', height: '100%' }}
        />
      </View>
      <LinearGradient
        pointerEvents="none"
        colors={[
          'rgba(0,0,0,0.42)',
          'rgba(0,0,0,0.04)',
          'rgba(0,0,0,0.62)',
          'rgba(0,0,0,0.84)',
          theme.colors.background,
        ]}
        locations={[0, 0.28, 0.58, 0.82, 1]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <PaywallHeader
        onClose={onClose}
        onRestore={onRestore}
        isRestoring={isRestoring}
        disabled={disabled}
        closeAccessibilityLabel={closeAccessibilityLabel}
        overlay
      />
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: 22, right: 22, bottom: 44 }}
      >
        <MonoLabel color="#FFFFFF" size={9.5}>
          {t('paywall.hero.eyebrow')}
        </MonoLabel>
        <Display size={30} color="#FFFFFF" style={{ marginTop: 4, maxWidth: 310 }}>
          {t('paywall.hero.title')}
        </Display>
        {trialTitle ? (
          <Display size={18} color="#FFFFFF" style={{ marginTop: 5, opacity: 0.9 }}>
            <TrialHeroTitle
              title={trialTitle}
              accentColor={theme.colors.primaryEmphasis}
            />
          </Display>
        ) : null}
      </View>
    </View>
  );
}

function TrialHeroTitle({ title, accentColor }: { title: string; accentColor: string }) {
  const match = title.match(/grátis|gratis|free/i);
  if (!match || match.index === undefined) return title;
  const start = match.index;
  const end = start + match[0].length;
  return (
    <>
      {title.slice(0, start)}
      <Text style={{ color: accentColor, textTransform: 'uppercase' }}>
        {title.slice(start, end)}
      </Text>
      {title.slice(end)}
    </>
  );
}

function PlanCardTitle({ title, accentColor }: { title: string; accentColor: string }) {
  const match = title.match(/grátis|gratis|free/i);
  if (!match || match.index === undefined) return title;
  const start = match.index;
  const end = start + match[0].length;
  return (
    <>
      {title.slice(0, start)}
      <Text style={{ color: accentColor, textTransform: 'uppercase' }}>
        {title.slice(start, end)}
      </Text>
      {title.slice(end)}
    </>
  );
}

/**
 * Compact row (~70px, well above the 44pt touch-target minimum), not the
 * previous ~110px+ card. `offerLine` is the ONLY secondary text — a single
 * short phrase (post-trial note, or the plain period) — deliberately never
 * repeats `packagePriceString(pkg)`, which already renders once on the
 * title row.
 */
function PackageCard({
  pkg,
  title,
  selected,
  disabled,
  offerLine,
  bestValue,
  valueLine,
  onSelect,
}: {
  pkg: PurchasesPackage;
  title: string;
  selected: boolean;
  disabled: boolean;
  offerLine?: string | null;
  bestValue?: boolean;
  valueLine?: string | null;
  onSelect: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('common');
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      onPress={onSelect}
      disabled={disabled}
      style={{
        minHeight: 70,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: selected ? theme.colors.primarySurfaceSelected : theme.colors.cardBackground,
        borderWidth: selected ? 1.5 : 1,
        borderColor: bestValue
          ? theme.colors.primaryEmphasis
          : selected
            ? theme.colors.primaryEmphasis
            : theme.colors.cardBorder,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Text
        style={{
          fontFamily: theme.fonts.monoBold,
          fontSize: 13,
          letterSpacing: -1.2,
          color: selected ? theme.colors.primaryEmphasis : theme.colors.textFaint,
        }}
      >
        {'//'}
      </Text>
      <View style={{ flex: 1 }}>
        {bestValue ? (
          <View
            style={{
              alignSelf: 'flex-start',
              marginBottom: 3,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 6,
              backgroundColor: theme.colors.primaryEmphasis,
            }}
          >
            <Text
              style={{
                fontFamily: theme.fonts.uiBold,
                fontSize: 9,
                letterSpacing: 0.3,
                color: theme.colors.primaryForeground,
              }}
            >
              {t('paywall.plans.bestValueBadge')}
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontFamily: theme.fonts.uiBold,
              fontSize: 14.5,
              lineHeight: 19,
              color: theme.colors.textPrimary,
            }}
          >
            <PlanCardTitle title={title} accentColor={theme.colors.primaryEmphasis} />
          </Text>
          <Text
            style={{
              fontFamily: theme.fonts.monoBold,
              fontSize: 13,
              lineHeight: 19,
              color: selected ? theme.colors.primaryEmphasis : theme.colors.textPrimary,
            }}
          >
            {packagePriceString(pkg)}
          </Text>
        </View>
        {!!valueLine && (
          <Text
            style={{
              marginTop: 2,
              fontFamily: theme.fonts.uiSemi,
              fontSize: 11.5,
              lineHeight: 16,
              color: theme.colors.primaryEmphasis,
            }}
            numberOfLines={1}
          >
            {valueLine}
          </Text>
        )}
        {!!offerLine && (
          <Text
            style={{
              marginTop: 2,
              fontFamily: theme.fonts.uiMed,
              fontSize: 11.5,
              lineHeight: 16,
              color: theme.colors.textMuted,
            }}
            numberOfLines={2}
          >
            {offerLine}
          </Text>
        )}
      </View>
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          borderWidth: 1.5,
          borderColor: selected ? theme.colors.primaryEmphasis : theme.colors.textFaint,
          backgroundColor: 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? (
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: theme.colors.primaryEmphasis,
            }}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * Fase 4C.2 §18 — minimal UX, existing visual language only (`InlineNotice`,
 * `CtaButton`). Copy is deliberately non-committal per §18/§6 — never "você
 * ganhou 7 dias", only "código aplicado" / "oferta promocional disponível"
 * once a real `SubscriptionOption` is actually matched.
 */
function PromoCodeCard({
  value,
  onChangeValue,
  onApply,
  promoState,
  purchaseRoute,
  iosPromoNotice,
  disabled,
}: {
  value: string;
  onChangeValue: (next: string) => void;
  onApply: () => void;
  promoState: PromoCodeState;
  purchaseRoute: EffectivePurchaseRoute | null;
  iosPromoNotice: { tone: 'error' | 'neutral'; message: string; badge?: string | null } | null;
  disabled: boolean;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('common');
  const validating = promoState.phase === 'validating';
  const applied = promoState.phase === 'applied' && promoState.applied;
  // FASE 6.4 — 'package' now also means a resolved Android NEW-shape
  // (offeringIdentifier) promo: `purchaseRoute` here is `effectiveRoute`,
  // which on Android only ever reaches 'package' while a code is applied
  // (`applied` above) when `resolveAndroidPurchaseRoute` successfully
  // resolved the promotional catalog — `resolveAndroidPurchaseRoute`
  // returns 'blocked' for every unresolved/no-authorization case instead.
  const hasMatchedOption =
    purchaseRoute?.kind === 'subscription_option' || purchaseRoute?.kind === 'package';
  // Fase 4C.3 §15/§16: never says the code is invalid — it isn't; the
  // catalog authorized it, but the live RevenueCat/Store catalog can't
  // currently prove the exact promotional offer for the selected plan
  // (sync lag, ambiguous config, or no config at all for that plan). Same
  // reasoning also applies when an iOS promotion cannot be authorized or
  // resolved. Deliberately ONE generic message for every `'blocked'` reason
  // on either platform — never reveals which
  // internal condition applies, same anti-technical-leak principle already
  // used for `validatePromoCode`'s own errors.
  const promoBlockedMessage =
    applied && !iosPromoNotice && purchaseRoute?.kind === 'blocked'
      ? t('paywall.promo.blockedGeneric')
      : null;

  return (
    <View style={{ marginTop: 12 }}>
      <MonoLabel color={theme.colors.textMuted} size={9.5}>
        {t('paywall.promo.label')}
      </MonoLabel>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
        <TextInput
          value={value}
          onChangeText={onChangeValue}
          editable={!disabled && !validating}
          placeholder={t('paywall.promo.placeholder')}
          placeholderTextColor={theme.colors.inputPlaceholder}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel={t('paywall.promo.inputAccessibilityLabel')}
          style={{
            flex: 1,
            height: 42,
            borderRadius: 11,
            borderWidth: 1,
            borderColor: theme.colors.cardBorder,
            backgroundColor: theme.colors.cardBackground,
            paddingHorizontal: 12,
            fontFamily: theme.fonts.uiMed,
            fontSize: 13,
            color: theme.colors.inputText,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('paywall.promo.applyAccessibilityLabel')}
          onPress={onApply}
          disabled={disabled || validating || !value.trim()}
          style={{
            paddingHorizontal: 16,
            height: 42,
            borderRadius: 11,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.controlBackground,
            borderWidth: 1,
            borderColor: theme.colors.divider,
            opacity: disabled || validating || !value.trim() ? 0.5 : 1,
          }}
        >
          {validating ? (
            <ActivityIndicator color={theme.colors.textPrimary} />
          ) : (
            <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.textPrimary }}>
              {t('paywall.promo.applyButton')}
            </Text>
          )}
        </Pressable>
      </View>

      {applied && !iosPromoNotice && (
        <InlineNotice
          tone="neutral"
          text={
            hasMatchedOption
              ? t('paywall.promo.appliedWithOffer')
              : t('paywall.promo.appliedGeneric')
          }
        />
      )}
      {applied && iosPromoNotice && (
        <InlineNotice tone={iosPromoNotice.tone} text={iosPromoNotice.message} />
      )}
      {promoBlockedMessage && <InlineNotice tone="error" text={promoBlockedMessage} />}
      {promoState.phase === 'unavailable' && promoState.message && (
        <InlineNotice tone="error" text={promoState.message} />
      )}
      {promoState.phase === 'locked' && promoState.message && (
        <InlineNotice tone="error" text={promoState.message} />
      )}
      {promoState.phase === 'error' && promoState.message && (
        <InlineNotice tone="error" text={promoState.message} />
      )}
    </View>
  );
}

function ActionNotices({
  purchaseState,
  restoreState,
}: {
  purchaseState: PurchaseUiState;
  restoreState: RestoreUiState;
}) {
  return (
    <>
      {purchaseState.kind === 'cancelled' && (
        <InlineNotice tone="neutral" text="Compra cancelada. Nenhuma cobrança foi realizada." />
      )}
      {purchaseState.kind === 'notice' && (
        <InlineNotice tone="neutral" text={purchaseState.message} />
      )}
      {purchaseState.kind === 'error' && (
        <InlineNotice
          tone="error"
          text={
            purchaseState.offline
              ? 'Sem conexão com a internet. Verifique sua rede e tente novamente.'
              : purchaseState.message
          }
        />
      )}
      {restoreState.kind === 'notice' && (
        <InlineNotice tone="neutral" text={restoreState.message} />
      )}
      {restoreState.kind === 'error' && (
        <InlineNotice
          tone="error"
          text={
            restoreState.offline
              ? 'Sem conexão com a internet. Verifique sua rede e tente novamente.'
              : restoreState.message
          }
        />
      )}
    </>
  );
}

function InlineNotice({ tone, text }: { tone: 'error' | 'neutral'; text: string }) {
  const { theme } = useTheme();
  const error = tone === 'error';
  return (
    <View
      style={{
        marginTop: 14,
        padding: 12,
        borderRadius: 12,
        backgroundColor: error ? theme.colors.feedbackErrorBackgroundSubtle : theme.colors.cardBackgroundElevated,
        borderWidth: 1,
        borderColor: error ? theme.colors.feedbackErrorBorderSubtle : theme.colors.divider,
      }}
    >
      <Text
        style={{
          fontFamily: theme.fonts.uiMed,
          fontSize: 12.5,
          lineHeight: 18,
          color: error ? theme.colors.feedbackErrorTextStrong : theme.colors.textMuted,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

type CenteredStateKind = 'loading' | 'offline' | 'error' | 'empty' | 'unavailable';

function CenteredState({
  kind,
  message,
  onRetry,
}: {
  kind: CenteredStateKind;
  message?: string | null;
  onRetry?: () => void;
}) {
  const { theme } = useTheme();
  const content = {
    loading: {
      title: 'Carregando planos',
      body: 'Buscando as opções disponíveis na loja…',
      retry: false,
    },
    offline: {
      title: 'Sem conexão',
      body: 'Verifique sua internet e tente novamente.',
      retry: true,
    },
    error: {
      title: 'Não foi possível carregar',
      body: message ?? 'Tente novamente em instantes.',
      retry: true,
    },
    empty: {
      title: 'Planos indisponíveis',
      body: 'Nenhum plano foi retornado pelo Offering atual.',
      retry: true,
    },
    unavailable: {
      title: 'Planos indisponíveis',
      body: 'A loja não disponibilizou os planos oficiais neste momento.',
      retry: true,
    },
  }[kind];

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
      <LinearGradient
        colors={theme.gradients.accentState}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: theme.colors.primaryBorderMuted,
        }}
      >
        {kind === 'loading' ? (
          <ActivityIndicator color={theme.colors.primaryEmphasis} />
        ) : (
          <Icon name={kind === 'offline' ? 'alert-triangle' : 'info'} size={28} color={theme.colors.primaryEmphasis} />
        )}
      </LinearGradient>
      <Display size={22} style={{ marginTop: 20, textAlign: 'center' }}>
        {content.title}
      </Display>
      <Text
        style={{
          marginTop: 8,
          fontFamily: theme.fonts.ui,
          fontSize: 13.5,
          lineHeight: 20,
          color: theme.colors.textMuted,
          textAlign: 'center',
        }}
      >
        {content.body}
      </Text>
      {content.retry && onRetry && (
        <Pressable
          onPress={onRetry}
          style={{
            marginTop: 22,
            paddingHorizontal: 22,
            paddingVertical: 12,
            borderRadius: 12,
            backgroundColor: theme.colors.cardBackgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.divider,
          }}
        >
          <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.textPrimary }}>
            Tentar novamente
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function LegalLinks({ onOpen }: { onOpen: (document: LegalDocumentKind) => void }) {
  const { theme } = useTheme();
  const { t } = useTranslation('settings');
  const linkStyle = {
    fontFamily: theme.fonts.uiMed,
    fontSize: 12,
    color: theme.colors.textMuted,
    textDecorationLine: 'underline' as const,
  };
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 10 }}>
      <Pressable onPress={() => onOpen('privacy')}>
        <Text style={linkStyle}>{t('items.privacyPolicy')}</Text>
      </Pressable>
      <Pressable onPress={() => onOpen('terms')}>
        <Text style={linkStyle}>{t('items.termsOfUse')}</Text>
      </Pressable>
    </View>
  );
}
