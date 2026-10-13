import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ScreenBg } from '../components/ui/ScreenBg';
import { Card } from '../components/ui/Card';
import { CtaButton } from '../components/ui/CtaButton';
import { Display, MonoLabel } from '../components/ui/Display';
import { Icon, type IconName } from '../components/ui/Icon';
import { FullScreenLoading } from '../components/ui/FullScreenLoading';
import { HealthProviderLogo } from '../components/health/HealthProviderLogo';
import { HealthProviderActionButton } from '../components/health/HealthProviderActionButton';
import { spacing } from '../theme/tokens';
import { useTheme, type AppTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { useScreenFocusEffect } from '../state/ScreenActivity';
import { useHealthIntegration, type UseHealthIntegrationResult } from '../hooks/useHealthIntegration';
import type { UseHealthWeightSyncResult } from '../hooks/useHealthWeightSync';
import type { UseHealthWorkoutExportResult } from '../hooks/useHealthWorkoutExport';
import type { HealthUnavailableReason } from '../types/healthIntegration';

/**
 * Proper nouns — never translated, same across pt-BR/en/es, exactly like
 * "AJ Fit" itself. Everything else on this screen goes through `t()`.
 */
function providerNameFor(platform: UseHealthIntegrationResult['platform']): string {
  if (platform === 'ios') return 'Apple Health';
  if (platform === 'android') return 'Health Connect';
  return 'Apple Health / Health Connect';
}

type Translate = ReturnType<typeof useTranslation<['common', 'health']>>['t'];

function ProviderBadge({
  platform,
  size = 64,
}: {
  platform: UseHealthIntegrationResult['platform'];
  size?: number;
}) {
  return <HealthProviderLogo platform={platform} size={size} />;
}

function ScopeRow({
  theme,
  icon,
  label,
  trailing,
}: {
  theme: AppTheme;
  icon: IconName;
  label: string;
  trailing?: React.ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing[3],
        paddingVertical: spacing[3],
        paddingHorizontal: spacing[4],
      }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 9,
          backgroundColor: theme.colors.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={14} color={theme.colors.textSecondary} />
      </View>
      <Text style={[theme.typography.bodySmall, { flex: 1, color: theme.colors.textPrimary }]}>{label}</Text>
      {trailing}
    </View>
  );
}

/** A thin divider between stacked rows inside the same card. */
function RowDivider({ theme }: { theme: AppTheme }) {
  return <View style={{ height: 1, backgroundColor: theme.colors.cardBorder, marginHorizontal: spacing[4] }} />;
}

/** A row inside the "active features" card — title/subtitle and an ATIVO
 * pill. No icon, no chevron: these rows don't navigate anywhere, so the row
 * only shows the state it describes. */
function FeatureRow({
  theme,
  title,
  subtitle,
  note,
  noteTone = 'faint',
  activeLabel,
}: {
  theme: AppTheme;
  title: string;
  subtitle: string;
  note?: string;
  noteTone?: 'faint' | 'danger';
  activeLabel: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing[3.5],
        minHeight: 56,
        paddingVertical: spacing[3.5],
        paddingHorizontal: spacing[4],
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textPrimary }}>{title}</Text>
        <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, marginTop: spacing[1] }]}>{subtitle}</Text>
        {note ? (
          <Text
            style={[
              theme.typography.bodySmall,
              { fontSize: 12, marginTop: 2, color: noteTone === 'danger' ? theme.colors.dangerText : theme.colors.textFaint },
            ]}
          >
            {note}
          </Text>
        ) : null}
      </View>
      <StatusPill theme={theme} tone="success" label={activeLabel} />
    </View>
  );
}

/** A plain row meant to live inside a shared `Card` alongside other rows
 * (the card itself provides the border/background; this is just the
 * pressable content). `showChevron` is only true for rows that open
 * something else (e.g. native settings) — actions that run in place don't
 * get one. */
