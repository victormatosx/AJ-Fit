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
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { Display, MonoLabel, Slash } from '../components/ui/Display';
import { Icon, type IconName } from '../components/ui/Icon';
import { SettingsSection, type SettingsItemData } from '../components/ui/SettingsSection';
import { useAuth } from '../state/AuthContext';
import { useSubscription } from '../hooks/useSubscription';
import {
  isRestoreVisible,
  resolveSubscriptionCenterModel,
  resolveSubscriptionCenterViewState,
  type SubscriptionCenterModel,
  type SubscriptionCenterStatus,
} from '../lib/subscriptionCenter';
import { colors, fonts } from '../theme/tokens';

type ActionNotice = { tone: 'neutral' | 'error'; text: string } | null;

/**
 * Six statuses map onto five semantic tiers, not one color each — this is
 * what keeps `canceled` (still Premium, no action needed) visually distinct
 * from `grace_period` (still Premium, but needs action), and keeps
 * `billing_issue` (needs action) distinct from `expired` (no longer Premium)
 * even though both used to render in the same red.
 */
type StatusTier = 'success' | 'info' | 'caution' | 'attention' | 'off';

const STATUS_TIER: Record<SubscriptionCenterStatus, StatusTier> = {
  active: 'success',
  trial: 'info',
  canceled: 'caution',
  billing_issue: 'attention',
  grace_period: 'attention',
  expired: 'off',
  unknown: 'off',
};

const TIER_TONE: Record<StatusTier, { color: string; bg: string }> = {
  success: { color: '#60d99a', bg: 'rgba(34,197,94,0.12)' },
  info: { color: colors.accentHi, bg: 'rgba(11,112,249,0.16)' },
  caution: { color: '#ffa840', bg: 'rgba(255,168,64,0.12)' },
  attention: { color: '#ff9a9a', bg: 'rgba(240,86,63,0.16)' },
  off: { color: colors.mute, bg: 'rgba(255,255,255,0.06)' },
};

const STATUS_ICON: Record<SubscriptionCenterStatus, IconName> = {
  active: 'crown',
  trial: 'crown',
  canceled: 'crown',
  billing_issue: 'alert-triangle',
  grace_period: 'alert-triangle',
  expired: 'lock',
  unknown: 'help-circle',
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
            contentContainerStyle={{ paddingTop: 8, paddingBottom: 28 }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={colors.accentHi}
              />
            }
          >
            <View style={{ paddingHorizontal: 22 }}>
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

              {model.status === 'expired' ? (
                <ExpiredActions
                  onRenew={onRenew}
                  onRestore={() => void handleRestore()}
                  restoring={action === 'restore'}
                  busy={action !== null}
                />
              ) : null}

              {offeringsLoading && !offerings ? (
                <View style={{ alignItems: 'center', marginTop: 14 }}>
                  <ActivityIndicator size="small" color={colors.accentHi} />
                </View>
              ) : null}
            </View>

            {model.status !== 'expired' ? (
              <SubscriptionActions
                model={model}
                busy={action !== null}
                restoring={action === 'restore'}
                managing={action === 'manage'}
                onManage={() => void handleManage()}
                onRestore={() => void handleRestore()}
              />
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
  const tier = STATUS_TIER[model.status];
  const tone = TIER_TONE[tier];
  const icon = STATUS_ICON[model.status];
  // Icon glyph shifts to the tone color only for tiers that need urgency
  // (attention) or that no longer carry Premium (off); "still fine" tiers
  // (success/info/caution) keep the brand blue so the card doesn't turn
  // into a mixed-color badge for states the user shouldn't worry about.
  const iconColor = tier === 'attention' || tier === 'off' ? tone.color : colors.accentHi;
  const badge = statusBadge(model.status, t);
  const description = statusDescription(model, formatDate, t);
  const primary = primaryFact(model, formatDate, t);
  const planLine = planPriceLine(model, t);
  // "Active" is self-evident from the badge + next-renewal date, so the
  // longer explanatory sentence is reserved for states that actually need
  // context the user can't get from a glance (canceled, billing issues...).
  const showDescription = model.status !== 'active';

  return (
    <LinearGradient
      colors={['rgba(11,112,249,0.18)', 'rgba(11,112,249,0.03)', 'rgba(255,255,255,0.015)']}
      locations={[0, 0.6, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(77,163,255,0.22)',
        padding: 16,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(255,255,255,0.06)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.10)',
          }}
        >
          <Icon name={icon} size={19} color={iconColor} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Display size={18}>{t('subscriptionCenter.brand')}</Display>
            <View
              style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
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
          {planLine ? (
            <Text
              style={{
                marginTop: 4,
                color: colors.textSecondary,
                fontFamily: fonts.uiMed,
                fontSize: 12.5,
              }}
            >
              {planLine}
            </Text>
          ) : null}
        </View>
      </View>

      {showDescription ? (
        <Text
          style={{
            marginTop: 14,
            color: colors.textSecondary,
            fontFamily: fonts.ui,
            fontSize: 13,
            lineHeight: 19,
          }}
        >
          {description}
        </Text>
      ) : null}

      {primary ? (
        <View
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTopWidth: 1,
            borderTopColor: colors.hair,
          }}
        >
          <MonoLabel>{primary.label}</MonoLabel>
          <Text
            style={{
              marginTop: 6,
              color: colors.text,
              fontFamily: fonts.uiBold,
              fontSize: 19,
            }}
          >
            {primary.value}
          </Text>
        </View>
      ) : null}
    </LinearGradient>
  );
}

