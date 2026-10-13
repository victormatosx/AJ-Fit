import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ScreenBg } from '../components/ui/ScreenBg';
import { MonoLabel } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { SettingsHeader, SettingsValue } from '../components/ui/SettingsSection';
import { HealthProviderLogo } from '../components/health/HealthProviderLogo';
import { spacing } from '../theme/tokens';
import { useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { useScreenFocusEffect } from '../state/ScreenActivity';
import { getHealthPlatform } from '../services/healthIntegration';
import {
  getLastKnownHealthIntegrationIntent,
  readHealthIntegrationIntent,
} from '../services/healthIntegrationPreferences';
import type { HealthConnectionIntent } from '../types/healthIntegration';

/**
 * Settings → "Apps conectados" — a navigational list between the Settings
 * row and the existing `HealthIntegrationScreen`. Today there is exactly one
 * connectable entry (the device's native health platform), but this screen
 * exists as its own step so a future second integration has somewhere to
 * live without reshaping the Settings row again. Reuses the same persisted
 * status read `SettingsScreen` already uses for its row — intentionally not
 * `useHealthIntegration`, which performs live native availability/permission
 * checks this list screen has no reason to trigger.
 */
export function ConnectedAppsScreen({
  onBack,
  onOpenHealthIntegration,
}: {
  onBack?: () => void;
  onOpenHealthIntegration?: () => void;
}) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const { t } = useTranslation(['common', 'settings', 'health']);
  const platform = getHealthPlatform();
  const provider = platform === 'android' ? 'Health Connect' : 'Apple Health';

  const [intent, setIntent] = useState<HealthConnectionIntent | 'loading'>(
    () => (user ? getLastKnownHealthIntegrationIntent(user.uid) ?? 'loading' : 'not_configured'),
  );
  const intentUidRef = useRef<string | null>(null);

  const refreshIntent = useCallback(() => {
    intentUidRef.current = uid;
    if (!uid) {
      setIntent('not_configured');
      return;
    }
    setIntent(getLastKnownHealthIntegrationIntent(uid) ?? 'loading');
    void readHealthIntegrationIntent(uid).then((next) => {
      if (intentUidRef.current !== uid) return;
      setIntent(next);
    });
  }, [uid]);

  useEffect(() => {
    refreshIntent();
  }, [refreshIntent]);
  useScreenFocusEffect(() => {
    refreshIntent();
  });

  const statusLabel = intent === 'loading'
    ? t('settings:values.healthIntegrationLoading')
    : intent === 'enabled'
      ? t('settings:values.healthIntegrationEnabled')
      : intent === 'disabled'
        ? t('settings:values.healthIntegrationDisabled')
        : t('settings:values.healthIntegrationNotConfigured');

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
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
            accessibilityRole="button"
            accessibilityLabel={t('common:actions.back')}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              backgroundColor: theme.colors.controlBackground,
              borderWidth: 1,
              borderColor: theme.colors.controlBorder,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="arrow-left" size={17} color={theme.colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <MonoLabel numberOfLines={1}>{t('settings:connectedApps.screenTitle').toUpperCase()}</MonoLabel>
          </View>
          <View style={{ width: 38 }} />
        </View>

        <View style={{ paddingHorizontal: 22, paddingTop: spacing[5] }}>
          <SettingsHeader>{t('settings:connectedApps.screenTitle')}</SettingsHeader>
          <View
            style={{
              borderRadius: 14,
              overflow: 'hidden',
              backgroundColor: theme.colors.settingsGroupBackground,
              borderWidth: 1,
              borderColor: theme.colors.settingsGroupBorder,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={provider}
              onPress={onOpenHealthIntegration}
              disabled={!onOpenHealthIntegration}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing[3.5],
                minHeight: 48,
                paddingVertical: spacing[3.5],
                paddingHorizontal: spacing[4],
                backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent',
              })}
            >
              <HealthProviderLogo platform={platform} size={32} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textPrimary }}>
                  {provider}
                </Text>
              </View>
              <SettingsValue>{statusLabel}</SettingsValue>
              <Icon name="chevron-right" size={14} color={theme.colors.textFaint} />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </ScreenBg>
  );
}
