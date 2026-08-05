import React from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, Slash, MonoLabel } from '../components/ui/Display';
import { Card } from '../components/ui/Card';
import { SegBar } from '../components/ui/SegBar';
import { Icon, IconName } from '../components/ui/Icon';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { ProfileAvatar } from '../components/ui/ProfileAvatar';
import { colors, fonts } from '../theme/tokens';
import { useAuth } from '../state/AuthContext';

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
}: {
  onOpenAssessment?: () => void;
  onOpenEditProfile?: () => void;
  onOpenSettings?: () => void;
}) {
  const { t } = useTranslation('profile');
  const { user, profile, linkedProviders, logout } = useAuth();

  const email = profile?.profile.email ?? user?.email ?? '';
  const athleteFallback = t('fallback.athlete');
  const displayName =
    profile?.profile.name?.trim() ||
    user?.displayName?.trim() ||
    (email ? email.split('@')[0] : athleteFallback);
  const sinceYear = profile?.metadata.createdAt
    ? String(profile.metadata.createdAt.toDate().getFullYear())
    : '—';

  const subscriptionStatus = profile?.subscription.status;
  const subscriptionLabel = subscriptionStatus
    ? t(`subscription.labels.${subscriptionStatus}`, {
        defaultValue: t('subscription.labels.unknown'),
      })
    : t('subscription.labels.none');
  const subscriptionSub = subscriptionStatus
    ? t('subscription.descriptions.managed')
    : t('subscription.descriptions.trialCta');

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
                      fontFamily: fonts.ui,
                      fontSize: 12.5,
                      color: colors.mute,
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
                <MonoLabel color={colors.accentHi}>
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

          {/* subscription */}
          <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
            <LinearGradient
              colors={['rgba(11,112,249,0.28)', 'rgba(11,112,249,0.05)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                padding: 18,
                borderRadius: 14,
                borderBottomRightRadius: 0,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                borderWidth: 1,
                borderColor: 'rgba(11,112,249,0.4)',
              }}
            >
              <Icon name="crown" size={22} color={colors.accentHi} />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 15,
                    color: '#fff',
                    textTransform: 'uppercase',
                  }}
                >
                  {subscriptionLabel}
                </Text>
                <Text
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 10,
                    color: colors.mute,
                    letterSpacing: 1,
                    marginTop: 3,
                  }}
                >
                  {subscriptionSub}
                </Text>
              </View>
              <Icon name="chevron-right" size={15} color="rgba(255,255,255,0.5)" />
            </LinearGradient>
          </View>

          {/* assessment entry */}
          {onOpenAssessment && (
            <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
              <Pressable onPress={onOpenAssessment}>
                <LinearGradient
                  colors={['rgba(11,112,249,0.2)', 'rgba(11,112,249,0.03)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{
                    padding: 18,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: 'rgba(11,112,249,0.35)',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                  }}
                >
                  <View
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 12,
                      backgroundColor: 'rgba(11,112,249,0.18)',
                      borderWidth: 1,
                      borderColor: 'rgba(11,112,249,0.4)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="chart" size={19} color={colors.accentHi} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: '#fff' }}>
                      {t('assessment.title')}
                    </Text>
                    <Text
                      style={{
                        fontFamily: fonts.ui,
                        fontSize: 12,
                        color: colors.mute,
                        marginTop: 2,
                      }}
                    >
                      {t('assessment.subtitle')}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={16} color="rgba(255,255,255,0.5)" />
                </LinearGradient>
              </Pressable>
            </View>
          )}

          <ProfileGroup
            title={t('groups.goalsPlan.title').toUpperCase()}
            items={[
              {
                i: 'target',
                l: t('groups.goalsPlan.items.goal.label'),
                d: t('groups.goalsPlan.items.goal.value'),
              },
              {
                i: 'dumbbell',
                l: t('groups.goalsPlan.items.plan.label'),
                d: t('groups.goalsPlan.items.plan.value'),
              },
              {
                i: 'calendar',
                l: t('groups.goalsPlan.items.frequency.label'),
                d: t('groups.goalsPlan.items.frequency.value'),
              },
            ]}
          />
          <ProfileGroup
            title={t('groups.account.title').toUpperCase()}
            items={[
              {
                i: 'user',
                l: t('groups.account.items.editProfile'),
                onPress: onOpenEditProfile,
              },
              { i: 'crown', l: t('groups.account.items.subscription') },
              { i: 'shield', l: t('groups.account.items.privacy') },
            ]}
          />
          <ProfileGroup
            title={t('groups.preferences.title').toUpperCase()}
            items={[
              {
                i: 'settings',
                l: t('groups.preferences.items.settings'),
                onPress: onOpenSettings,
              },
              { i: 'timer', l: t('groups.preferences.items.timers') },
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
                backgroundColor: 'rgba(255,255,255,0.03)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.06)',
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
                      borderTopColor: 'rgba(255,255,255,0.05)',
                      opacity: linked ? 1 : 0.45,
                    }}
                  >
                    <Icon name={p.icon} size={16} color="#fff" />
                    <Text
                      style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14, color: '#fff' }}
                    >
                      {providerLabel}
                    </Text>
                    {linked ? (
                      <Icon name="check" size={16} color={colors.accentHi} />
                    ) : (
                      <Text
                        style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.faint, letterSpacing: 1 }}
                      >
                        {t('linkedProviders.notLinked').toUpperCase()}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>

          <ProfileGroup
            title={t('groups.session.title').toUpperCase()}
            items={[
              {
                i: 'arrow-left',
                l: t('groups.session.items.logout'),
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

function ProfileGroup({
  title,
  items,
}: {
  title: string;
  items: { i: IconName; l: string; d?: string; danger?: boolean; onPress?: () => void }[];
}) {
  return (
    <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
      <Slash style={{ marginBottom: 10 }}>{title}</Slash>
      <View
        style={{
          borderRadius: 14,
          overflow: 'hidden',
          backgroundColor: 'rgba(255,255,255,0.03)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.06)',
        }}
      >
        {items.map((it, i) => {
          const accent = it.danger ? '#ff7676' : colors.accentHi;
          return (
            <Pressable
              key={i}
              onPress={it.onPress}
              disabled={!it.onPress}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                paddingVertical: 14,
                paddingHorizontal: 16,
                borderTopWidth: i ? 1 : 0,
                borderTopColor: 'rgba(255,255,255,0.05)',
                backgroundColor: pressed && it.onPress ? 'rgba(255,255,255,0.04)' : 'transparent',
              })}
            >
              <Icon name={it.i} size={16} color={accent} />
              <Text
                style={{
                  flex: 1,
                  fontFamily: fonts.uiSemi,
                  fontSize: 14,
                  color: it.danger ? '#ff9a9a' : '#fff',
                }}
              >
                {it.l}
              </Text>
              {it.d && (
                <Text
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 10.5,
                    color: colors.mute,
                    letterSpacing: 0.5,
                  }}
                >
                  {it.d}
                </Text>
              )}
              <Icon name="chevron-right" size={14} color="rgba(255,255,255,0.3)" />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