/**
 * High-priority facts (plan, price/period, status, next renewal) live in
 * StatusCard. This card only holds médio/baixa metadata — start date,
 * payment source, and lower-priority timestamps — so it never duplicates
 * what the user already saw above.
 */
function DetailsCard({
  model,
  formatDate,
}: {
  model: SubscriptionCenterModel;
  formatDate: (date: Date) => string;
}) {
  const { t } = useTranslation('profile');
  const rows: Array<{ label: string; value: string }> = [];

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
  if (model.store) {
    rows.push({
      label: t('subscriptionCenter.field.store'),
      value: storeLabel(model.store, t),
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

  if (rows.length === 0) return null;

  return (
    <View style={{ marginTop: 24 }}>
      <Slash style={{ marginBottom: 10 }}>{t('subscriptionCenter.section.details')}</Slash>
      {rows.map((row, index) => (
        <View
          key={`${row.label}:${index}`}
          style={{
            paddingVertical: 10,
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
              fontSize: 12,
              lineHeight: 17,
            }}
          >
            {row.label}
          </Text>
          <Text
            style={{
              flex: 1,
              color: colors.textSecondary,
              fontFamily: fonts.uiMed,
              fontSize: 12.5,
              lineHeight: 17,
              textAlign: 'right',
            }}
          >
            {row.value}
          </Text>
        </View>
      ))}
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
}: {
  model: SubscriptionCenterModel;
  busy: boolean;
  restoring: boolean;
  managing: boolean;
  onManage: () => void;
  onRestore: () => void;
}) {
  const { t } = useTranslation('profile');
  const manageable = ['active', 'trial', 'canceled', 'billing_issue', 'grace_period'].includes(
    model.status,
  );
  // This component never renders for 'expired' (see ExpiredActions below),
  // so in practice isRestoreVisible only turns this on for 'unknown'.
  const restoreVisible = isRestoreVisible(model.status);

  const items: SettingsItemData[] = [];
  if (manageable) {
    items.push({
      icon: 'settings',
      label:
        model.status === 'billing_issue' || model.status === 'grace_period'
          ? t('subscriptionCenter.actions.managePayment')
          : t('subscriptionCenter.actions.manage'),
      onPress: onManage,
      disabled: busy,
      loading: managing,
    });
  }
  if (restoreVisible) {
    items.push({
      icon: 'swap',
      label: t('subscriptionCenter.actions.restore'),
      onPress: onRestore,
      disabled: busy,
      loading: restoring,
    });
  }

  if (items.length === 0) return null;

  return (
    <SettingsSection
      title={t('subscriptionCenter.section.manage')}
      items={items}
      style={{ marginTop: 26, paddingBottom: 0 }}
    />
  );
}

/**
 * Expired is the one status where "Renovar Premium" is a real conversion
 * action, so it keeps the large CTA treatment. Restore is only a recovery
 * path for someone who believes they already paid, so it renders as a
 * subordinate text link underneath — never another full-size button.
 */
function ExpiredActions({
  onRenew,
  onRestore,
  restoring,
  busy,
}: {
  onRenew: () => void;
  onRestore: () => void;
  restoring: boolean;
  busy: boolean;
}) {
  const { t } = useTranslation('profile');
  return (
    <View style={{ marginTop: 24, alignItems: 'center' }}>
      <CtaButton onPress={onRenew} style={{ alignSelf: 'stretch' }}>
        <CtaText>{t('subscriptionCenter.actions.renew')}</CtaText>
      </CtaButton>
      <Pressable
        accessibilityRole="button"
        onPress={onRestore}
        disabled={busy}
        hitSlop={8}
        style={({ pressed }) => ({
          marginTop: 16,
          opacity: busy && !restoring ? 0.4 : pressed ? 0.6 : 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        })}
      >
        {restoring ? (
          <ActivityIndicator size="small" color={colors.mute} />
        ) : (
          <>
            <Text
              style={{
                color: colors.mute,
                fontFamily: fonts.ui,
                fontSize: 12.5,
              }}
            >
              {t('subscriptionCenter.actions.restorePrompt')}
            </Text>
            <Text
              style={{
                color: colors.accentHi,
                fontFamily: fonts.uiSemi,
                fontSize: 12.5,
              }}
            >
              {t('subscriptionCenter.actions.restore')}
            </Text>
          </>
        )}
      </Pressable>
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
    return { label: t('subscriptionCenter.field.premiumUntil'), value: formatDate(date) };
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

/** Plan name plus price/period, e.g. "Premium Anual · R$ 799,90 / ano". */
function planPriceLine(model: SubscriptionCenterModel, t: Translate): string {
  const plan = planLabel(model, t);
  if (!model.localizedPrice || model.status === 'expired') return plan;
  const period =
    model.planKind === 'monthly'
      ? t('subscriptionCenter.period.month')
      : model.planKind === 'annual'
        ? t('subscriptionCenter.period.year')
        : null;
  const price = period
    ? t('subscriptionCenter.priceWithPeriod', { price: model.localizedPrice, period })
    : model.localizedPrice;
  return `${plan} · ${price}`;
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