function ActionRow({
  theme,
  icon,
  label,
  onPress,
  disabled,
  busy,
  showChevron = false,
  danger,
  accessibilityLabel,
}: {
  theme: AppTheme;
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  showChevron?: boolean;
  danger?: boolean;
  accessibilityLabel: string;
}) {
  const iconColor = danger ? theme.colors.dangerText : theme.colors.textSecondary;
  const textColor = danger ? theme.colors.dangerText : theme.colors.textPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing[3.5],
        minHeight: 52,
        paddingVertical: spacing[3.5],
        paddingHorizontal: spacing[4],
        opacity: pressed || disabled ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={16} color={iconColor} />
      <Text style={{ flex: 1, fontFamily: theme.fonts.uiSemi, fontSize: 14, color: textColor }}>{label}</Text>
      {busy ? (
        <ActivityIndicator size="small" color={danger ? theme.colors.dangerText : theme.colors.textFaint} />
      ) : showChevron ? (
        <Icon name="chevron-right" size={14} color={danger ? theme.colors.dangerText : theme.colors.textFaint} />
      ) : null}
    </Pressable>
  );
}

function StatusPill({ theme, tone, label }: { theme: AppTheme; tone: 'success' | 'off' | 'caution' | 'attention'; label: string }) {
  const tones = {
    success: { color: theme.colors.statusSuccessText, bg: theme.colors.statusSuccessBackground },
    off: { color: theme.colors.statusOffText, bg: theme.colors.statusOffBackground },
    caution: { color: theme.colors.statusCautionText, bg: theme.colors.statusCautionBackground },
    attention: { color: theme.colors.statusAttentionText, bg: theme.colors.statusAttentionBackground },
  }[tone];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: tones.bg,
        alignSelf: 'flex-start',
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tones.color }} />
      <Text style={{ color: tones.color, fontFamily: theme.fonts.monoBold, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
        {label}
      </Text>
    </View>
  );
}

