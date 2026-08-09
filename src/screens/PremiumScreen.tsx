import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { PurchasesPackage } from 'react-native-purchases';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, MonoLabel } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { colors, fonts } from '../theme/tokens';
import { useSubscription } from '../hooks/useSubscription';

/**
 * Apple requires these to be reachable from any purchase flow. No such URLs
 * existed anywhere in the project before this screen — confirmed with
 * product before hardcoding them here.
 */
const PRIVACY_POLICY_URL = 'https://ajfit.com.br/privacidade';
const TERMS_OF_USE_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

type PurchaseUiState =
  | { kind: 'idle' }
  | { kind: 'purchasing' }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string; offline: boolean };

type RestoreUiState =
  | { kind: 'idle' }
  | { kind: 'restoring' }
  | { kind: 'notice'; message: string }
  | { kind: 'error'; message: string; offline: boolean };

const OFFERINGS_UNAVAILABLE_ALERT_TITLE = 'Assinaturas em aprovação';
const OFFERINGS_UNAVAILABLE_MESSAGE =
  'As assinaturas Premium do AJ Fit estão aguardando aprovação da App Store. ' +
  'Assim que forem aprovadas, os preços oficiais serão exibidos automaticamente e será possível concluir sua assinatura normalmente.';
const OFFERINGS_UNAVAILABLE_RESTORE_NOTICE =
  'Ainda não há assinaturas para restaurar enquanto aguardamos a aprovação da App Store. ' +
  'Isso será atualizado automaticamente assim que as assinaturas forem aprovadas.';

/**
 * Placeholder plan rows shown only while `offeringsUnavailable` is true
 * (RevenueCat CONFIGURATION_ERROR / code 23 — see revenueCatService.ts).
 * Purely presentational: no price, no product id, never used to attempt a
 * purchase. Disappears automatically the moment `loadOfferings()` succeeds.
 */
const FALLBACK_PLANS: { id: string; title: string; best?: boolean }[] = [
  { id: 'fallback-monthly', title: 'Mensal' },
  { id: 'fallback-annual', title: 'Anual', best: true },
];

function periodLabel(pkg: PurchasesPackage): string {
  switch (pkg.packageType) {
    case 'ANNUAL':
      return '/ano';
    case 'MONTHLY':
      return '/mês';
    case 'WEEKLY':
      return '/semana';
    case 'SIX_MONTH':
      return '/semestre';
    case 'THREE_MONTH':
      return '/trimestre';
    case 'TWO_MONTH':
      return '/2 meses';
    default:
      return '';
  }
}

function planTitle(pkg: PurchasesPackage): string {
  switch (pkg.packageType) {
    case 'ANNUAL':
      return 'Anual';
    case 'MONTHLY':
      return 'Mensal';
    case 'WEEKLY':
      return 'Semanal';
    case 'SIX_MONTH':
      return 'Semestral';
    case 'THREE_MONTH':
      return 'Trimestral';
    case 'TWO_MONTH':
      return 'Bimestral';
    default:
      return pkg.product.title;
  }
}

function trialLabel(pkg: PurchasesPackage): string | null {
  const intro = pkg.product.introPrice;
  if (!intro || intro.price !== 0) return null;
  const unit = { DAY: 'dia', WEEK: 'semana', MONTH: 'mês', YEAR: 'ano' }[intro.periodUnit] ?? intro.periodUnit;
  const n = intro.periodNumberOfUnits;
  const plural = n === 1 ? unit : `${unit}s`;
  return `${n} ${plural} grátis`;
}

