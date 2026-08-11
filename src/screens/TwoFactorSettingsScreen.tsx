import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ReauthenticationMethods } from '../components/auth/ReauthenticationMethods';
import { SupportScreenHeader } from '../components/support/SupportScreenHeader';
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { Icon } from '../components/ui/Icon';
import { ScreenBg } from '../components/ui/ScreenBg';
import { useTotpMfa } from '../hooks/useTotpMfa';
import type { MfaTotpIssue } from '../lib/mfaTotp';
import type { TotpFactor } from '../services/mfaTotp';
import { colors, fonts, radii, sizes, spacing, typography } from '../theme/tokens';

export function TwoFactorSettingsScreen({
  onBack,
  onOpenEnrollment,
  refreshToken = 0,
}: {
  onBack: () => void;
  onOpenEnrollment: () => void;
  refreshToken?: number;
}) {
  const { t, i18n } = useTranslation('settings');
  const mfa = useTotpMfa(refreshToken);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const statusUnavailable =
    !mfa.loading && mfa.factors.length === 0 && mfa.issue !== null;

  const requestDisable = (factor: TotpFactor) => {
    Alert.alert(
      t('security.twoFactor.disableConfirmation.title'),
      t('security.twoFactor.disableConfirmation.message'),
      [
        { text: t('security.twoFactor.actions.cancel'), style: 'cancel' },
        {
          text: t('security.twoFactor.actions.disable'),
          style: 'destructive',
          onPress: () => mfa.requestDisable(factor),
        },
      ],
    );
  };

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <SupportScreenHeader
          title={t('security.twoFactor.title')}
          onBack={onBack}
          disabled={mfa.disabling}
        />
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.statusCard}>
            <View style={styles.statusIcon}>
              <Icon
                name={mfa.enabled ? 'check' : 'shield'}
                size={22}
                color={mfa.enabled ? colors.success : colors.accentHi}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodySmall, { color: colors.faint }]}>
                {t('security.twoFactor.status.label')}
              </Text>
              <Text
                style={[
                  typography.title,
                  { color: mfa.enabled ? colors.success : colors.text },
                ]}
              >
                {mfa.loading
                  ? t('security.twoFactor.status.loading')
                  : statusUnavailable
                    ? t('security.twoFactor.status.unavailable')
                  : mfa.enabled
                    ? t('security.twoFactor.status.enabled')
                    : t('security.twoFactor.status.disabled')}
              </Text>
            </View>
            {mfa.loading && <ActivityIndicator color={colors.accentHi} />}
          </View>

          <Text style={[typography.body, styles.description]}>
            {t('security.twoFactor.description')}
          </Text>

          {!mfa.enabled && !mfa.loading && !statusUnavailable ? (
            <View style={styles.infoCard}>
              <InfoItem
                icon="key"
                title={t('security.twoFactor.benefits.authenticator.title')}
                description={t(
                  'security.twoFactor.benefits.authenticator.description',
                )}
              />
              <InfoItem
                icon="timer"
                title={t('security.twoFactor.benefits.offline.title')}
                description={t('security.twoFactor.benefits.offline.description')}
              />
            </View>
          ) : null}

          {mfa.enabled && !mfa.loading ? (
            <View style={{ gap: spacing[3], marginTop: spacing[6] }}>
              {mfa.multipleFactors ? (
                <Feedback
                  tone="warning"
                  message={t('security.twoFactor.feedback.multipleFactors')}
                />
              ) : null}
              {mfa.factors.map((factor) => {
                const enrolledAt = formatEnrollmentDate(
                  factor.enrollmentTime,
                  i18n.resolvedLanguage ?? i18n.language,
                );
                return (
                  <View key={factor.uid} style={styles.factorCard}>
                    <View style={styles.factorHeader}>
                      <Icon name="key" size={19} color={colors.accentHi} />
                      <View style={{ flex: 1 }}>
                        <Text style={[typography.subtitle, { color: colors.text }]}>
                          {t('security.twoFactor.method.authenticator')}
                        </Text>
                        {factor.displayName ? (
                          <Text
                            style={[
                              typography.bodySmall,
                              {
                                color: colors.textSecondary,
                                marginTop: spacing[1],
                              },
                            ]}
                          >
                            {factor.displayName}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    {enrolledAt ? (
                      <Text style={[typography.data, { color: colors.faint }]}>
                        {t('security.twoFactor.enrolledAt', { date: enrolledAt })}
                      </Text>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      disabled={
                        mfa.disabling || !mfa.canReauthenticate
                      }
                      onPress={() => requestDisable(factor)}
                      style={({ pressed }) => [
                        styles.disableButton,
                        {
                          opacity:
                            mfa.disabling || !mfa.canReauthenticate
                              ? 0.35
                              : pressed
                                ? 0.8
                                : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[typography.subtitle, { color: colors.dangerText }]}
                      >
                        {t('security.twoFactor.actions.disable')}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : null}

          {!mfa.canReauthenticate && !mfa.loading ? (
            <Feedback
              tone="warning"
              message={t('security.twoFactor.errors.reauthProviderUnsupported')}
            />
          ) : null}
          {mfa.issue ? (
            <Feedback tone="error" message={issueMessage(mfa.issue, t)} />
          ) : null}
          {statusUnavailable ? (
            <CtaButton
              ghost
              onPress={() => void mfa.refresh()}
              style={{ marginTop: spacing[4] }}
            >
              <CtaText>{t('security.twoFactor.actions.retry')}</CtaText>
            </CtaButton>
          ) : null}
          {mfa.disabled ? (
            <Feedback
              tone="success"
              message={t('security.twoFactor.feedback.disabled')}
            />
          ) : null}

          {!mfa.enabled && !mfa.loading && !statusUnavailable ? (
            <CtaButton
              onPress={onOpenEnrollment}
              disabled={!mfa.canReauthenticate}
              style={{ marginTop: spacing[7] }}
            >
              <CtaText>{t('security.twoFactor.actions.enable')}</CtaText>
            </CtaButton>
          ) : null}
        </ScrollView>

        <Modal
          visible={mfa.disableTarget !== null}
          transparent
          animationType="fade"
          onRequestClose={mfa.cancelDisable}
          statusBarTranslucent
        >
          <View style={styles.modalScrim}>
            <View style={styles.modalCard}>
              <Text style={[typography.title, { color: colors.text }]}>
                {t('security.twoFactor.reauth.title')}
              </Text>
              <Text style={[typography.bodySmall, styles.modalDescription]}>
                {mfa.disableChallenge
                  ? t('security.twoFactor.reauth.codeDescription')
                  : t('security.twoFactor.reauth.disableDescription')}
              </Text>
              {mfa.disableChallenge ? (
                <TextInput
                  accessibilityLabel={t('security.twoFactor.enrollment.codeLabel')}
                  value={mfa.reauthCode}
                  onChangeText={mfa.setReauthCode}
                  editable={!mfa.disabling}
                  keyboardType="number-pad"
                  maxLength={6}
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  importantForAutofill="yes"
                  placeholder={t('security.twoFactor.enrollment.codePlaceholder')}
                  placeholderTextColor={colors.faint}
                  style={styles.codeInput}
                  onSubmitEditing={() => void mfa.confirmDisableCode()}
                />
              ) : (
                <ReauthenticationMethods
                  providers={mfa.reauthenticationProviders}
                  password={mfa.currentPassword}
                  passwordVisible={passwordVisible}
                  busyProvider={mfa.disablingProvider}
                  disabled={mfa.disabling}
                  onChangePassword={mfa.setCurrentPassword}
                  onTogglePassword={() =>
                    setPasswordVisible((value) => !value)
                  }
                  onConfirm={(provider) => void mfa.confirmDisable(provider)}
                />
              )}
              {mfa.issue ? (
                <Feedback tone="error" message={issueMessage(mfa.issue, t)} />
              ) : null}
              {mfa.disableChallenge ? (
                <CtaButton
                  onPress={() => void mfa.confirmDisableCode()}
                  disabled={mfa.disabling}
                  style={{ marginTop: spacing[5] }}
                >
                  {mfa.disabling ? (
                    <ActivityIndicator color={colors.text} />
                  ) : (
                    <CtaText>{t('security.twoFactor.actions.continue')}</CtaText>
                  )}
                </CtaButton>
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={mfa.cancelDisable}
                disabled={mfa.disabling}
                style={styles.cancelButton}
              >
                <Text style={[typography.subtitle, { color: colors.mute }]}>
                  {t('security.twoFactor.actions.cancel')}
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </ScreenBg>
  );
}

function formatEnrollmentDate(value: string, language: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(language, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function issueMessage(
  issue: MfaTotpIssue,
  t: ReturnType<typeof useTranslation<'settings'>>['t'],
) {
  return t(`security.twoFactor.errors.${issue}`);
}

function InfoItem({
  icon,
  title,
  description,
}: {
  icon: 'key' | 'timer';
  title: string;
  description: string;
}) {
  return (
    <View style={styles.infoItem}>
      <Icon name={icon} size={18} color={colors.accentHi} />
      <View style={{ flex: 1 }}>
        <Text style={[typography.subtitle, { color: colors.text }]}>{title}</Text>
        <Text
          style={[
            typography.bodySmall,
            { color: colors.textSecondary, marginTop: spacing[1] },
          ]}
        >
          {description}
        </Text>
      </View>
    </View>
  );
}

function Feedback({
  tone,
  message,
}: {
  tone: 'error' | 'warning' | 'success';
  message: string;
}) {
  const color =
    tone === 'success'
      ? colors.success
      : tone === 'warning'
        ? colors.warning
        : colors.dangerText;
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      style={[
        styles.feedback,
        {
          borderColor: `${color}59`,
          backgroundColor: `${color}19`,
        },
      ]}
    >
      <Icon
        name={tone === 'success' ? 'check' : 'alert-triangle'}
        size={17}
        color={color}
      />
      <Text style={[typography.bodySmall, { color, flex: 1 }]}>{message}</Text>
    </View>
  );
}

const styles = {
  content: {
    width: '100%' as const,
    maxWidth: sizes.contentMaxWidth,
    alignSelf: 'center' as const,
    paddingHorizontal: sizes.screenGutter,
    paddingTop: spacing[4],
    paddingBottom: spacing[10],
  },
  statusCard: {
    padding: spacing[4],
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[3],
  },
  statusIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  description: {
    color: colors.textSecondary,
    marginTop: spacing[5],
  },
  infoCard: {
    marginTop: spacing[6],
    padding: spacing[4],
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing[4],
  },
  infoItem: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: spacing[3],
  },
  factorCard: {
    padding: spacing[4],
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing[3],
  },
  factorHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[3],
  },
  disableButton: {
    minHeight: 46,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: 'rgba(240,86,63,0.3)',
    backgroundColor: 'rgba(240,86,63,0.08)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  feedback: {
    marginTop: spacing[4],
    padding: spacing[3.5],
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[2.5],
  },
  modalScrim: {
    flex: 1,
    backgroundColor: colors.overlayStrong,
    justifyContent: 'center' as const,
    paddingHorizontal: spacing[6],
  },
  modalCard: {
    width: '100%' as const,
    maxWidth: sizes.modalMaxWidth,
    alignSelf: 'center' as const,
    padding: spacing[5],
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: '#0a0620',
  },
  modalDescription: {
    color: colors.textSecondary,
    marginTop: spacing[2],
    marginBottom: spacing[5],
  },
  codeInput: {
    height: 64,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
    fontFamily: fonts.monoBold,
    fontSize: 26,
    letterSpacing: 8,
    textAlign: 'center' as const,
  },
  cancelButton: {
    minHeight: 48,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: spacing[2],
  },
};
