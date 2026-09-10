import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ScreenBg } from '../components/ui/ScreenBg';
import { MonoLabel } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { SettingsDivider, SettingsHeader } from '../components/ui/SettingsSection';
import { spacing } from '../theme/tokens';
import { useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import {
  getNotificationPermissionStatus,
  openSystemNotificationSettings,
  requestNotificationPermission,
  type PushPermissionStatus,
} from '../services/pushNotifications';
import { updatePushPermissionState } from '../services/pushDeviceRegistration';
import {
  changeNotificationPreferenceForUser,
  readStoredNotificationPreferences,
  reconcilePendingNotificationPreferences,
} from '../services/notificationPreferences';
import {
  NOTIFICATION_PREFERENCE_KEYS,
  resolveNotificationPreference,
  type NotificationPreferenceKey,
  type NotificationPreferences,
} from '../types/notificationPreferences';
import { logError } from '../lib/logError';

/**
 * A device's OS permission and a user's category preference are two
 * independent axes (Fase 4 §10/§24): this banner reflects the FORMER only.
 * The three toggles below always reflect the latter, even while the OS
 * permission is denied — the user is stating what they'd want to receive
 * once/if the platform allows it, not toggling the OS permission itself.
 */
function PermissionBanner({
  status,
  onEnable,
  onOpenSettings,
}: {
  status: PushPermissionStatus | null;
  onEnable: () => void;
  onOpenSettings: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation(['common', 'notifications']);

  if (status === null || status === 'unsupported') return null;

  const isDenied = status === 'denied';
  const isNotDetermined = status === 'not-determined';
  const isError = status === 'error';
  const message = isDenied
    ? t('notifications:permission.denied')
    : isNotDetermined
      ? t('notifications:permission.notDetermined')
      : isError
        ? t('notifications:permission.error')
        : t('notifications:permission.granted');

  return (
    <View
      style={{
        marginHorizontal: 22,
        marginBottom: 16,
        padding: 14,
        borderRadius: 14,
        backgroundColor: theme.colors.settingsGroupBackground,
        borderWidth: 1,
        borderColor: theme.colors.settingsGroupBorder,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Icon
        name="bell"
        size={16}
        color={status === 'granted' ? theme.colors.textSecondary : theme.colors.textFaint}
      />
      <Text
        style={[
          theme.typography.bodySmall,
          { flex: 1, color: theme.colors.textSecondary },
        ]}
      >
        {message}
      </Text>
      {isNotDetermined ? (
        <Pressable
          onPress={onEnable}
          accessibilityRole="button"
          accessibilityLabel={t('notifications:permission.actions.enable')}
          hitSlop={8}
        >
          <Text
            style={{
              fontFamily: theme.fonts.uiSemi,
              fontSize: 12.5,
              color: theme.colors.primaryEmphasis,
            }}
          >
            {t('notifications:permission.actions.enable')}
          </Text>
        </Pressable>
      ) : null}
      {isDenied ? (
        <Pressable
          onPress={onOpenSettings}
          accessibilityRole="button"
          accessibilityLabel={t('notifications:permission.actions.openSettings')}
          hitSlop={8}
        >
          <Text
            style={{
              fontFamily: theme.fonts.uiSemi,
              fontSize: 12.5,
              color: theme.colors.primaryEmphasis,
            }}
          >
            {t('notifications:permission.actions.openSettings')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function NotificationToggleRow({
  title,
  description,
  value,
  disabled,
  onValueChange,
}: {
  title: string;
  description: string;
  value: boolean;
  disabled: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const { theme } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing[3.5],
        minHeight: 48,
        paddingVertical: spacing[3.5],
        paddingHorizontal: spacing[4],
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: theme.fonts.uiSemi,
            fontSize: 14,
            color: theme.colors.textPrimary,
          }}
        >
          {title}
        </Text>
        <Text
          style={[
            theme.typography.bodySmall,
            { color: theme.colors.textSecondary, marginTop: spacing[1] },
          ]}
        >
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={title}
        trackColor={{ false: theme.colors.controlBorder, true: theme.colors.primaryEmphasis }}
        thumbColor={theme.colors.controlBackground}
      />
    </View>
  );
}

export function NotificationSettingsScreen({ onBack }: { onBack?: () => void }) {
  const { theme } = useTheme();
  const { user, profile } = useAuth();
  const uid = user?.uid ?? null;
  const { t } = useTranslation(['common', 'notifications']);

  const [permission, setPermission] = useState<PushPermissionStatus | null>(null);
  const [busyKeys, setBusyKeys] = useState<Set<NotificationPreferenceKey>>(new Set());
  const [errorKey, setErrorKey] = useState<NotificationPreferenceKey | null>(null);
  const [overrides, setOverrides] = useState<Partial<Record<NotificationPreferenceKey, boolean>>>({});
  const activeUid = useRef<string | null>(uid);

  useLayoutEffect(() => {
    activeUid.current = uid;
  }, [uid]);

  const refreshPermission = useCallback(async () => {
    setPermission(await getNotificationPermissionStatus());
  }, []);

  useEffect(() => {
    void refreshPermission();
  }, [refreshPermission]);

  useEffect(() => {
    let active = true;
    setOverrides({});
    setErrorKey(null);
    setBusyKeys(new Set());
    if (!uid) return () => { active = false; };

    void readStoredNotificationPreferences(uid).then((cached) => {
      if (active) setOverrides(cached);
    });
    void reconcilePendingNotificationPreferences(uid);
    return () => { active = false; };
  }, [uid]);

  // Fase 4 §16: resuming from the system Settings app is the only moment the
  // OS permission can change while this screen is alive — no polling, just
  // the same AppState-driven resume check Fase 2's device runtime already
  // uses. Both the local UI and the backend's own record of pushEnabled are
  // refreshed, since either could now be stale.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void refreshPermission();
      if (uid) void updatePushPermissionState(uid);
    });
    return () => subscription.remove();
  }, [refreshPermission, uid]);

  const storedPreferences: NotificationPreferences | undefined =
    profile?.preferences.notificationPreferences;

  const valueFor = (key: NotificationPreferenceKey): boolean =>
    overrides[key] ?? resolveNotificationPreference(storedPreferences, key);

  const handleToggle = async (key: NotificationPreferenceKey, next: boolean) => {
    const mutationUid = uid;
    if (!mutationUid) return;
    setErrorKey((current) => (current === key ? null : current));
    setOverrides((current) => ({ ...current, [key]: next }));
    setBusyKeys((current) => new Set(current).add(key));

    try {
      const { preferences, remote } = await changeNotificationPreferenceForUser({
        uid: mutationUid,
        current: { ...storedPreferences, ...overrides },
        key,
        next,
      });
      if (activeUid.current !== mutationUid) return;
      setOverrides(preferences);
      void remote
        .then((outcome) => {
          if (
            outcome.status !== 'rolled-back' ||
            activeUid.current !== mutationUid
          ) return;
          setOverrides((current) => {
            const { [key]: _removed, ...rest } = current;
            return rest;
          });
          setErrorKey(key);
        })
        .catch((err) => logError('notificationSettings:remote', err, { key }));
    } catch (err) {
      logError('notificationSettings:toggle', err, { key });
      if (activeUid.current !== mutationUid) return;
      setOverrides((current) => {
        const { [key]: _removed, ...rest } = current;
        return rest;
      });
      setErrorKey(key);
    } finally {
      if (activeUid.current === mutationUid) {
        setBusyKeys((current) => {
          const nextKeys = new Set(current);
          nextKeys.delete(key);
          return nextKeys;
        });
      }
    }
  };

  const handleEnablePermission = async () => {
    const permissionUid = uid;
    const status = await requestNotificationPermission();
    setPermission(status);
    if (status === 'granted' && permissionUid && activeUid.current === permissionUid) {
      void updatePushPermissionState(permissionUid);
    }
  };

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
            <MonoLabel>{t('notifications:screenTitle').toUpperCase()}</MonoLabel>
          </View>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingTop: 14, paddingBottom: 28 }}
          showsVerticalScrollIndicator={false}
        >
          <PermissionBanner
            status={permission}
            onEnable={() => void handleEnablePermission()}
            onOpenSettings={() => void openSystemNotificationSettings()}
          />

          <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
            <SettingsHeader>{t('notifications:screenTitle').toUpperCase()}</SettingsHeader>
            <View
              style={{
                borderRadius: 14,
                overflow: 'hidden',
                backgroundColor: theme.colors.settingsGroupBackground,
                borderWidth: 1,
                borderColor: theme.colors.settingsGroupBorder,
              }}
            >
              {NOTIFICATION_PREFERENCE_KEYS.map((key, index) => (
                <View key={key}>
                  {index > 0 ? <SettingsDivider /> : null}
                  <NotificationToggleRow
                    title={t(`notifications:groups.${key}.title`)}
                    description={t(`notifications:groups.${key}.description`)}
                    value={valueFor(key)}
                    disabled={!user || busyKeys.has(key)}
                    onValueChange={(next) => void handleToggle(key, next)}
                  />
                  {errorKey === key ? (
                    <Text
                      style={[
                        theme.typography.bodySmall,
                        { color: theme.colors.feedbackErrorText, paddingHorizontal: spacing[4], paddingBottom: spacing[3] },
                      ]}
                    >
                      {t('notifications:errors.changeFailed')}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}
