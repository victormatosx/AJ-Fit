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
import type { PurchasesPackage } from 'react-native-purchases';
import { ScreenBg } from '../components/ui/ScreenBg';
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { Display, MonoLabel } from '../components/ui/Display';
import { FullScreenLoading } from '../components/ui/FullScreenLoading';
import { Icon } from '../components/ui/Icon';
import { useSubscription } from '../hooks/useSubscription';
import { usePromoCode } from '../hooks/usePromoCode';
import {
  buildOfferMatchDiagnostic,
  classifyPurchaseResult,
  classifyRestoreResult,
  describePackageCatalogForDiagnostics,
  getCurrentOfferingPackages,
  packagePeriodLabel,
  packagePriceString,
  packageTitle,
  resolveApplePurchaseRoute,
  resolveAuthorizedAndroidOffer,
  resolveAuthorizedAppleOfferCode,
  resolveOfferingViewState,
  resolvePurchaseRoute,
  resolveSelectedPackage,
  type ApplePurchaseRoute,
  type PurchaseRoute,
} from '../lib/subscriptionOffer';
import { isPromoCodeUiSupported } from '../lib/promoCodePlatform';
import type { PromoCodeState } from '../lib/promoCodeState';
import { PREMIUM_ENTITLEMENT_ID } from '../services/revenueCatService';
import { colors, fonts } from '../theme/tokens';