function ErrorBanner({ theme, message }: { theme: AppTheme; message: string }) {
  return (
    <View
      accessibilityRole="alert"
      style={{
        marginHorizontal: 22,
        marginBottom: 16,
        padding: 14,
        borderRadius: 14,
        backgroundColor: theme.colors.feedbackErrorBackground,
        borderWidth: 1,
        borderColor: theme.colors.feedbackErrorBorder,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Icon name="alert-triangle" size={16} color={theme.colors.feedbackErrorIcon} />
      <Text style={[theme.typography.bodySmall, { flex: 1, color: theme.colors.feedbackErrorText }]}>{message}</Text>
    </View>
  );
}

function DisconnectConfirmSheet({
  visible,
  provider,
  busy,
  onConfirm,
  onDismiss,
  t,
}: {
  visible: boolean;
  provider: string;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  t: Translate;
}) {
  const { theme } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable
        onPress={busy ? undefined : onDismiss}
        style={{ flex: 1, backgroundColor: theme.colors.sheetBackdrop, justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: theme.colors.sheetBackground,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderTopWidth: 1,
            borderColor: theme.colors.sheetBorder,
            padding: 22,
            paddingBottom: 28,
            gap: 14,
          }}
        >
          <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 17, color: theme.colors.textPrimary }}>
            {t('health:disconnectConfirm.title', { provider })}
          </Text>
          <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, lineHeight: 19 }]}>
            {t('health:disconnectConfirm.body', { provider })}
          </Text>
          <CtaButton
            onPress={onConfirm}
            disabled={busy}
            accessibilityLabel={t('health:disconnectConfirm.confirm')}
          >
            {busy ? t('health:connected.disconnectingAction') : t('health:disconnectConfirm.confirm')}
          </CtaButton>
          <Pressable
            onPress={onDismiss}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('health:disconnectConfirm.cancel')}
            style={({ pressed }) => ({ paddingVertical: 10, alignItems: 'center', opacity: pressed ? 0.7 : 1 })}
          >
            <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textFaint }}>
              {t('health:disconnectConfirm.cancel')}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function DeleteImportedConfirmSheet({
  visible,
  busy,
  onConfirm,
  onDismiss,
  t,
}: {
  visible: boolean;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  t: Translate;
}) {
  const { theme } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable
        onPress={busy ? undefined : onDismiss}
        style={{ flex: 1, backgroundColor: theme.colors.sheetBackdrop, justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: theme.colors.sheetBackground,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderTopWidth: 1,
            borderColor: theme.colors.sheetBorder,
            padding: 22,
            paddingBottom: 28,
            gap: 14,
          }}
        >
          <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 17, color: theme.colors.textPrimary }}>
            {t('health:deleteImportedConfirm.title')}
          </Text>
          <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, lineHeight: 19 }]}>
            {t('health:deleteImportedConfirm.body')}
          </Text>
          <CtaButton onPress={onConfirm} disabled={busy} accessibilityLabel={t('health:deleteImportedConfirm.confirm')}>
            {busy ? t('health:sync.deleting') : t('health:deleteImportedConfirm.confirm')}
          </CtaButton>
          <Pressable
            onPress={onDismiss}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('health:deleteImportedConfirm.cancel')}
            style={({ pressed }) => ({ paddingVertical: 10, alignItems: 'center', opacity: pressed ? 0.7 : 1 })}
          >
            <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textFaint }}>
              {t('health:deleteImportedConfirm.cancel')}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function UnavailableState({
  theme,
  t,
  provider,
  platform,
  reason,
  message,
  onRetry,
  onOpenNativeSettings,
  retrying,
}: {
  theme: AppTheme;
  t: Translate;
  provider: string;
  platform: UseHealthIntegrationResult['platform'];
  reason: HealthUnavailableReason;
  message?: string;
  onRetry: () => void;
  onOpenNativeSettings: () => void;
  retrying: boolean;
}) {
  const reasonKey = (
    ['provider_missing', 'provider_update_required', 'check_failed', 'platform_unsupported'] as const
  ).includes(reason)
    ? reason
    : 'check_failed';
  return (
    <View style={{ paddingHorizontal: 22, paddingTop: 24, alignItems: 'center', gap: 16 }}>
      <ProviderBadge platform={platform} />
      <Display size={20} style={{ textAlign: 'center' }}>{t('health:unavailable.title')}</Display>
      <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
        {t(`health:unavailable.reason.${reasonKey}`, { provider })}
        {message ? `\n${message}` : ''}
      </Text>
      <View style={{ width: '100%', gap: 10, marginTop: 8 }}>
        <CtaButton onPress={onRetry} disabled={retrying} accessibilityLabel={t('health:unavailable.retryAction')}>
          {retrying ? t('health:loading') : t('health:unavailable.retryAction')}
        </CtaButton>
        {reason === 'provider_missing' || reason === 'provider_update_required' ? (
          <CtaButton ghost onPress={onOpenNativeSettings} accessibilityLabel={t('health:unavailable.openSettingsAction')}>
            {t('health:unavailable.openSettingsAction')}
          </CtaButton>
        ) : null}
      </View>
    </View>
  );
}

