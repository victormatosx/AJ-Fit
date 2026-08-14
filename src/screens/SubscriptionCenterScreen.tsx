import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import type { Store } from 'react-native-purchases';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Card, HudCorners } from '../components/ui/Card';
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { Display, MonoLabel, Slash } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { useAuth } from '../state/AuthContext';
import { useSubscription } from '../hooks/useSubscription';
import {
  resolveSubscriptionCenterModel,
  resolveSubscriptionCenterViewState,
  type SubscriptionCenterModel,
  type SubscriptionCenterStatus,
} from '../lib/subscriptionCenter';
import { colors, fonts } from '../theme/tokens';

type ActionNotice = { tone: 'neutral' | 'error'; text: string } | null;

const BADGE_TONE: Record<SubscriptionCenterStatus, { color: string; bg: string }> = {
  active: { color: '#60d99a', bg: 'rgba(34,197,94,0.12)' },
  trial: { color: colors.accentHi, bg: 'rgba(11,112,249,0.16)' },
  canceled: { color: '#ffa840', bg: 'rgba(255,168,64,0.12)' },
  billing_issue: { color: '#ff9a9a', bg: 'rgba(240,86,63,0.12)' },
  grace_period: { color: '#ffa840', bg: 'rgba(255,168,64,0.12)' },
  expired: { color: '#ff9a9a', bg: 'rgba(240,86,63,0.12)' },
  unknown: { color: colors.mute, bg: 'rgba(255,255,255,0.06)' },
};

export function SubscriptionCenterScreen({
  onBack,
  onRenew,
}: {
  onBack: () => void;
  onRenew: () => void;
}) {
  const { t, i18n } = useTranslation('profile');
  const { profile } = useAuth();
  const {
    loading,
    customerInfo,
    refreshing,
    error,
    retry,
    refreshCustomerInfo,
    offerings,
    offeringsLoading,
    offeringsError,
    offeringsUnavailable,
    loadOfferings,
    restore,
    manageSubscription,
  } = useSubscription();
  const [action, setAction] = useState<'manage' | 'restore' | null>(null);
  const [notice, setNotice] = useState<ActionNotice>(null);

  useEffect(() => {
    void loadOfferings();
  }, [loadOfferings]);

  const model = useMemo(
    () =>
      resolveSubscriptionCenterModel({
        customerInfo,
        offerings,
        mirror: profile?.subscription ?? null,
      }),
    [customerInfo, offerings, profile?.subscription],
  );
  const viewState = resolveSubscriptionCenterViewState({ loading, customerInfo, error });
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const formatDate = useCallback(
    (date: Date) =>
      new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(date),
    [locale],
  );

  const handleRefresh = useCallback(() => {
    setNotice(null);
    void refreshCustomerInfo().catch(() => {
      setNotice({ tone: 'error', text: t('subscriptionCenter.notice.refreshError') });
    });
  }, [refreshCustomerInfo, t]);

  const handleManage = useCallback(async () => {
    if (action) return;
    setAction('manage');
    setNotice(null);
    const outcome = await manageSubscription({
      store: model.store,
      managementURL: model.managementURL,
    });
    if (outcome.status === 'unavailable') {
      setNotice({ tone: 'error', text: t('subscriptionCenter.notice.manageUnavailable') });
    } else if (outcome.status === 'error') {
      setNotice({ tone: 'error', text: t('subscriptionCenter.notice.manageError') });
    }
    setAction(null);
  }, [action, manageSubscription, model.managementURL, model.store, t]);

  const handleRestore = useCallback(async () => {
    if (action) return;
    setAction('restore');
    setNotice(null);
    const outcome = await restore();
    if (outcome.status === 'restored') {
      setNotice({
        tone: 'neutral',
        text: outcome.hasPremium
          ? t('subscriptionCenter.notice.restored')
          : t('subscriptionCenter.notice.nothingToRestore'),
      });
    } else {
      setNotice({ tone: 'error', text: t('subscriptionCenter.notice.restoreError') });
    }
    setAction(null);
  }, [action, restore, t]);

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <SubscriptionHeader onBack={onBack} />
        {viewState === 'ready' ? (
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 12, paddingBottom: 28 }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={colors.accentHi}
              />
            }
          >
            <StatusCard model={model} formatDate={formatDate} />
            <DetailsCard model={model} formatDate={formatDate} />

            {(offeringsError || offeringsUnavailable) && !model.localizedPrice ? (
              <InlineNotice
                tone="neutral"
                text={t('subscriptionCenter.notice.catalogUnavailable')}
              />
            ) : null}
            {error && customerInfo ? (
              <InlineNotice tone="error" text={t('subscriptionCenter.notice.refreshError')} />
            ) : null}
            {notice ? <InlineNotice tone={notice.tone} text={notice.text} /> : null}

            <SubscriptionActions
              model={model}
              busy={action !== null}
              restoring={action === 'restore'}
              managing={action === 'manage'}
              onManage={() => void handleManage()}
              onRestore={() => void handleRestore()}
              onRenew={onRenew}
            />

            {offeringsLoading && !offerings ? (
              <View style={{ alignItems: 'center', marginTop: 14 }}>
                <ActivityIndicator size="small" color={colors.accentHi} />
              </View>
            ) : null}
          </ScrollView>
        ) : (
          <CenteredState
            error={viewState === 'error'}
            onRetry={() => void retry()}
          />
        )}
      </SafeAreaView>
    </ScreenBg>
  );
}