export function PremiumScreen({ onDone }: { onDone: () => void }) {
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

  useEffect(() => {
    loadOfferings();
  }, [loadOfferings]);

  const packages = useMemo(() => {
    const all = offerings?.current?.availablePackages ?? [];
    // V1 only sells Mensal/Anual (docs/13_assinaturas_e_billing.md §4) — any
    // other package type configured in the dashboard is ignored here, not
    // hidden by mistake: this list is exhaustive for what this screen shows.
    return all.filter((p) => p.packageType === 'ANNUAL' || p.packageType === 'MONTHLY');
  }, [offerings]);

  useEffect(() => {
    if (offeringsUnavailable) {
      if (!selectedId || !FALLBACK_PLANS.some((p) => p.id === selectedId)) {
        setSelectedId('fallback-annual');
      }
      return;
    }
    if (packages.length === 0) return;
    if (selectedId && packages.some((p) => p.identifier === selectedId)) return;
    const preferred = packages.find((p) => p.packageType === 'ANNUAL') ?? packages[0];
    setSelectedId(preferred.identifier);
  }, [packages, selectedId, offeringsUnavailable]);

  const selectedPackage = offeringsUnavailable
    ? null
    : packages.find((p) => p.identifier === selectedId) ?? null;

  const handlePurchase = useCallback(async () => {
    if (offeringsUnavailable) {
      Alert.alert(OFFERINGS_UNAVAILABLE_ALERT_TITLE, OFFERINGS_UNAVAILABLE_MESSAGE, [{ text: 'Entendi' }]);
      return;
    }
    if (!selectedPackage || purchaseState.kind === 'purchasing') return;
    setPurchaseState({ kind: 'purchasing' });
    const outcome = await purchase(selectedPackage);
    if (outcome.status === 'purchased') {
      setPurchaseState({ kind: 'idle' });
      Alert.alert('Assinatura confirmada', 'Sua assinatura AJ Premium foi ativada com sucesso.', [
        { text: 'Continuar', onPress: onDone },
      ]);
      return;
    }
    if (outcome.status === 'cancelled') {
      setPurchaseState({ kind: 'cancelled' });
      return;
    }
    setPurchaseState({ kind: 'error', message: outcome.message, offline: outcome.offline });
  }, [offeringsUnavailable, selectedPackage, purchase, purchaseState.kind, onDone]);

  const handleRestore = useCallback(async () => {
    if (restoreState.kind === 'restoring') return;
    setRestoreState({ kind: 'restoring' });
    const outcome = await restore();
    if (outcome.status === 'restored') {
      setRestoreState({ kind: 'idle' });
      if (outcome.hasPremium) {
        Alert.alert('Compra restaurada', 'Sua assinatura AJ Premium foi restaurada com sucesso.', [
          { text: 'Continuar', onPress: onDone },
        ]);
      } else {
        Alert.alert('Nada para restaurar', 'Não encontramos nenhuma assinatura ativa para esta conta.');
      }
      return;
    }
    if (outcome.offeringsUnavailable) {
      // Expected while Apple hasn't approved the subscriptions yet — not a
      // real failure, so no red/error UI (the SDK-level classification +
      // suppression lives in revenueCatService.ts).
      setRestoreState({ kind: 'notice', message: OFFERINGS_UNAVAILABLE_RESTORE_NOTICE });
      return;
    }
    setRestoreState({ kind: 'error', message: outcome.message, offline: outcome.offline });
  }, [restore, restoreState.kind, onDone]);

  const openLink = useCallback((url: string) => {
    Linking.openURL(url).catch((err) => console.error('[premiumScreen] falha ao abrir link', { url, err }));
  }, []);

  const isPurchasing = purchaseState.kind === 'purchasing';
  const isRestoring = restoreState.kind === 'restoring';
  const busy = isPurchasing || isRestoring;

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <PremiumHeader onBack={onDone} disabled={busy} />

        {offeringsLoading && !offerings && !offeringsUnavailable && <CenteredState kind="loading" />}

        {!offeringsLoading && offeringsError && !offerings && !offeringsUnavailable && (
          <CenteredState
            kind={offeringsOffline ? 'offline' : 'error'}
            message={offeringsError}
            onRetry={loadOfferings}
          />
        )}

        {!offeringsLoading && !offeringsError && !offeringsUnavailable && offerings && packages.length === 0 && (
          <CenteredState kind="empty" onRetry={loadOfferings} />
        )}

        {(offeringsUnavailable || (offerings && packages.length > 0)) && (
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24, flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 14,
                  backgroundColor: 'rgba(11,112,249,0.16)',
                  borderWidth: 1,
                  borderColor: 'rgba(11,112,249,0.4)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="crown" size={22} color={colors.accentHi} />
              </View>
              <View style={{ flex: 1 }}>
                <MonoLabel color={colors.accentHi}>AJ FIT PREMIUM</MonoLabel>
                <Display size={26} style={{ marginTop: 4 }}>
                  Desbloqueie tudo
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
              Treinos personalizados, evolução física e acompanhamento completo com o método AJ.
            </Text>

            <View style={{ gap: 10, marginTop: 26 }}>
              {offeringsUnavailable
                ? FALLBACK_PLANS.map((plan) => (
                    <FallbackPlanCard
                      key={plan.id}
                      title={plan.title}
                      best={plan.best}
                      selected={plan.id === selectedId}
                      onSelect={() => setSelectedId(plan.id)}
                    />
                  ))
                : packages.map((pkg) => (
                    <PlanCard
                      key={pkg.identifier}
                      pkg={pkg}
                      selected={pkg.identifier === selectedId}
                      onSelect={() => setSelectedId(pkg.identifier)}
                    />
                  ))}
            </View>

            {purchaseState.kind === 'cancelled' && (
              <InlineNotice tone="neutral" text="Compra cancelada." />
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

            <CtaButton
              onPress={handlePurchase}
              disabled={busy || (!offeringsUnavailable && !selectedPackage)}
              style={{ marginTop: 22 }}
            >
              {isPurchasing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <CtaText>{offeringsUnavailable ? 'Aguardando aprovação' : 'Assinar agora'}</CtaText>
              )}
            </CtaButton>

            <CtaButton ghost onPress={handleRestore} disabled={busy} style={{ marginTop: 12 }}>
              {isRestoring ? (
                <ActivityIndicator color="#fff" />
              ) : (
                'Restaurar compras'
              )}
            </CtaButton>

            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 22, marginTop: 22 }}>
              <Pressable onPress={() => openLink(PRIVACY_POLICY_URL)}>
                <Text style={linkStyle}>Política de Privacidade</Text>
              </Pressable>
              <Pressable onPress={() => openLink(TERMS_OF_USE_URL)}>
                <Text style={linkStyle}>Termos de Uso</Text>
              </Pressable>
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </ScreenBg>
  );
}