export function HealthIntegrationScreen({
  onBack,
  weightSync,
  workoutExport,
}: {
  onBack?: () => void;
  weightSync: UseHealthWeightSyncResult;
  workoutExport: UseHealthWorkoutExportResult;
}) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const { t, i18n } = useTranslation(['common', 'health']);
  const health = useHealthIntegration(uid);
  const { refresh } = health;
  const provider = providerNameFor(health.platform);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const locale = i18n.resolvedLanguage ?? i18n.language;

  const lastExportLabel = workoutExport.lastSuccessfulAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(workoutExport.lastSuccessfulAt)
    : t('health:export.never');

  // Split into a date line and a time line (vs. one combined string) to
  // match the "ÚLTIMA SINCRONIZAÇÃO" card's two-line layout, with a "Today,"
  // prefix on the date when it falls on the current calendar day.
  const lastSyncDate = weightSync.lastSuccessfulAt;
  const lastSyncDateLabel = lastSyncDate
    ? lastSyncDate.toDateString() === new Date().toDateString()
      ? t('health:connected.lastSyncToday', {
          date: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(lastSyncDate),
        })
      : new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(lastSyncDate)
    : t('health:sync.never');
  const lastSyncTimeLabel = lastSyncDate ? new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(lastSyncDate) : null;

  // Fase 1 §16: resuming from the system Settings app (or the Health /
  // Health Connect app itself) is the only moment OS-level authorization can
  // change while this screen is alive.
  useScreenFocusEffect(() => {
    void refresh();
  });
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const errorMessage = health.errorCode ? t(`health:errors.${health.errorCode}`, { provider }) : null;

  const renderBody = () => {
    if (health.loading) {
      return <FullScreenLoading accessibilityLabel={t('health:loading')} />;
    }

    if (health.availability.status === 'unsupported' || health.availability.status === 'unavailable') {
      const reason = health.availability.status === 'unavailable' ? health.availability.reason : 'platform_unsupported';
      const message = health.availability.status === 'unavailable' ? health.availability.message : undefined;
      return (
        <UnavailableState
          theme={theme}
          t={t}
          provider={provider}
          platform={health.platform}
          reason={reason}
          message={message}
          retrying={health.refreshing}
          onRetry={() => void health.refresh()}
          onOpenNativeSettings={() => void health.openNativeSettings()}
        />
      );
    }

    if (health.intent === 'enabled') {
      const grantedAndroid = health.authorization?.platform === 'android' ? health.authorization.granted : null;
      const isWeightGranted = !!grantedAndroid?.some((p) => p.accessType === 'read' && p.recordType === 'Weight');
      const isWorkoutGranted = !!grantedAndroid?.some((p) => p.accessType === 'write' && p.recordType === 'ExerciseSession');
      const activeLabel = t('health:connected.activeLabel');

      const weightAndroidNote =
        health.platform === 'android'
          ? t(isWeightGranted ? 'health:connected.androidPermissionGranted' : 'health:connected.androidPermissionNotGranted')
          : null;
      const weightStatusNote =
        weightSync.status === 'error'
          ? t('health:sync.status.error')
          : weightSync.lastImportedCount > 0
            ? t('health:sync.importedCount', { count: weightSync.lastImportedCount })
            : null;
      const weightSubtitle = weightAndroidNote
        ? `${t('health:connected.weightSubtitle')} · ${weightAndroidNote}`
        : t('health:connected.weightSubtitle');

      const workoutAndroidNote =
        health.platform === 'android'
          ? t(isWorkoutGranted ? 'health:connected.androidPermissionGranted' : 'health:connected.androidPermissionNotGranted')
          : null;
      const workoutStatusNote =
        workoutExport.status === 'error'
          ? t('health:export.status.error')
          : workoutExport.pendingCount > 0
            ? t('health:export.pendingCount', { count: workoutExport.pendingCount })
            : workoutExport.lastExportedCount > 0
              ? t('health:export.exportedCount', { count: workoutExport.lastExportedCount })
              : workoutExport.lastSuccessfulAt
                ? t('health:export.lastSuccessful', { date: lastExportLabel })
                : null;
      const workoutSubtitle = workoutAndroidNote
        ? `${t('health:connected.workoutsSubtitle')} · ${workoutAndroidNote}`
        : t('health:connected.workoutsSubtitle');

      const showRetryExport = workoutExport.pendingCount > 0 || workoutExport.status === 'error';

      return (
        <View style={{ paddingHorizontal: 22, paddingTop: 20, gap: 24 }}>
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[4] }}>
              <ProviderBadge platform={health.platform} size={64} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 22, color: theme.colors.textPrimary }}>
                  {provider}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.statusSuccessText }} />
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.statusSuccessText }]}>
                    {t('health:connected.statusTitle')}
                  </Text>
                </View>
              </View>
            </View>
            <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, lineHeight: 19 }]}>
              {t('health:connected.statusDescription')}
            </Text>
          </View>

          <View style={{ gap: 10 }}>
            <SectionHeader theme={theme} inset={false}>
              {t('health:connected.lastSyncSectionTitle')}
            </SectionHeader>
            <Card>
              <FeatureRow
                theme={theme}
                title={t('health:connected.weightTitle')}
                subtitle={weightSubtitle}
                note={weightStatusNote ?? undefined}
                noteTone={weightSync.status === 'error' ? 'danger' : 'faint'}
                activeLabel={activeLabel}
              />
              <RowDivider theme={theme} />
              <FeatureRow
                theme={theme}
                title={t('health:connected.workoutsTitle')}
                subtitle={workoutSubtitle}
                note={workoutStatusNote ?? undefined}
                noteTone={workoutExport.status === 'error' ? 'danger' : 'faint'}
                activeLabel={activeLabel}
              />
              <RowDivider theme={theme} />
              <View
                style={{
                  minHeight: 44,
                  justifyContent: 'center',
                  paddingVertical: spacing[3],
                  paddingHorizontal: spacing[4],
                }}
              >
                <Text style={[theme.typography.bodySmall, { color: theme.colors.textFaint }]}>
                  {lastSyncTimeLabel ? `${lastSyncDateLabel} · ${lastSyncTimeLabel}` : lastSyncDateLabel}
                </Text>
              </View>
            </Card>
          </View>

          <View style={{ gap: 10 }}>
            <SectionHeader theme={theme} inset={false}>
              {t('health:connected.actionsSectionTitle')}
            </SectionHeader>
            <Card>
              <ActionRow
                theme={theme}
                icon="refresh"
                label={weightSync.syncing ? t('health:sync.syncing') : t('health:sync.manualAction')}
                onPress={() => void weightSync.syncNow()}
                disabled={weightSync.syncing || weightSync.deleting}
                busy={weightSync.syncing}
                accessibilityLabel={t('health:sync.manualAction')}
              />
              <RowDivider theme={theme} />
              <ActionRow
                theme={theme}
                icon="settings"
                label={t('health:connected.manageAction')}
                onPress={() => void health.openNativeSettings()}
                showChevron
                accessibilityLabel={t('health:connected.manageAction')}
              />
              {showRetryExport ? (
                <>
                  <RowDivider theme={theme} />
                  <ActionRow
                    theme={theme}
                    icon="dumbbell"
                    label={workoutExport.exporting ? t('health:export.retrying') : t('health:export.retryAction')}
                    onPress={() => void workoutExport.retryNow()}
                    disabled={workoutExport.exporting}
                    busy={workoutExport.exporting}
                    accessibilityLabel={t('health:export.retryAction')}
                  />
                </>
              ) : null}
            </Card>
          </View>

          {health.platform === 'android' ? (
            <Text style={[theme.typography.bodySmall, { color: theme.colors.textFaint, lineHeight: 17, paddingHorizontal: 2 }]}>
              {t('health:connected.androidImportantNotice')}
            </Text>
          ) : null}

          <View style={{ gap: 6 }}>
            <Card>
              <ActionRow
                theme={theme}
                icon="trash"
                danger
                label={weightSync.deleting ? t('health:sync.deleting') : t('health:data.deleteAction')}
                onPress={() => setConfirmingDelete(true)}
                disabled={weightSync.deleting || weightSync.syncing}
                busy={weightSync.deleting}
                accessibilityLabel={t('health:data.deleteAction')}
              />
            </Card>
            <Text style={[theme.typography.bodySmall, { fontSize: 12, color: theme.colors.textFaint, lineHeight: 16, paddingHorizontal: spacing[4] }]}>
              {t('health:data.description')}
            </Text>
          </View>
        </View>
      );
    }

    // intent is 'not_configured' or 'disabled' — same disconnected UI either
    // way; nothing in copy distinguishes "never asked" from "asked and said no".
    // Top block anchors near the header, the card+privacy block follows with
    // normal spacing, and the CTA is pushed to the bottom via marginTop: 'auto'
    // so it lands near the safe area on tall screens without gluing to the
    // card, while still flowing naturally (and scrolling) on short screens.
    return (
      <View style={{ flex: 1, paddingHorizontal: 22, paddingTop: 28, paddingBottom: 24 }}>
        <View style={{ alignItems: 'center', gap: 14 }}>
          <ProviderBadge platform={health.platform} />
          <Display size={22} style={{ textAlign: 'center' }}>
            {t('health:disconnected.heroTitle', { provider })}
          </Display>
        </View>

        <View style={{ marginTop: 28, gap: 18 }}>
          <Card style={{ padding: spacing[4], gap: 12 }}>
            <SectionHeader theme={theme} inset={false}>{t('health:disconnected.benefitsTitle')}</SectionHeader>
            <ScopeRow theme={theme} icon="heart" label={t('health:disconnected.benefitWeight', { provider })} />
            <ScopeRow theme={theme} icon="bolt" label={t('health:disconnected.benefitWorkouts', { provider })} />
          </Card>

          <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 2 }}>
            <Icon name="shield" size={15} color={theme.colors.textFaint} />
            <Text style={[theme.typography.bodySmall, { flex: 1, color: theme.colors.textFaint, lineHeight: 17 }]}>
              {t('health:disconnected.privacyNote')}
            </Text>
          </View>
        </View>

        <View style={{ marginTop: 'auto', paddingTop: 24 }}>
          <HealthProviderActionButton
            platform={health.platform}
            onPress={() => {
              // `connect()` resolves only after the native permission sheet has
              // closed. Starting sooner would race Android's grant update.
              void health.connect().then(() => Promise.all([
                weightSync.syncNow(),
                workoutExport.retryNow(),
              ]));
            }}
            disabled={health.requestingPermissions}
            loading={health.requestingPermissions}
            accessibilityLabel={t('health:disconnected.connectAction', { provider })}
            label={health.requestingPermissions
              ? t('health:disconnected.connectingAction')
              : t('health:disconnected.connectAction', { provider })}
          />
        </View>
      </View>
    );
  };

  const renderDisconnect = () => {
    if (health.loading || health.platform === 'unsupported' || health.intent !== 'enabled') return null;
    return (
      <View style={{ paddingHorizontal: 22, paddingTop: 18 }}>
        <Card>
          <ActionRow
            theme={theme}
            icon="trash"
            danger
            label={
              health.disconnecting
                ? t('health:connected.disconnectingAction')
                : t('health:connected.disconnectAction', { provider })
            }
            onPress={() => setConfirmingDisconnect(true)}
            disabled={health.disconnecting}
            busy={health.disconnecting}
            accessibilityLabel={t('health:connected.disconnectAction', { provider })}
          />
        </Card>
      </View>
    );
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
            accessibilityLabel={t('health:backAccessibility')}
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
            <MonoLabel numberOfLines={1}>{provider.toUpperCase()}</MonoLabel>
          </View>
          <View style={{ width: 38 }} />
        </View>

        {errorMessage ? <ErrorBanner theme={theme} message={errorMessage} /> : null}

        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
          {renderBody()}
          {renderDisconnect()}
        </ScrollView>
      </SafeAreaView>

      <DisconnectConfirmSheet
        visible={confirmingDisconnect}
        provider={provider}
        busy={health.disconnecting}
        t={t}
        onConfirm={() => {
          void health.disconnect().then(() => setConfirmingDisconnect(false));
        }}
        onDismiss={() => setConfirmingDisconnect(false)}
      />
      <DeleteImportedConfirmSheet
        visible={confirmingDelete}
        busy={weightSync.deleting}
        t={t}
        onConfirm={() => {
          void weightSync.deleteImported().then(() => setConfirmingDelete(false));
        }}
        onDismiss={() => setConfirmingDelete(false)}
      />
    </ScreenBg>
  );
}

function SectionHeader({ theme, children, inset = true }: { theme: AppTheme; children: React.ReactNode; inset?: boolean }) {
  return (
    <Text
      style={{
        fontFamily: theme.fonts.mono,
        fontSize: 10,
        letterSpacing: 1.4,
        color: theme.colors.textFaint,
        marginBottom: 8,
        marginLeft: inset ? spacing[1] : 0,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </Text>
  );
}