function SubscriptionHeader({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('profile');
  return (
    <View
      style={{
        paddingHorizontal: 22,
        paddingTop: 12,
        paddingBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('subscriptionCenter.accessibility.back')}
        onPress={onBack}
        style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          backgroundColor: colors.cardBgHi,
          borderWidth: 1,
          borderColor: colors.hair,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="arrow-left" size={18} color="#fff" />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <MonoLabel>{t('subscriptionCenter.title')}</MonoLabel>
      </View>
      <View style={{ width: 42 }} />
    </View>
  );
}

function StatusCard({
  model,
  formatDate,
}: {
  model: SubscriptionCenterModel;
  formatDate: (date: Date) => string;
}) {
  const { t } = useTranslation('profile');
  const tone = BADGE_TONE[model.status];
  const badge = statusBadge(model.status, t);
  const description = statusDescription(model, formatDate, t);
  const primary = primaryFact(model, formatDate, t);

  return (
    <LinearGradient
      colors={['rgba(11,112,249,0.24)', 'rgba(11,112,249,0.05)', 'rgba(255,255,255,0.02)']}
      locations={[0, 0.55, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        borderRadius: 18,
        borderBottomRightRadius: 2,
        borderWidth: 1,
        borderColor: 'rgba(77,163,255,0.28)',
        padding: 20,
        overflow: 'hidden',
      }}
    >
      <HudCorners />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(255,255,255,0.06)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.10)',
          }}
        >
          <Icon name="crown" size={22} color={colors.accentHi} />
        </View>
        <View style={{ flex: 1 }}>
          <Display size={25}>{t('subscriptionCenter.brand')}</Display>
          <View
            style={{
              alignSelf: 'flex-start',
              marginTop: 7,
              paddingHorizontal: 9,
              paddingVertical: 5,
              borderRadius: 999,
              backgroundColor: tone.bg,
            }}
          >
            <Text
              style={{
                color: tone.color,
                fontFamily: fonts.monoBold,
                fontSize: 9,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
              }}
            >
              {badge}
            </Text>
          </View>
        </View>
      </View>

      <Text
        style={{
          marginTop: 18,
          color: colors.textSecondary,
          fontFamily: fonts.ui,
          fontSize: 13.5,
          lineHeight: 20,
        }}
      >
        {description}
      </Text>

      {primary ? (
        <View
          style={{
            marginTop: 18,
            paddingTop: 16,
            borderTopWidth: 1,
            borderTopColor: colors.hair,
          }}
        >
          <MonoLabel>{primary.label}</MonoLabel>
          <Text
            style={{
              marginTop: 7,
              color: colors.text,
              fontFamily: fonts.uiBold,
              fontSize: 20,
            }}
          >
            {primary.value}
          </Text>
        </View>
      ) : null}
    </LinearGradient>
  );
}

