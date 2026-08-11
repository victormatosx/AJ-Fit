import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { PurchasesPackage } from 'react-native-purchases';
import { ScreenBg } from '../components/ui/ScreenBg';
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { Display, MonoLabel } from '../components/ui/Display';
import { FullScreenLoading } from '../components/ui/FullScreenLoading';
import { Icon } from '../components/ui/Icon';
import { useSubscription } from '../hooks/useSubscription';
import {
  classifyPurchaseResult,
  classifyRestoreResult,
  getCurrentOfferingPackages,
  packagePeriodLabel,
  packagePriceString,
  packageTitle,
  resolveOfferingViewState,
  resolveSelectedPackage,
} from '../lib/subscriptionOffer';
import { PREMIUM_ENTITLEMENT_ID } from '../services/revenueCatService';
import { colors, fonts } from '../theme/tokens';

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
    restore,
  } = useSubscription();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [purchaseState, setPurchaseState] = useState<PurchaseUiState>({ kind: 'idle' });
  const [restoreState, setRestoreState] = useState<RestoreUiState>({ kind: 'idle' });
  const [closing, setClosing] = useState(false);
  const actionInFlight = useRef(false);
  const closeInFlight = useRef(false);
  const mounted = useRef(true);

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
    if (!selectedPackage || actionInFlight.current) return;
    actionInFlight.current = true;
    setPurchaseState({ kind: 'purchasing' });
    setRestoreState({ kind: 'idle' });

    try {
      const outcome = await purchase(selectedPackage);
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
            message:
              'A compra foi processada, mas o acesso Premium ainda não foi identificado. Tente restaurar as compras.',
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
  }, [purchase, selectedPackage]);

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

            <ActionNotices purchaseState={purchaseState} restoreState={restoreState} />

            <View style={{ marginTop: 'auto', paddingTop: 24 }}>
              <CtaButton onPress={handlePurchase} disabled={busy || !selectedPackage}>
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