/**
 * FASE iOS-3 — derived from `isPromoCodeUiSupported` (see its doc comment,
 * src/lib/promoCodePlatform.ts) instead of an inline `Platform.OS ===
 * 'android'` check. iOS now renders the same "CÓDIGO PROMOCIONAL" input as
 * Android (validating an AJ Fit code against the backend is already
 * platform-agnostic since FASE iOS-2); what differs, once a code is applied,
 * is what the CTA does — see `effectiveRoute`/`handlePurchase` below.
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

export function PaywallScreen({
  onClose,
  closeAccessibilityLabel = 'Sair desta conta',
}: {
  onClose: () => void | Promise<void>;
  closeAccessibilityLabel?: string;
}) {
  const {
    offerings,
    offeringsLoading,
    offeringsError,
    offeringsOffline,
    offeringsUnavailable,
    loadOfferings,
    purchase,
    purchaseOption,
    redeemAppleOfferCode,
    restore,
  } = useSubscription();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [purchaseState, setPurchaseState] = useState<PurchaseUiState>({ kind: 'idle' });
  const [restoreState, setRestoreState] = useState<RestoreUiState>({ kind: 'idle' });
  const [closing, setClosing] = useState(false);
  const actionInFlight = useRef(false);
  const closeInFlight = useRef(false);
  const mounted = useRef(true);

  // Fase 4C.2: promo/influencer code. `promoState` is identity-scoped
  // (uid + generation + per-attempt seq) entirely inside `usePromoCode` —
  // see that hook's doc comment. `promoInput` is only the raw text field
  // value; it never feeds authorization decisions on its own.
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

  const packages = useMemo(() => getCurrentOfferingPackages(offerings), [offerings]);
  const selectedPackage = useMemo(
    () => resolveSelectedPackage(packages, selectedId),
    [packages, selectedId],
  );

  useEffect(() => {
    const nextId = selectedPackage?.identifier ?? null;
    if (nextId !== selectedId) setSelectedId(nextId);
  }, [selectedId, selectedPackage]);

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

  // FASE iOS-3 — iOS only, `null` on Android (mirror-image guard of the
  // above). See `resolveApplePurchaseRoute`'s doc comment
  // (lib/subscriptionOffer.ts) for why this is a distinct function/type
  // rather than a shared abstraction with the Android path.
  const appleRoute: ApplePurchaseRoute | null = useMemo(() => {
    if (!selectedPackage || Platform.OS !== 'ios') return null;
    const authorizedOfferCode =
      promoApplied && promoState.applied
        ? resolveAuthorizedAppleOfferCode(selectedPackage, promoState.applied.appleStoreConfig)
        : null;
    return resolveApplePurchaseRoute(selectedPackage, promoApplied, authorizedOfferCode);
  }, [selectedPackage, promoApplied, promoState.applied]);

  /** The route that actually governs the CTA/`handlePurchase` on this platform. */
  const effectiveRoute: PurchaseRoute | ApplePurchaseRoute | null =
    Platform.OS === 'android' ? purchaseRoute : appleRoute;

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

  // FASE 4C.4D — TEMPORARY diagnostic instrumentation for the Android smoke
  // test (remove once the real device catalog shape is confirmed). Dumps the
  // sanitized, commercial-only SubscriptionOption catalog RevenueCat actually
  // returned for every package in the current Offering — independent of
  // whether a promo code was applied, so it captures the raw catalog even if
  // matching never runs. Unconditional `console.info` (not gated on
  // `__DEV__`) so it also surfaces via `adb logcat` on the Closed Testing
  // build under test. See `describePackageCatalogForDiagnostics`'s doc
  // comment (lib/subscriptionOffer.ts) for exactly which fields are included.
  useEffect(() => {
    if (packages.length === 0) return;
    packages.forEach((pkg) => {
      console.info('[RC_OFFER_DEBUG_4C4D] package_catalog', describePackageCatalogForDiagnostics(pkg));
    });
  }, [packages]);

  // FASE 4C.4D — TEMPORARY. Logs the exact match attempt
  // (`findAuthorizedSubscriptionOption`, reused verbatim, never reimplemented
  // here) for the currently selected package once a promo code is applied —
  // re-fires on every plan swap (mensal ⇄ anual) since `selectedPackage`
  // changes. Never logs `couponCode`/`campaignId`/`influencerId` — only the
  // backend-authorized `(basePlanId, offerId)` pair already present in
  // `promoState.applied.androidStoreConfig` and the live SDK candidates.
  useEffect(() => {
    if (!selectedPackage || !promoApplied || !promoState.applied) return;
    const authorizedOffer = resolveAuthorizedAndroidOffer(
      selectedPackage,
      promoState.applied.androidStoreConfig,
    );
    if (!authorizedOffer) {
      console.info('[RC_OFFER_DEBUG_4C4D] no_authorized_offer_for_selected_plan', {
        packageIdentifier: selectedPackage.identifier,
      });
      return;
    }
    const diagnostic = buildOfferMatchDiagnostic(selectedPackage, authorizedOffer);
    console.info('[RC_OFFER_DEBUG_4C4D] expected', diagnostic.expected);
    console.info('[RC_OFFER_DEBUG_4C4D] candidates', diagnostic.candidates);
    console.info('[RC_OFFER_DEBUG_4C4D] result', {
      matched: diagnostic.matched,
      status: diagnostic.status,
    });
  }, [selectedPackage, promoApplied, promoState.applied]);

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
    // Fase 4C.3 §5/§13, extended by FASE iOS-3: `effectiveRoute` is captured
    // here, at the moment the user taps — the exact same route (package,
    // Android SubscriptionOption, or Apple offer-code redemption) this
    // closure captured is what runs, regardless of anything that happens to
    // `promoState` while the action is in flight (`busy` already disables
    // the promo input/apply button and package selector below). A
    // `'blocked'` route is never acted on — the CTA is already disabled for
    // it, this is a second guard, never a silent fallback to
    // `purchase(selectedPackage)`.
    if (!effectiveRoute || effectiveRoute.kind === 'blocked' || actionInFlight.current) return;
    const isAppleRedemption = effectiveRoute.kind === 'offer_redemption';
    actionInFlight.current = true;
    setPurchaseState({ kind: 'purchasing' });
    setRestoreState({ kind: 'idle' });

    try {
      const outcome =
        effectiveRoute.kind === 'package'
          ? await purchase(effectiveRoute.package)
          : effectiveRoute.kind === 'subscription_option'
            ? await purchaseOption(effectiveRoute.option)
            : await redeemAppleOfferCode();
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
          // FASE iOS-3 §Etapa E: after `presentCodeRedemptionSheet()`
          // resolves, StoreKit cannot tell us whether the user actually
          // redeemed anything or just dismissed the sheet — both look
          // identical here (no active entitlement yet). Neither is an error;
          // this covers Etapa E's "dismissed" and "redeemed but CustomerInfo
          // not yet updated" cases with the same honest, non-alarming copy.
          setPurchaseState({
            kind: 'notice',
            message: isAppleRedemption
              ? 'Ainda não identificamos a confirmação da App Store para este código. Se você concluiu o resgate, tente novamente em instantes ou restaure as compras.'
              : 'A compra foi processada, mas o acesso Premium ainda não foi identificado. Tente restaurar as compras.',
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
  }, [purchase, purchaseOption, redeemAppleOfferCode, effectiveRoute]);

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
                disabled={busy}
              />
            )}

            <ActionNotices purchaseState={purchaseState} restoreState={restoreState} />

            <View style={{ marginTop: 'auto', paddingTop: 24 }}>
              <CtaButton
                onPress={handlePurchase}
                disabled={busy || !effectiveRoute || effectiveRoute.kind === 'blocked'}
              >
                {isPurchasing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <CtaText>
                    {effectiveRoute?.kind === 'offer_redemption' ? 'Resgatar na App Store' : 'Continuar'}
                  </CtaText>
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
  onSelect,
}: {
  pkg: PurchasesPackage;
  selected: boolean;
  disabled: boolean;
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
  disabled,
}: {
  value: string;
  onChangeValue: (next: string) => void;
  onApply: () => void;
  promoState: PromoCodeState;
  purchaseRoute: PurchaseRoute | ApplePurchaseRoute | null;
  disabled: boolean;
}) {
  const validating = promoState.phase === 'validating';
  const applied = promoState.phase === 'applied' && promoState.applied;
  const hasMatchedOption = purchaseRoute?.kind === 'subscription_option';
  // FASE iOS-3 §Etapa D: the offer code itself is shown to the user because
  // `presentCodeRedemptionSheet()` never receives it programmatically (see
  // `revenueCatService.ts`'s `redeemOfferCode` doc comment) — the user must
  // recognize/select this exact code inside Apple's own sheet.
  const appleOfferCode = purchaseRoute?.kind === 'offer_redemption' ? purchaseRoute.offerCode : null;
  // Fase 4C.3 §15/§16: never says the code is invalid — it isn't; the
  // catalog authorized it, but the live RevenueCat/Store catalog can't
  // currently prove the exact promotional offer for the selected plan
  // (sync lag, ambiguous config, or no config at all for that plan). Same
  // reasoning applies to the Apple `'blocked'` case (no offer code
  // configured for the selected plan). Deliberately ONE generic message for
  // every `'blocked'` reason on either platform — never reveals which
  // internal condition applies, same anti-technical-leak principle already
  // used for `validatePromoCode`'s own errors.
  const promoBlockedMessage =
    applied && purchaseRoute?.kind === 'blocked'
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

      {applied && (
        <InlineNotice
          tone="neutral"
          text={
            appleOfferCode
              ? // FASE iOS-3 §Etapa D: no "7 dias grátis" promise here — the
                // App Store, not this app, confirms eligibility. Names the
                // code so the user recognizes it inside Apple's own sheet.
                `Código aplicado. Toque em "Resgatar na App Store" para abrir a tela oficial da Apple e usar o código ${appleOfferCode}. A elegibilidade é confirmada pela própria App Store.`
              : hasMatchedOption
                ? 'Código aplicado. Oferta promocional disponível.'
                : 'Código aplicado.'
          }
        />
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