function DetailsCard({
  model,
  formatDate,
}: {
  model: SubscriptionCenterModel;
  formatDate: (date: Date) => string;
}) {
  const { t } = useTranslation('profile');
  const rows: Array<{ label: string; value: string }> = [];
  const plan = planLabel(model, t);
  rows.push({ label: t('subscriptionCenter.field.plan'), value: plan });

  if (model.localizedPrice && model.status !== 'expired') {
    const period =
      model.planKind === 'monthly'
        ? t('subscriptionCenter.period.month')
        : model.planKind === 'annual'
          ? t('subscriptionCenter.period.year')
          : null;
    rows.push({
      label:
        model.status === 'trial'
          ? t('subscriptionCenter.field.afterTrial')
          : t('subscriptionCenter.field.planPrice'),
      value: period
        ? t('subscriptionCenter.priceWithPeriod', {
            price: model.localizedPrice,
            period,
          })
        : model.localizedPrice,
    });
  }
  if (model.status === 'trial' && model.trialEndsAt) {
    rows.push({
      label: t('subscriptionCenter.field.firstCharge'),
      value: formatDate(model.trialEndsAt),
    });
  }
  if (model.startedAt) {
    rows.push({
      label: t('subscriptionCenter.field.start'),
      value: formatDate(model.startedAt),
    });
  }
  if (
    model.latestPurchaseAt &&
    (!model.startedAt || model.latestPurchaseAt.getTime() > model.startedAt.getTime() + 60_000) &&
    model.status !== 'trial'
  ) {
    rows.push({
      label: t('subscriptionCenter.field.latestRenewal'),
      value: formatDate(model.latestPurchaseAt),
    });
  }
  if (model.canceledAt) {
    rows.push({
      label: t('subscriptionCenter.field.canceledOn'),
      value: formatDate(model.canceledAt),
    });
  }
  if (model.billingIssueDetectedAt) {
    rows.push({
      label: t('subscriptionCenter.field.paymentIssueSince'),
      value: formatDate(model.billingIssueDetectedAt),
    });
  }
  if (model.store) {
    rows.push({
      label: t('subscriptionCenter.field.store'),
      value: storeLabel(model.store, t),
    });
  }

  return (
    <View style={{ marginTop: 22 }}>
      <Slash style={{ marginBottom: 10 }}>{t('subscriptionCenter.section.details')}</Slash>
      <Card style={{ paddingHorizontal: 16 }}>
        {rows.map((row, index) => (
          <View
            key={`${row.label}:${index}`}
            style={{
              paddingVertical: 14,
              borderTopWidth: index ? 1 : 0,
              borderTopColor: colors.hair,
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 18,
            }}
          >
            <Text
              style={{
                flex: 1,
                color: colors.mute,
                fontFamily: fonts.ui,
                fontSize: 12.5,
                lineHeight: 18,
              }}
            >
              {row.label}
            </Text>
            <Text
              style={{
                flex: 1,
                color: colors.text,
                fontFamily: fonts.uiSemi,
                fontSize: 13,
                lineHeight: 18,
                textAlign: 'right',
              }}
            >
              {row.value}
            </Text>
          </View>
        ))}
      </Card>
    </View>
  );
}

