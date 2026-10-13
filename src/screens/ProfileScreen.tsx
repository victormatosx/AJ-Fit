import React from 'react';
import { View, Text, Image, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, Slash, MonoLabel } from '../components/ui/Display';
import { Icon, IconName } from '../components/ui/Icon';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { ProfileAvatar } from '../components/ui/ProfileAvatar';
import { SettingsSection } from '../components/ui/SettingsSection';
import { SmartAlertsSection } from '../components/ui/SmartAlertsSection';
import { EvolutionCard } from '../components/evolution/EvolutionCard';
import { BOX } from '../lib/wordmarkMotion';
import { useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import type { EvolutionViewModel } from '../workoutEvolution/types';

/**
 * Same source asset and crop box as the cold-start `WordmarkSplash`
 * ("AJ Fit." wordmark; `BOX` is the glyph's normalized bounding box inside
 * the otherwise-transparent square PNG) — just rendered statically and
 * small, for the Profile footer instead of animated full-screen.
 */
const WORDMARK_LOGO = require('../../assets/ajfit-newlogo.png');
const FOOTER_GLYPH_H = 26;
const FOOTER_LOGO_PX = FOOTER_GLYPH_H / (BOX.b - BOX.t);
const FOOTER_GLYPH_W = FOOTER_LOGO_PX * (BOX.r - BOX.l);

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
  onOpenMyPlan,
  evolutionViewModel,
  onOpenEvolution,
}: {
  onOpenAssessment?: () => void;
  onOpenEditProfile?: () => void;
  onOpenSettings?: () => void;
  onOpenMyPlan?: () => void;
  /** Fase 5 — real Training Level/Cycle state; replaces the old hardcoded XP/level bar (docs product §57/§AP-AR). */
  evolutionViewModel: EvolutionViewModel;
  onOpenEvolution?: () => void;
}) {
  const { t } = useTranslation('profile');
  const { theme } = useTheme();
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
  const appVersion = Constants.expoConfig?.version;
  const appVersionLabel = appVersion ? `v${appVersion}` : '—';

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

          {/* Real Training Level/Cycle — Fase 5 replaces the old hardcoded XP/level bar. */}
          <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
            <EvolutionCard viewModel={evolutionViewModel} onPress={onOpenEvolution} />
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

          <View style={{ alignItems: 'center', paddingTop: 20, paddingBottom: 12, gap: 8 }}>
            <View style={{ width: FOOTER_GLYPH_W, height: FOOTER_GLYPH_H, overflow: 'hidden' }}>
              <Image
                source={WORDMARK_LOGO}
                style={{
                  position: 'absolute',
                  width: FOOTER_LOGO_PX,
                  height: FOOTER_LOGO_PX,
                  left: -FOOTER_LOGO_PX * BOX.l,
                  top: -FOOTER_LOGO_PX * BOX.t,
                }}
              />
            </View>
            <Text
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: 10.5,
                letterSpacing: 0.5,
                color: theme.colors.textFaint,
              }}
            >
              {appVersionLabel}
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}