const linkStyle = {
  fontFamily: fonts.uiMed,
  fontSize: 12,
  color: 'rgba(255,255,255,0.55)',
  textDecorationLine: 'underline' as const,
};

/**
 * Same in-flow header row used by SettingsScreen/EditProfileScreen/
 * AssessmentScreen for every screen AppShell opens as an overlay — a normal
 * flex sibling above the scrollable content, not a floating absolutely
 * positioned button. The previous floating-button version was the reason
 * the close action was unreliable: it lived outside the layout flow and
 * could end up under the ScrollView/CenteredState siblings depending on
 * platform stacking behavior.
 */
function PremiumHeader({ onBack, disabled }: { onBack: () => void; disabled: boolean }) {
  return (
    <View
      style={{
        paddingHorizontal: 22,
        paddingBottom: 8,
        paddingTop: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Pressable
        onPress={onBack}
        disabled={disabled}
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          backgroundColor: 'rgba(255,255,255,0.05)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.09)',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <Icon name="x" size={17} color="#fff" />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <MonoLabel>PREMIUM</MonoLabel>
      </View>
      <View style={{ width: 38 }} />
    </View>
  );
}

function PlanCard({
  pkg,
  selected,
  onSelect,
}: {
  pkg: PurchasesPackage;
  selected: boolean;
  onSelect: () => void;
}) {
  const trial = trialLabel(pkg);
  const best = pkg.packageType === 'ANNUAL';
  return (
    <Pressable
      onPress={onSelect}
      style={{
        position: 'relative',
        paddingVertical: 18,
        paddingHorizontal: 18,
        borderRadius: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: selected ? 'rgba(11,112,249,0.12)' : 'rgba(255,255,255,0.04)',
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? colors.accent : 'rgba(255,255,255,0.1)',
        shadowColor: selected ? colors.accent : 'transparent',
        shadowOpacity: selected ? 0.28 : 0,
        shadowRadius: selected ? 24 : 0,
        shadowOffset: { width: 0, height: 0 },
        elevation: selected ? 8 : 0,
      }}
    >
      {best && (
        <View
          style={{
            position: 'absolute',
            top: -10,
            right: 16,
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 7,
            backgroundColor: colors.accent,
          }}
        >
          <Text style={{ fontFamily: fonts.monoBold, fontSize: 9.5, letterSpacing: 1, color: '#fff' }}>
            MELHOR VALOR
          </Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: fonts.display,
            fontSize: 19,
            color: '#fff',
            textTransform: 'uppercase',
            transform: [{ skewX: '-8deg' }],
          }}
        >
          {planTitle(pkg)}
        </Text>
        {trial && (
          <Text
            style={{
              marginTop: 4,
              fontFamily: fonts.mono,
              fontSize: 10.5,
              letterSpacing: 0.3,
              color: colors.accentHi,
            }}
          >
            {trial}
          </Text>
        )}
      </View>
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 13,
          color: selected ? colors.accentHi : 'rgba(255,255,255,0.7)',
          textAlign: 'right',
        }}
      >
        {pkg.product.priceString}
        {'\n'}
        <Text style={{ fontSize: 10, color: colors.mute }}>{periodLabel(pkg)}</Text>
      </Text>
    </Pressable>
  );
}

