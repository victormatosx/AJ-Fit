import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { doc, onSnapshot } from 'firebase/firestore';

import { ScreenBg } from '../components/ui/ScreenBg';
import { MonoLabel } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { SettingsDivider, SettingsHeader } from '../components/ui/SettingsSection';
import { spacing } from '../theme/tokens';
import { useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { useScreenFocusEffect } from '../state/ScreenActivity';
import { db } from '../lib/firebase';
import {
  getLastKnownNotificationPermissionStatus,
  getNotificationPermissionStatus,
  openSystemNotificationSettings,
  requestNotificationPermission,
  type PushPermissionStatus,
} from '../services/pushNotifications';
import { updatePushPermissionState } from '../services/pushDeviceRegistration';
import {
  changeNotificationPreferencesForUser,
  getLastKnownNotificationPreferences,
  readPendingNotificationPreferences,
  recordLastKnownNotificationPreferences,
  reconcilePendingNotificationPreferences,
} from '../services/notificationPreferences';
import {
  NOTIFICATION_PREFERENCE_KEYS,
  allNotificationPreferencesEnabled,
  resolveNotificationPreference,
  setAllNotificationPreferences,
  type NotificationPreferenceKey,
  type NotificationPreferences,
} from '../types/notificationPreferences';
import { logError } from '../lib/logError';

/**
 * A device's OS permission and a user's category preference are two
 * independent axes (Fase 4 §10/§24): this banner reflects the FORMER only.
 * The category toggles below always reflect the latter, even while the OS
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

// Custom switch, local to this screen only (the RN built-in `Switch` was the
// only other user of this visual role in the app — see the audit before this
// change — so swapping it here carries no risk of touching another screen).
// Track and thumb use deliberately different token families in BOTH states
// so the two never read as the same color: an always-white thumb
// (`primaryForeground`, true white/near-white in both themes) against a
// tonal neutral track off (`controlHighlight`) or the brand accent on
// (`primaryEmphasis`) — the same pairing iOS/Android system switches use,
// which is why it reads as legible at a glance.
const SWITCH_TRACK_WIDTH = 50;
const SWITCH_TRACK_HEIGHT = 30;
const SWITCH_THUMB_SIZE = 24;
const SWITCH_THUMB_INSET = 3;
const SWITCH_THUMB_TRAVEL = SWITCH_TRACK_WIDTH - SWITCH_THUMB_SIZE - SWITCH_THUMB_INSET * 2;

function PremiumSwitch({
  value,
  disabled,
  accessibilityLabel,
  onValueChange,
}: {
  value: boolean;
  disabled?: boolean;
  accessibilityLabel: string;
  onValueChange: (next: boolean) => void;
}) {
  const { theme } = useTheme();
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: value ? 1 : 0,
      duration: theme.motion.duration.normal,
      useNativeDriver: false,
    }).start();
  }, [value, progress, theme.motion.duration.normal]);

  const trackColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.colors.controlHighlight, theme.colors.primaryEmphasis],
  });
  const thumbTranslateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [SWITCH_THUMB_INSET, SWITCH_THUMB_INSET + SWITCH_THUMB_TRAVEL],
  });

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
    >
      <Animated.View
        style={{
          width: SWITCH_TRACK_WIDTH,
          height: SWITCH_TRACK_HEIGHT,
          borderRadius: SWITCH_TRACK_HEIGHT / 2,
          backgroundColor: trackColor,
        }}
      >
        <Animated.View
          style={{
            position: 'absolute',
            top: SWITCH_THUMB_INSET,
            width: SWITCH_THUMB_SIZE,
            height: SWITCH_THUMB_SIZE,
            borderRadius: SWITCH_THUMB_SIZE / 2,
            backgroundColor: theme.colors.primaryForeground,
            transform: [{ translateX: thumbTranslateX }],
            shadowColor: theme.colors.floatingShadow,
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.25,
            shadowRadius: 2,
            elevation: 2,
          }}
        />
      </Animated.View>
    </Pressable>
  );
}

function NotificationToggleRow({
  title,
  description,
  value,
  disabled,
  onValueChange,
  emphasized = false,
}: {
  title: string;
  description: string;
  value: boolean;
  disabled: boolean;
  onValueChange: (next: boolean) => void;
  /** The single master row: slightly larger type, no dimming when disabled-by-signed-out (the card around it already communicates that). */
  emphasized?: boolean;
}) {
  const { theme } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing[3.5],
        minHeight: emphasized ? 56 : 48,
        paddingVertical: emphasized ? spacing[4] : spacing[3.5],
        paddingHorizontal: spacing[4],
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: emphasized ? theme.fonts.uiBold : theme.fonts.uiSemi,
            fontSize: emphasized ? 15.5 : 14,
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
      <PremiumSwitch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={title}
      />
    </View>
  );
}

