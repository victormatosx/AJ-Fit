import React from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, Slash, MonoLabel } from '../components/ui/Display';
import { Card } from '../components/ui/Card';
import { SegBar } from '../components/ui/SegBar';
import { Icon, IconName } from '../components/ui/Icon';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { ProfileAvatar } from '../components/ui/ProfileAvatar';
import { SettingsSection } from '../components/ui/SettingsSection';
import { SmartAlertsSection } from '../components/ui/SmartAlertsSection';
import { useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { useSubscription } from '../hooks/useSubscription';
import { resolveSubscriptionCenterModel } from '../lib/subscriptionCenter';

/** Provider ids come from Firebase Auth and MUST NOT be renamed here —
 *  translation happens at the label lookup, never on the id. */
const PROVIDER_META: { id: 'google.com' | 'apple.com' | 'password'; icon: IconName }[] = [
  { id: 'google.com', icon: 'google' },
  { id: 'apple.com', icon: 'apple' },
  { id: 'password', icon: 'mail' },
];

export function ProfileScreen({
  onOpenAssessment,
  onOpenEditProfile,
  onOpenSettings,
  onOpenSubscription,
  onOpenMyPlan,
}: {
  onOpenAssessment?: () => void;
  onOpenEditProfile?: () => void;
  onOpenSettings?: () => void;
  onOpenSubscription?: () => void;
  onOpenMyPlan?: () => void;
}) {
  const { t } = useTranslation('profile');
  const { theme } = useTheme();
  const { user, profile, linkedProviders, logout } = useAuth();
  const { customerInfo } = useSubscription();

  const email = profile?.profile.email ?? user?.email ?? '';
  const athleteFallback = t('fallback.athlete');
  const displayName =
    profile?.profile.name?.trim() ||
    user?.displayName?.trim() ||
    (email ? email.split('@')[0] : athleteFallback);
  const sinceYear = profile?.metadata.createdAt
    ? String(profile.metadata.createdAt.toDate().getFullYear())
    : '—';

  const subscriptionState = resolveSubscriptionCenterModel({
    customerInfo,
    offerings: null,
    mirror: profile?.subscription ?? null,
  }).status;
  const subscriptionStatus = {
    active: 'ACTIVE',
    trial: 'TRIAL',
    canceled: 'CANCELED',
    billing_issue: 'BILLING_ISSUE',
    grace_period: 'BILLING_ISSUE',
    expired: 'EXPIRED',
    unknown: null,
  }[subscriptionState];
  const subscriptionLabel = subscriptionStatus
    ? t(`subscription.labels.${subscriptionStatus}`, {
        defaultValue: t('subscription.labels.unknown'),
      })
    : t('subscription.labels.none');

  function confirmLogout() {
    Alert.alert(t('logout.confirmTitle'), t('logout.confirmMessage'), [
      { text: t('logout.cancel'), style: 'cancel' },
      {
        text: t('logout.confirm'),
        style: 'destructive',
        onPress: () => {
          logout().catch(() =>
            Alert.alert(t('logout.errorTitle'), t('logout.errorMessage')),
          );
        },
      },
    ]);
  }

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
          {/* athlete header */}
          <View style={{ paddingHorizontal: 22, paddingTop: 12, paddingBottom: 18 }}>
            <OutlineNumber
              size={150}
              style={{ position: 'absolute', top: -16, right: -10, opacity: 0.35 }}
            >
              AJ
            </OutlineNumber>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <ProfileAvatar
                displayName={displayName}
                photoURL={profile?.profile.photoURL}
                photoVersion={profile?.profile.photoVersion}
                size={86}
              />
              <View style={{ flex: 1 }}>
                <MonoLabel>
                  {t('header.memberSince', { year: sinceYear }).toUpperCase()}
                </MonoLabel>
                <Display size={26} style={{ marginTop: 6 }} numberOfLines={1}>
                  {displayName.toUpperCase()}
                </Display>
                {email ? (
                  <Text
                    style={{
                      fontFamily: theme.fonts.ui,
                      fontSize: 12.5,
                      color: theme.colors.textMuted,
                      marginTop: 4,
                    }}
                    numberOfLines={1}
                  >
                    {email}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>

          {/* level bar */}
          <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
            <Card style={{ padding: 16 }}>
              <View
                style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}
              >
                <Slash>{t('level.title').toUpperCase()}</Slash>
                <MonoLabel color={theme.colors.primaryEmphasis}>
                  {t('level.xp', { xp: '2.450' }).toUpperCase()}
                </MonoLabel>
              </View>
              <SegBar value={0.62} segs={16} />
              <MonoLabel style={{ marginTop: 8 }}>
                {t('level.toNext', {
                  amount: '950',
                  nextLevel: t('level.nextLevel'),
                }).toUpperCase()}
              </MonoLabel>
            </Card>
          </View>

          <SmartAlertsSection title={t('smartAlerts.title').toUpperCase()} items={[]} />

          <SettingsSection
            title={t('groups.evolution.title').toUpperCase()}
            items={[
              {
                icon: 'chart',
                label: t('assessment.title'),
                onPress: onOpenAssessment,
              },
            ]}
          />

          <SettingsSection
            title={t('groups.goalsPlan.title').toUpperCase()}
            items={[
              {
                icon: 'target',
                label: t('groups.goalsPlan.items.viewPlan'),
                onPress: onOpenMyPlan,
              },
            ]}
          />
          <SettingsSection
            title={t('groups.account.title').toUpperCase()}
            items={[
              {
                icon: 'user',
                label: t('groups.account.items.editProfile'),
                onPress: onOpenEditProfile,
              },
              {
                icon: 'crown',
                label: t('groups.account.items.subscription'),
                value: subscriptionLabel,
                onPress: onOpenSubscription,
              },
              {
                icon: 'settings',
                label: t('groups.account.items.settings'),
                onPress: onOpenSettings,
              },
            ]}
          />
          {/* linked login methods */}
          <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
            <Slash style={{ marginBottom: 10 }}>
              {t('linkedProviders.title').toUpperCase()}
            </Slash>
            <View
              style={{
                borderRadius: 14,
                overflow: 'hidden',
                backgroundColor: theme.colors.settingsGroupBackground,
                borderWidth: 1,
                borderColor: theme.colors.settingsGroupBorder,
              }}
            >
              {PROVIDER_META.map((p, i) => {
                const linked = linkedProviders.includes(p.id);
                const providerLabel = t(`linkedProviders.labels.${p.id}`);
                return (
                  <View
                    key={p.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 14,
                      paddingVertical: 14,
                      paddingHorizontal: 16,
                      borderTopWidth: i ? 1 : 0,
                      borderTopColor: theme.colors.settingsDivider,
                      opacity: linked ? 1 : 0.45,
                    }}
                  >
                    <Icon name={p.icon} size={16} color={theme.colors.textPrimary} />
                    <Text
                      style={{ flex: 1, fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textPrimary }}
                    >
                      {providerLabel}
                    </Text>
                    {linked ? (
                      <Icon name="check" size={16} color={theme.colors.primaryEmphasis} />
                    ) : (
                      <Text
                        style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.textFaint, letterSpacing: 1 }}
                      >
                        {t('linkedProviders.notLinked').toUpperCase()}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>

          <SettingsSection
            title={t('groups.session.title').toUpperCase()}
            items={[
              {
                icon: 'arrow-left',
                label: t('groups.session.items.logout'),
                danger: true,
                onPress: confirmLogout,
              },
            ]}
          />
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}