function SubscriptionActions({
  model,
  busy,
  restoring,
  managing,
  onManage,
  onRestore,
  onRenew,
}: {
  model: SubscriptionCenterModel;
  busy: boolean;
  restoring: boolean;
  managing: boolean;
  onManage: () => void;
  onRestore: () => void;
  onRenew: () => void;
}) {
  const { t } = useTranslation('profile');
  const manageable = ['active', 'trial', 'canceled', 'billing_issue', 'grace_period'].includes(
    model.status,
  );
  const restoreVisible = model.status === 'active' || model.status === 'trial' || model.status === 'unknown';

  if (model.status === 'expired') {
    return (
      <CtaButton onPress={onRenew} style={{ marginTop: 22 }}>
        <CtaText>{t('subscriptionCenter.actions.renew')}</CtaText>
      </CtaButton>
    );
  }

  return (
    <View style={{ marginTop: 22 }}>
      {manageable ? (
        <CtaButton onPress={onManage} disabled={busy}>
          {managing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <CtaText>
              {model.status === 'billing_issue' || model.status === 'grace_period'
                ? t('subscriptionCenter.actions.managePayment')
                : t('subscriptionCenter.actions.manage')}
            </CtaText>
          )}
        </CtaButton>
      ) : null}
      {restoreVisible ? (
        <CtaButton
          ghost
          onPress={onRestore}
          disabled={busy}
          style={{ marginTop: manageable ? 12 : 0 }}
        >
          {restoring ? (
            <ActivityIndicator color="#fff" />
          ) : (
            t('subscriptionCenter.actions.restore')
          )}
        </CtaButton>
      ) : null}
    </View>
  );
}

function CenteredState({ error, onRetry }: { error: boolean; onRetry: () => void }) {
  const { t } = useTranslation('profile');
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 34,
      }}
    >
      {error ? (
        <Icon name="alert-triangle" size={26} color={colors.dangerText} />
      ) : (
        <ActivityIndicator size="large" color={colors.accentHi} />
      )}
      <Text
        style={{
          marginTop: 16,
          color: colors.text,
          fontFamily: fonts.uiBold,
          fontSize: 18,
          textAlign: 'center',
        }}
      >
        {error
          ? t('subscriptionCenter.state.errorTitle')
          : t('subscriptionCenter.state.loadingTitle')}
      </Text>
      <Text
        style={{
          marginTop: 8,
          color: colors.mute,
          fontFamily: fonts.ui,
          fontSize: 13.5,
          lineHeight: 20,
          textAlign: 'center',
        }}
      >
        {error
          ? t('subscriptionCenter.state.errorBody')
          : t('subscriptionCenter.state.loadingBody')}
      </Text>
      {error ? (
        <CtaButton ghost onPress={onRetry} style={{ marginTop: 20 }}>
          {t('subscriptionCenter.actions.retry')}
        </CtaButton>
      ) : null}
    </View>
  );
}