/**
 * Same visual shell as `PlanCard`, but for the two placeholder rows shown
 * only while `offeringsUnavailable` is true — no real product behind it, so
 * price is rendered as an explicit "coming soon" placeholder rather than a
 * fabricated or hardcoded value. Never rendered once real Offerings load —
 * see the `offeringsUnavailable` branch in PremiumScreen's render.
 */
function FallbackPlanCard({
  title,
  best,
  selected,
  onSelect,
}: {
  title: string;
  best?: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      onPress={onSelect}
      style={{
        position: 'relative',
        paddingVertical: 18,
        paddingHorizontal: 18,
        borderRadius: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: selected ? 'rgba(11,112,249,0.12)' : 'rgba(255,255,255,0.04)',
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? colors.accent : 'rgba(255,255,255,0.1)',
      }}
    >
      {best && (
        <View
          style={{
            position: 'absolute',
            top: -10,
            right: 16,
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 7,
            backgroundColor: colors.accent,
          }}
        >
          <Text style={{ fontFamily: fonts.monoBold, fontSize: 9.5, letterSpacing: 1, color: '#fff' }}>
            MELHOR VALOR
          </Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: fonts.display,
            fontSize: 19,
            color: '#fff',
            textTransform: 'uppercase',
            transform: [{ skewX: '-8deg' }],
          }}
        >
          {title}
        </Text>
      </View>
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 11.5,
          letterSpacing: 0.3,
          color: colors.accentHi,
          textAlign: 'right',
        }}
      >
        Aguardando aprovação
      </Text>
    </Pressable>
  );
}

function InlineNotice({ tone, text }: { tone: 'error' | 'neutral'; text: string }) {
  const color = tone === 'error' ? '#ff7676' : colors.mute;
  return (
    <View
      style={{
        marginTop: 14,
        padding: 12,
        borderRadius: 12,
        backgroundColor: tone === 'error' ? 'rgba(255,118,118,0.08)' : 'rgba(255,255,255,0.04)',
        borderWidth: 1,
        borderColor: tone === 'error' ? 'rgba(255,118,118,0.3)' : 'rgba(255,255,255,0.08)',
      }}
    >
      <Text style={{ fontFamily: fonts.uiMed, fontSize: 12.5, color }}>{text}</Text>
    </View>
  );
}

function CenteredState({
  kind,
  message,
  onRetry,
}: {
  kind: 'loading' | 'error' | 'offline' | 'empty';
  message?: string;
  onRetry?: () => void;
}) {
  const content = {
    loading: {
      icon: 'crown' as const,
      title: 'Carregando planos',
      body: 'Buscando as assinaturas disponíveis…',
      showRetry: false,
    },
    offline: {
      icon: 'alert-triangle' as const,
      title: 'Sem conexão',
      body: 'Verifique sua internet e tente novamente.',
      showRetry: true,
    },
    error: {
      icon: 'alert-triangle' as const,
      title: 'Não foi possível carregar',
      body: message ?? 'Tente novamente em instantes.',
      showRetry: true,
    },
    empty: {
      icon: 'info' as const,
      title: 'Assinaturas indisponíveis',
      body: 'Ainda não há planos configurados para o seu dispositivo. Tente novamente mais tarde.',
      showRetry: true,
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
          <Icon name={content.icon} size={28} color={colors.accentHi} />
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
      {content.showRetry && onRetry && (
        <Pressable
          onPress={onRetry}
          style={{
            marginTop: 22,
            paddingHorizontal: 22,
            paddingVertical: 12,
            borderRadius: 12,
            backgroundColor: 'rgba(255,255,255,0.06)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.12)',
          }}
        >
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: '#fff' }}>Tentar novamente</Text>
        </Pressable>
      )}
    </View>
  );
}
