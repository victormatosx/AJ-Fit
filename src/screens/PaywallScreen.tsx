import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import type { PurchasesPackage } from 'react-native-purchases';
import { ScreenBg } from '../components/ui/ScreenBg';
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { Display, MonoLabel } from '../components/ui/Display';
import { FullScreenLoading } from '../components/ui/FullScreenLoading';
import { Icon } from '../components/ui/Icon';
import { useSubscription } from '../hooks/useSubscription';
import { usePromoCode } from '../hooks/usePromoCode';
import {
  classifyPurchaseResult,
  classifyRestoreResult,
  getCurrentOfferingPackages,
  packagePeriodLabel,
  packagePriceString,
  packageTitle,
  resolveAuthorizedAndroidOffer,
  resolveIOSOfferingRoute,
  resolveIOSPlanKind,
  resolveIOSPromotionalCatalog,
  resolveOfferingViewState,
  resolvePurchaseRoute,
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
  normalizeIntroEligibilityForDiagnostic,
  type SubscriptionPurchaseContext,
} from '../lib/subscriptionDiagnostics';
import {
  checkIOSIntroEligibility,
  PREMIUM_ENTITLEMENT_ID,
} from '../services/revenueCatService';
import { authorizePromoPurchase } from '../services/promoCodeService';
import { colors, fonts } from '../theme/tokens';

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