function InlineNotice({ tone, text }: { tone: 'neutral' | 'error'; text: string }) {
  const error = tone === 'error';
  return (
    <View
      style={{
        marginTop: 14,
        padding: 12,
        borderRadius: 12,
        backgroundColor: error ? 'rgba(240,86,63,0.08)' : colors.cardBgHi,
        borderWidth: 1,
        borderColor: error ? 'rgba(255,118,118,0.28)' : colors.hair,
      }}
    >
      <Text
        style={{
          color: error ? colors.dangerText : colors.mute,
          fontFamily: fonts.uiMed,
          fontSize: 12.5,
          lineHeight: 18,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

type Translate = ReturnType<typeof useTranslation<'profile'>>['t'];

function statusBadge(status: SubscriptionCenterStatus, t: Translate): string {
  switch (status) {
    case 'active': return t('subscriptionCenter.badge.active');
    case 'trial': return t('subscriptionCenter.badge.trial');
    case 'canceled': return t('subscriptionCenter.badge.canceled');
    case 'billing_issue': return t('subscriptionCenter.badge.billingIssue');
    case 'grace_period': return t('subscriptionCenter.badge.gracePeriod');
    case 'expired': return t('subscriptionCenter.badge.expired');
    default: return t('subscriptionCenter.badge.unknown');
  }
}

function statusDescription(
  model: SubscriptionCenterModel,
  formatDate: (date: Date) => string,
  t: Translate,
): string {
  switch (model.status) {
    case 'active': return t('subscriptionCenter.message.active');
    case 'trial': return t('subscriptionCenter.message.trial');
    case 'canceled':
      return model.currentPeriodEndsAt
        ? t('subscriptionCenter.message.canceled', {
            date: formatDate(model.currentPeriodEndsAt),
          })
        : t('subscriptionCenter.message.canceledNoDate');
    case 'billing_issue': return t('subscriptionCenter.message.billingIssue');
    case 'grace_period': return t('subscriptionCenter.message.gracePeriod');
    case 'expired': return t('subscriptionCenter.message.expired');
    default: return t('subscriptionCenter.message.unknown');
  }
}

function primaryFact(
  model: SubscriptionCenterModel,
  formatDate: (date: Date) => string,
  t: Translate,
): { label: string; value: string } | null {
  const date = model.currentPeriodEndsAt;
  if (model.status === 'trial' && (model.trialEndsAt ?? date)) {
    return {
      label: t('subscriptionCenter.field.freeUntil'),
      value: formatDate(model.trialEndsAt ?? date!),
    };
  }
  if (model.status === 'canceled' && date) {
    return { label: t('subscriptionCenter.field.accessUntil'), value: formatDate(date) };
  }
  if (model.status === 'grace_period' && model.gracePeriodEndsAt) {
    return {
      label: t('subscriptionCenter.field.graceUntil'),
      value: formatDate(model.gracePeriodEndsAt),
    };
  }
  if (model.status === 'billing_issue' && date) {
    return { label: t('subscriptionCenter.field.accessUntil'), value: formatDate(date) };
  }
  if (model.status === 'expired' && date) {
    return { label: t('subscriptionCenter.field.expiredOn'), value: formatDate(date) };
  }
  if (model.status === 'active' && date) {
    return {
      label:
        model.willRenew === false
          ? t('subscriptionCenter.field.accessUntil')
          : t('subscriptionCenter.field.nextRenewal'),
      value: formatDate(date),
    };
  }
  return null;
}

function planLabel(model: SubscriptionCenterModel, t: Translate): string {
  if (model.planKind === 'monthly') return t('subscriptionCenter.plan.monthly');
  if (model.planKind === 'annual') return t('subscriptionCenter.plan.annual');
  return model.planDisplayName ?? t('subscriptionCenter.plan.unknown');
}

function storeLabel(store: Store, t: Translate): string {
  switch (store) {
    case 'APP_STORE': return t('subscriptionCenter.store.APP_STORE');
    case 'PLAY_STORE': return t('subscriptionCenter.store.PLAY_STORE');
    case 'PROMOTIONAL': return t('subscriptionCenter.store.PROMOTIONAL');
    case 'MAC_APP_STORE': return t('subscriptionCenter.store.MAC_APP_STORE');
    case 'STRIPE': return t('subscriptionCenter.store.STRIPE');
    case 'AMAZON': return t('subscriptionCenter.store.AMAZON');
    case 'RC_BILLING': return t('subscriptionCenter.store.RC_BILLING');
    case 'EXTERNAL': return t('subscriptionCenter.store.EXTERNAL');
    case 'PADDLE': return t('subscriptionCenter.store.PADDLE');
    case 'TEST_STORE': return t('subscriptionCenter.store.TEST_STORE');
    case 'GALAXY': return t('subscriptionCenter.store.GALAXY');
    case 'UNKNOWN_STORE': return t('subscriptionCenter.store.UNKNOWN_STORE');
    default: return t('subscriptionCenter.store.unknown');
  }
}