export function NotificationSettingsScreen({ onBack }: { onBack?: () => void }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const { t } = useTranslation(['common', 'notifications']);

  // Seeded synchronously from the in-memory hints below instead of
  // null/undefined — both are warmed at app boot (well before this screen
  // can be reached) and kept fresh on every real update, so the very first
  // render already shows the permission banner (or its absence) and every
  // toggle's real state instead of a guessed default that then visibly
  // flips. See `getLastKnownNotificationPermissionStatus` and
  // `getLastKnownNotificationPreferences` for why this is safe: neither is
  // a source of truth, both are corrected the moment the real async read
  // resolves (same as before this screen read them), and absent a warm
  // hint these fall back to exactly the previous null/undefined behavior.
  const [permission, setPermission] = useState<PushPermissionStatus | null>(
    () => getLastKnownNotificationPermissionStatus(),
  );
  const [errorKey, setErrorKey] = useState<NotificationPreferenceKey | 'all' | null>(null);
  const [overrides, setOverrides] = useState<Partial<Record<NotificationPreferenceKey, boolean>>>({});
  const [remoteState, setRemoteState] = useState<{
    uid: string;
    preferences: NotificationPreferences | undefined;
  } | null>(() => (uid ? { uid, preferences: getLastKnownNotificationPreferences(uid) } : null));
  const activeUid = useRef<string | null>(uid);
  const latestValues = useRef<NotificationPreferences>({});
  const optimisticKeys = useRef<Set<NotificationPreferenceKey>>(new Set());
  const mutationVersions = useRef<Partial<Record<NotificationPreferenceKey, number>>>({});

  useLayoutEffect(() => {
    activeUid.current = uid;
  }, [uid]);

  const refreshPermission = useCallback(async () => {
    setPermission(await getNotificationPermissionStatus());
  }, []);

  const syncPending = useCallback(async (targetUid: string) => {
    try {
      await reconcilePendingNotificationPreferences(targetUid);
      const pending = await readPendingNotificationPreferences(targetUid);
      if (activeUid.current !== targetUid) return;
      setOverrides((current) => {
        const next = { ...current };
        for (const key of NOTIFICATION_PREFERENCE_KEYS) {
          if (mutationVersions.current[key]) continue;
          if (pending[key] === undefined) {
            delete next[key];
            optimisticKeys.current.delete(key);
          } else {
            next[key] = pending[key];
            optimisticKeys.current.add(key);
          }
        }
        return next;
      });
    } catch (error) {
      logError('notificationSettings:reconcile', error, { uid: targetUid });
    }
  }, []);

  // docs/23_navegacao_e_lifecycle.md §5: this screen now stays mounted
  // (PersistentScreen, AppShell.tsx) while hidden, so `useEffect(fn, [])`
  // would only ever run once per app session — the permission status and
  // any pending preference mutation must instead be refreshed every time
  // the user actually (re)enters this screen, not just the first time it's
  // created. `useScreenFocusEffect` fires on first activation too, so this
  // fully replaces the old mount-only effect without a behavior gap.
  useScreenFocusEffect(() => {
    setErrorKey(null);
    void refreshPermission();
    if (uid) void syncPending(uid);
  });

  useEffect(() => {
    let active = true;
    setOverrides({});
    // Re-seed from the hint rather than hard-resetting to null/undefined —
    // relevant if `uid` ever changes while this instance stays mounted
    // (the `key={uid}` remount in AppShell makes that the common case, but
    // this effect still needs to behave correctly standalone).
    setRemoteState(uid ? { uid, preferences: getLastKnownNotificationPreferences(uid) } : null);
    setErrorKey(null);
    latestValues.current = {};
    optimisticKeys.current.clear();
    mutationVersions.current = {};
    if (!uid) return () => { active = false; };

    void (async () => {
      const pending = await readPendingNotificationPreferences(uid);
      if (!active || activeUid.current !== uid) return;
      latestValues.current = { ...latestValues.current, ...pending };
      Object.keys(pending).forEach((key) =>
        optimisticKeys.current.add(key as NotificationPreferenceKey));
      setOverrides((current) => ({ ...pending, ...current }));
      await syncPending(uid);
    })().catch((error) => logError('notificationSettings:pending', error, { uid }));
    const unsubscribe = onSnapshot(doc(db, 'users', uid), (snapshot) => {
      if (!active || activeUid.current !== uid) return;
      const preferences = snapshot.data()?.preferences?.notificationPreferences as
        NotificationPreferences | undefined;
      recordLastKnownNotificationPreferences(uid, preferences ?? {});
      setRemoteState({ uid, preferences });
      latestValues.current = Object.fromEntries(NOTIFICATION_PREFERENCE_KEYS.map((key) => [
        key,
        optimisticKeys.current.has(key)
          ? resolveNotificationPreference(latestValues.current, key)
          : resolveNotificationPreference(preferences, key),
      ]));
    }, (error) => logError('notificationSettings:snapshot', error, { uid }));
    return () => { active = false; unsubscribe(); };
  }, [uid, syncPending]);

  // Fase 4 §16: resuming from the system Settings app is the only moment the
  // OS permission can change while this screen is alive — no polling, just
  // the same AppState-driven resume check Fase 2's device runtime already
  // uses. Both the local UI and the backend's own record of pushEnabled are
  // refreshed, since either could now be stale.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void refreshPermission();
      if (uid) {
        void updatePushPermissionState(uid);
        void syncPending(uid);
      }
    });
    return () => subscription.remove();
  }, [refreshPermission, syncPending, uid]);

  const storedPreferences: NotificationPreferences | undefined =
    remoteState?.uid === uid
      ? remoteState.preferences
      : undefined;

  const valueFor = (key: NotificationPreferenceKey): boolean =>
    overrides[key] ?? resolveNotificationPreference(storedPreferences, key);

  const handleChanges = async (
    changes: NotificationPreferences,
    errorTarget: NotificationPreferenceKey | 'all',
  ) => {
    const mutationUid = uid;
    if (!mutationUid) return;
    const keys = Object.keys(changes) as NotificationPreferenceKey[];
    const versions = Object.fromEntries(keys.map((key) => {
      const version = (mutationVersions.current[key] ?? 0) + 1;
      mutationVersions.current[key] = version;
      return [key, version];
    })) as Partial<Record<NotificationPreferenceKey, number>>;
    const current = { ...storedPreferences, ...overrides, ...latestValues.current };
    latestValues.current = { ...current, ...changes };
    keys.forEach((key) => optimisticKeys.current.add(key));
    setErrorKey(null);
    setOverrides((value) => ({ ...value, ...changes }));

    try {
      const { remote } = await changeNotificationPreferencesForUser({
        uid: mutationUid,
        current,
        changes,
      });
      void remote
        .then(async (outcome) => {
          if (activeUid.current !== mutationUid) return;
          if (outcome.status === 'rolled-back') {
            const pending = await readPendingNotificationPreferences(mutationUid);
            if (activeUid.current !== mutationUid) return;
            latestValues.current = { ...storedPreferences, ...pending };
            setErrorKey(errorTarget);
          }
          if (outcome.status === 'pending') return;
          setOverrides((current) => {
            const next = { ...current };
            for (const key of keys) {
              if (mutationVersions.current[key] === versions[key]) {
                delete next[key];
                optimisticKeys.current.delete(key);
              }
            }
            return next;
          });
        })
        .catch((err) => logError('notificationSettings:remote', err, { errorTarget }));
    } catch (err) {
      logError('notificationSettings:toggle', err, { errorTarget });
      if (activeUid.current !== mutationUid) return;
      setOverrides((current) => {
        const updated = { ...current };
        for (const key of keys) {
          if (mutationVersions.current[key] === versions[key]) {
            delete updated[key];
            optimisticKeys.current.delete(key);
          }
        }
        return updated;
      });
      setErrorKey(errorTarget);
    }
  };

  const handleToggle = (key: NotificationPreferenceKey, next: boolean) =>
    void handleChanges({ [key]: next }, key);

  const handleAllToggle = (next: boolean) =>
    void handleChanges(setAllNotificationPreferences(next), 'all');

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

          {/* Master control — its own card, tinted and bordered with the
              brand accent instead of the neutral settings-group styling
              below, so it reads as superior to (not just first among) the
              individual categories. */}
          <View style={{ paddingHorizontal: 22, paddingBottom: spacing[7] }}>
            <View
              style={{
                borderRadius: 14,
                overflow: 'hidden',
                backgroundColor: theme.colors.primarySurfaceSubtle,
                borderWidth: 1,
                borderColor: theme.colors.primaryBorderSoft,
              }}
            >
              <NotificationToggleRow
                emphasized
                title={t('notifications:all.title')}
                description={t('notifications:all.description')}
                value={allNotificationPreferencesEnabled(Object.fromEntries(
                  NOTIFICATION_PREFERENCE_KEYS.map((key) => [key, valueFor(key)]),
                ))}
                disabled={!user}
                onValueChange={handleAllToggle}
              />
              {errorKey === 'all' ? (
                <Text style={[theme.typography.bodySmall, {
                  color: theme.colors.feedbackErrorText,
                  paddingHorizontal: spacing[4], paddingBottom: spacing[3],
                }]}>{t('notifications:errors.changeFailed')}</Text>
              ) : null}
            </View>
          </View>

          {/* Individual categories — same neutral card styling the rest of
              the app's settings groups use, visually subordinate to the
              master card above. */}
          <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
            <SettingsHeader>{t('notifications:categoriesSectionTitle').toUpperCase()}</SettingsHeader>
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
                    disabled={!user}
                    onValueChange={(next) => handleToggle(key, next)}
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