// Existing legal destinations from the previous real RevenueCat screen.
const PRIVACY_POLICY_URL = 'https://ajfit.com.br/privacidade';
const TERMS_OF_USE_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

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
}: {
  onClose: () => void | Promise<void>;
  closeAccessibilityLabel?: string;
}) {
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
  const packages = useMemo(() => {
    if (iosOfferingRoute?.kind !== 'promotional') return standardPackages;
    if (iosCatalogResolution?.status !== 'resolved') return [];
    return [iosCatalogResolution.monthlyPackage, iosCatalogResolution.annualPackage];
  }, [iosCatalogResolution, iosOfferingRoute, standardPackages]);
  const selectedPackage = useMemo(
    () => resolveSelectedPackage(packages, selectedId),
    [packages, selectedId],
  );

  const eligibilityScopeKey = useMemo(() => {
    if (
      iosCatalogResolution?.status !== 'resolved' ||
      !promoState.applied
    ) {
      return null;
    }
    return [
      promoState.applied.uid,
      promoState.applied.generation,
      promoState.applied.code,
      iosCatalogResolution.route.authorization.offeringIdentifier,
      iosCatalogResolution.monthlyPackage.product.identifier,
      iosCatalogResolution.annualPackage.product.identifier,
    ].join('\u001f');
  }, [iosCatalogResolution, promoState.applied]);

  const [iosEligibilitySnapshot, setIOSEligibilitySnapshot] = useState<{
    scopeKey: string | null;
    byProductId: Record<string, IOSIntroEligibilityState>;
  }>({ scopeKey: null, byProductId: {} });

  useEffect(() => {
    const seq = ++eligibilityRequestSeq.current;
    if (!eligibilityScopeKey || iosCatalogResolution?.status !== 'resolved') {
      setIOSEligibilitySnapshot({ scopeKey: null, byProductId: {} });
      return;
    }
    const productIds = [
      iosCatalogResolution.monthlyPackage.product.identifier,
      iosCatalogResolution.annualPackage.product.identifier,
    ];
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
        [
          iosCatalogResolution.monthlyPackage,
          iosCatalogResolution.annualPackage,
        ].forEach((pkg) => {
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
        [
          iosCatalogResolution.monthlyPackage,
          iosCatalogResolution.annualPackage,
        ].forEach((pkg) => {
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
  }, [eligibilityScopeKey, iosCatalogResolution]);

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
    console.warn(`[promoCode] ${iosCatalogResolution.reason}`);
  }, [iosCatalogResolution, iosOfferingRoute]);

  useEffect(() => {
    const nextId = selectedPackage?.identifier ?? null;
    if (nextId !== selectedId) setSelectedId(nextId);
  }, [selectedId, selectedPackage]);

  const introPresentations = useMemo<Record<string, IOSIntroOfferPresentation>>(
    () =>
      Object.fromEntries(
        packages.map((pkg) => [
          pkg.product.identifier,
          resolveIOSIntroOfferPresentation(
            pkg,
            eligibilityScopeKey && iosEligibilitySnapshot.scopeKey === eligibilityScopeKey
              ? iosEligibilitySnapshot.byProductId[pkg.product.identifier] ?? { status: 'unknown' }
              : iosOfferingRoute?.kind === 'promotional'
                ? { status: 'checking' }
                : { status: 'idle' },
          ),
        ]),
      ),
    [eligibilityScopeKey, iosEligibilitySnapshot, iosOfferingRoute, packages],
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
        const keyByUnit = {
          day: 'paywall.promo.duration.day',
          week: 'paywall.promo.duration.week',
          month: 'paywall.promo.duration.month',
          year: 'paywall.promo.duration.year',
        } as const;
        const duration = t(keyByUnit[presentation.terms.duration.unit], {
          count: presentation.terms.duration.count,
        });
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

  // Fase 4C.3 §4/§6: the single source of truth for "what does the CTA
  // actually do" — derived fresh from `selectedPackage`/`promoState.applied`
  // on every render, never cached, so a plan switch (mensal ⇄ anual) or a
  // code swap invalidates itself automatically (see
  // `resolveAuthorizedAndroidOffer`'s/`resolvePurchaseRoute`'s doc
  // comments, subscriptionOffer.ts). `null` only when there's no package
  // selected yet (Offerings still loading/empty) — the CTA is already
  // disabled in that state.
  const promoApplied = PROMO_CODE_SUPPORTED_PLATFORM && promoState.phase === 'applied' && promoState.applied !== null;

  // Android only — `null` on iOS (guarded so `promoState.applied.androidStoreConfig`,
  // which is always `null` for an iOS-platform validation response per the
  // backend contract, is never fed into Android's live-catalog matching).
  const purchaseRoute: PurchaseRoute | null = useMemo(() => {
    if (!selectedPackage || Platform.OS !== 'android') return null;
    const authorizedOffer =
      promoApplied && promoState.applied
        ? resolveAuthorizedAndroidOffer(selectedPackage, promoState.applied.androidStoreConfig)
        : null;
    return resolvePurchaseRoute(selectedPackage, promoApplied, authorizedOffer);
  }, [selectedPackage, promoApplied, promoState.applied]);

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

  const iosPurchaseDiagnosticContext = useMemo<SubscriptionPurchaseContext | null>(() => {
    if (Platform.OS !== 'ios' || !effectiveRoute || effectiveRoute.kind === 'blocked') return null;
    if (effectiveRoute.kind === 'ios_promo_package') {
      return { route: 'promo', plan: effectiveRoute.attempt.plan };
    }
    if (effectiveRoute.kind !== 'package') return null;
    const plan = resolveIOSPlanKind(effectiveRoute.package);
    return plan ? { route: 'standard', plan } : null;
  }, [effectiveRoute]);

  useEffect(() => {
    if (!iosPurchaseDiagnosticContext) return;
    logSubscriptionDiagnostic({
      event: 'subscription_purchase_route_resolved',
      ...iosPurchaseDiagnosticContext,
    });
  }, [iosPurchaseDiagnosticContext?.plan, iosPurchaseDiagnosticContext?.route]);

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
      console.info('[promoCode] promo_option_match');
    } else if (purchaseRoute.kind === 'blocked') {
      if (purchaseRoute.reason === 'promo_ambiguous') {
        console.warn('[promoCode] promo_option_ambiguous');
      } else {
        console.info(`[promoCode] ${purchaseRoute.reason}`);
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
            console.warn(
              execution.reason === 'expired'
                ? '[promoCode] promo_purchase_intent_expired'
                : '[promoCode] promo_purchase_intent_mismatch',
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
        if (effectiveRoute.kind === 'package' && iosPurchaseDiagnosticContext) {
          logSubscriptionDiagnostic({
            event: 'subscription_purchase_started',
            ...iosPurchaseDiagnosticContext,
          });
        }
        outcome = effectiveRoute.kind === 'package'
          ? await purchase(effectiveRoute.package)
          : await purchaseOption(effectiveRoute.option);
      }
      if (iosPurchaseDiagnosticContext) {
        logSubscriptionPurchaseOutcome(
          iosPurchaseDiagnosticContext,
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
    iosPurchaseDiagnosticContext,
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

  const openLink = useCallback((url: string) => {
    Linking.openURL(url).catch((err) =>
      console.error('[paywallScreen] falha ao abrir link', { url, err }),
    );
  }, []);

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
        <PaywallHeader
          onClose={handleClose}
          disabled={busy}
          accessibilityLabel={closeAccessibilityLabel}
        />

        {centerState ? (
          <View style={{ flex: 1 }}>
            <CenteredState
              kind={centerState}
              message={offeringsError}
              onRetry={loadOfferings}
            />
            <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
              <RestoreButton
                isRestoring={isRestoring}
                disabled={busy}
                onPress={handleRestore}
              />
              <ActionNotices purchaseState={purchaseState} restoreState={restoreState} />
              <LegalLinks openLink={openLink} />
            </View>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: 22,
              paddingTop: 18,
              paddingBottom: 22,
              flexGrow: 1,
            }}
            showsVerticalScrollIndicator={false}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <LinearGradient
                colors={['rgba(11,112,249,0.3)', 'rgba(11,112,249,0.08)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: 'rgba(77,163,255,0.4)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="crown" size={22} color={colors.accentHi} />
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <MonoLabel color={colors.accentHi}>AJ FIT PREMIUM</MonoLabel>
                <Display size={27} style={{ marginTop: 4 }}>
                  Escolha seu plano
                </Display>
              </View>
            </View>

            <Text
              style={{
                marginTop: 14,
                fontFamily: fonts.ui,
                fontSize: 14,
                lineHeight: 21,
                color: colors.mute,
              }}
            >
              Selecione uma das opções disponíveis para liberar todos os recursos do AJ Fit.
            </Text>

            <View style={{ gap: 10, marginTop: 24 }}>
              {packages.map((pkg) => (
                <PackageCard
                  key={pkg.identifier}
                  pkg={pkg}
                  selected={pkg.identifier === selectedPackage?.identifier}
                  disabled={busy}
                  promotionalTerms={
                    iosOfferingRoute?.kind === 'promotional'
                      ? introText(introPresentations[pkg.product.identifier] ?? null, pkg)?.badge
                      : null
                  }
                  onSelect={() => setSelectedId(pkg.identifier)}
                />
              ))}
            </View>

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

            <ActionNotices purchaseState={purchaseState} restoreState={restoreState} />

            <View style={{ marginTop: 'auto', paddingTop: 24 }}>
              <CtaButton
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
                  <ActivityIndicator color="#fff" />
                ) : (
                  <CtaText>Continuar</CtaText>
                )}
              </CtaButton>
              <RestoreButton
                isRestoring={isRestoring}
                disabled={busy}
                onPress={handleRestore}
              />
              <LegalLinks openLink={openLink} />
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </ScreenBg>
  );
}

function PaywallHeader({
  onClose,
  disabled,
  accessibilityLabel,
}: {
  onClose: () => void;
  disabled: boolean;
  accessibilityLabel: string;
}) {
  return (
    <View
      style={{
        paddingHorizontal: 22,
        paddingTop: 12,
        paddingBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onClose}
        disabled={disabled}
        style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          backgroundColor: colors.cardBgHi,
          borderWidth: 1,
          borderColor: colors.hair,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <Icon name="x" size={18} color="#fff" />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <MonoLabel>ASSINATURA</MonoLabel>
      </View>
      <View style={{ width: 42 }} />
    </View>
  );
}

function PackageCard({
  pkg,
  selected,
  disabled,
  promotionalTerms,
  onSelect,
}: {
  pkg: PurchasesPackage;
  selected: boolean;
  disabled: boolean;
  promotionalTerms?: string | null;
  onSelect: () => void;
}) {
  const period = packagePeriodLabel(pkg);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      onPress={onSelect}
      disabled={disabled}
      style={{
        minHeight: 76,
        paddingVertical: 16,
        paddingHorizontal: 16,
        borderRadius: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        backgroundColor: selected ? 'rgba(11,112,249,0.13)' : colors.cardBg,
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? colors.accentHi : colors.cardBorder,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: 1.5,
          borderColor: selected ? colors.accentHi : colors.faint,
          backgroundColor: selected ? colors.accent : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected && <Icon name="check" size={13} color="#fff" />}
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: fonts.uiBold,
            fontSize: 15,
            color: colors.text,
          }}
        >
          {packageTitle(pkg)}
        </Text>
        {!!period && (
          <Text
            style={{
              marginTop: 4,
              fontFamily: fonts.ui,
              fontSize: 12,
              color: colors.mute,
            }}
          >
            {period}
          </Text>
        )}
        {!!promotionalTerms && (
          <Text
            style={{
              marginTop: 5,
              fontFamily: fonts.uiSemi,
              fontSize: 12,
              lineHeight: 17,
              color: colors.accentHi,
            }}
          >
            {promotionalTerms}
          </Text>
        )}
      </View>
      <Text
        style={{
          fontFamily: fonts.monoBold,
          fontSize: 13,
          color: selected ? colors.accentHi : colors.text,
          textAlign: 'right',
        }}
      >
        {packagePriceString(pkg)}
      </Text>
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
  const validating = promoState.phase === 'validating';
  const applied = promoState.phase === 'applied' && promoState.applied;
  const hasMatchedOption = purchaseRoute?.kind === 'subscription_option';
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
      ? 'Não foi possível disponibilizar esta oferta promocional no momento para o plano selecionado. Tente novamente ou escolha outro plano.'
      : null;

  return (
    <View style={{ marginTop: 18 }}>
      <MonoLabel color={colors.mute}>CÓDIGO PROMOCIONAL</MonoLabel>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
        <TextInput
          value={value}
          onChangeText={onChangeValue}
          editable={!disabled && !validating}
          placeholder="Ex.: ARNALDO"
          placeholderTextColor={colors.faint}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel="Código promocional"
          style={{
            flex: 1,
            height: 46,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.cardBorder,
            backgroundColor: colors.cardBg,
            paddingHorizontal: 14,
            fontFamily: fonts.uiMed,
            fontSize: 14,
            color: colors.text,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Aplicar código promocional"
          onPress={onApply}
          disabled={disabled || validating || !value.trim()}
          style={{
            paddingHorizontal: 18,
            height: 46,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.cardBgHi,
            borderWidth: 1,
            borderColor: colors.hair,
            opacity: disabled || validating || !value.trim() ? 0.5 : 1,
          }}
        >
          {validating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: '#fff' }}>Aplicar</Text>
          )}
        </Pressable>
      </View>

      {applied && !iosPromoNotice && (
        <InlineNotice
          tone="neutral"
          text={
            hasMatchedOption
              ? 'Código aplicado. Oferta promocional disponível.'
              : 'Código aplicado.'
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

function RestoreButton({
  isRestoring,
  disabled,
  onPress,
}: {
  isRestoring: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <CtaButton ghost onPress={onPress} disabled={disabled} style={{ marginTop: 12 }}>
      {isRestoring ? <ActivityIndicator color="#fff" /> : 'Restaurar compras'}
    </CtaButton>
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
  const error = tone === 'error';
  return (
    <View
      style={{
        marginTop: 14,
        padding: 12,
        borderRadius: 12,
        backgroundColor: error ? 'rgba(255,118,118,0.08)' : colors.cardBgHi,
        borderWidth: 1,
        borderColor: error ? 'rgba(255,118,118,0.3)' : colors.hair,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.uiMed,
          fontSize: 12.5,
          lineHeight: 18,
          color: error ? '#ff7676' : colors.mute,
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
        colors={['rgba(11,112,249,0.28)', 'rgba(11,112,249,0.05)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: 'rgba(11,112,249,0.4)',
        }}
      >
        {kind === 'loading' ? (
          <ActivityIndicator color={colors.accentHi} />
        ) : (
          <Icon name={kind === 'offline' ? 'alert-triangle' : 'info'} size={28} color={colors.accentHi} />
        )}
      </LinearGradient>
      <Display size={22} style={{ marginTop: 20, textAlign: 'center' }}>
        {content.title}
      </Display>
      <Text
        style={{
          marginTop: 8,
          fontFamily: fonts.ui,
          fontSize: 13.5,
          lineHeight: 20,
          color: colors.mute,
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
            backgroundColor: colors.cardBgHi,
            borderWidth: 1,
            borderColor: colors.hair,
          }}
        >
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: '#fff' }}>
            Tentar novamente
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function LegalLinks({ openLink }: { openLink: (url: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 22, marginTop: 20 }}>
      <Pressable onPress={() => openLink(PRIVACY_POLICY_URL)}>
        <Text style={linkStyle}>Política de Privacidade</Text>
      </Pressable>
      <Pressable onPress={() => openLink(TERMS_OF_USE_URL)}>
        <Text style={linkStyle}>Termos de Uso</Text>
      </Pressable>
    </View>
  );
}

const linkStyle = {
  fontFamily: fonts.uiMed,
  fontSize: 12,
  color: colors.mute,
  textDecorationLine: 'underline' as const,
};
