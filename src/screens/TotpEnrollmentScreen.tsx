import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-native-qrcode-svg';
import { ReauthenticationMethods } from '../components/auth/ReauthenticationMethods';
import { SupportScreenHeader } from '../components/support/SupportScreenHeader';
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { Icon } from '../components/ui/Icon';
import { ScreenBg } from '../components/ui/ScreenBg';
import { useTotpEnrollment } from '../hooks/useTotpEnrollment';
import type { ReauthenticationProvider } from '../lib/authProviders';
import {
  formatTotpSecret,
  type MfaTotpIssue,
} from '../lib/mfaTotp';
import { colors, fonts, radii, sizes, spacing, typography } from '../theme/tokens';
import { useScreenFocusEffect } from '../state/ScreenActivity';

export function TotpEnrollmentScreen({
  onBack,
  onCompleted,
}: {
  onBack: () => void;
  onCompleted: () => void;
}) {
  const { t } = useTranslation('settings');
  const enrollment = useTotpEnrollment();
  const [passwordVisible, setPasswordVisible] = useState(false);

  // TotpEnrollmentScreen is now persistent (docs/23_navegacao_e_lifecycle.md
  // §10). `enrollment.cancel()` already exists exactly for "abandon this
  // attempt" (see the `closeEnrollment` cancel-path below) — reusing it as
  // the deactivation cleanup wipes `draft` (server-issued MFA secret +
  // otpAuthUri), `currentPassword` and `code` the moment the screen goes
  // invisible, so no enrollment secret is ever kept alive while the screen
  // is materialized-but-inactive. The next activation always starts a fresh
  // enrollment attempt from the reauthentication step — matching the
  // server-side `enrollmentCompletionDeadline` design (a resumed stale
  // draft isn't a goal here). No on-activate work is needed: there's no
  // list to refresh, this is a wizard, not a data view.
  useScreenFocusEffect(() => {
    return () => {
      enrollment.cancel();
      setPasswordVisible(false);
    };
  });

  const closeEnrollment = () => {
    if (enrollment.activated) {
      onCompleted();
      return;
    }
    if (enrollment.cancel()) onBack();
  };

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <SupportScreenHeader
          title={t('security.twoFactor.enrollment.title')}
          onBack={closeEnrollment}
          disabled={enrollment.busy}
        />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            {enrollment.activated ? (
              <SuccessState onCompleted={onCompleted} />
            ) : !enrollment.allowed ? (
              <UnavailableState />
            ) : !enrollment.draft ? (
              <ReauthenticationStep
                providers={enrollment.reauthenticationProviders}
                password={enrollment.currentPassword}
                passwordVisible={passwordVisible}
                busy={enrollment.busy}
                busyProvider={enrollment.reauthenticatingProvider}
                issue={enrollment.issue}
                onChangePassword={enrollment.setCurrentPassword}
                onTogglePassword={() => setPasswordVisible((value) => !value)}
                onSubmit={(provider) => void enrollment.beginEnrollment(provider)}
              />
            ) : (
              <AuthenticatorSetupStep enrollment={enrollment} />
            )}

            {!enrollment.activated ? (
              <Pressable
                accessibilityRole="button"
                onPress={closeEnrollment}
                disabled={enrollment.busy}
                style={styles.cancelButton}
              >
                <Text style={[typography.subtitle, { color: colors.mute }]}>
                  {t('security.twoFactor.actions.cancel')}
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenBg>
  );
}

function ReauthenticationStep({
  providers,
  password,
  passwordVisible,
  busy,
  busyProvider,
  issue,
  onChangePassword,
  onTogglePassword,
  onSubmit,
}: {
  providers: ReturnType<typeof useTotpEnrollment>['reauthenticationProviders'];
  password: string;
  passwordVisible: boolean;
  busy: boolean;
  busyProvider: ReturnType<typeof useTotpEnrollment>['reauthenticatingProvider'];
  issue: MfaTotpIssue | null;
  onChangePassword: (value: string) => void;
  onTogglePassword: () => void;
  onSubmit: (provider: ReauthenticationProvider) => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <>
      <View style={styles.heroCard}>
        <Icon name="shield" size={22} color={colors.accentHi} />
        <View style={{ flex: 1 }}>
          <Text style={[typography.title, { color: colors.text }]}>
            {t('security.twoFactor.reauth.title')}
          </Text>
          <Text style={[typography.bodySmall, styles.secondaryText]}>
            {t('security.twoFactor.reauth.enableDescription')}
          </Text>
        </View>
      </View>
      <View style={{ marginTop: spacing[6] }}>
        <ReauthenticationMethods
          providers={providers}
          password={password}
          passwordVisible={passwordVisible}
          busyProvider={busyProvider}
          disabled={busy}
          onChangePassword={onChangePassword}
          onTogglePassword={onTogglePassword}
          onConfirm={onSubmit}
        />
      </View>
      {issue ? <ErrorFeedback issue={issue} /> : null}
    </>
  );
}

function AuthenticatorSetupStep({
  enrollment,
}: {
  enrollment: ReturnType<typeof useTotpEnrollment>;
}) {
  const { t } = useTranslation('settings');
  const draft = enrollment.draft;
  if (!draft) return null;

  return (
    <>
      <Text style={[typography.body, { color: colors.textSecondary }]}>
        {t('security.twoFactor.enrollment.description')}
      </Text>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={t('security.twoFactor.enrollment.qrAccessibility')}
        style={styles.qrCard}
      >
        <QRCode
          value={draft.otpAuthUri}
          size={200}
          color="#020010"
          backgroundColor="#ffffff"
          ecl="M"
        />
      </View>
      <Text style={[typography.bodySmall, styles.centeredSecondaryText]}>
        {t('security.twoFactor.enrollment.scanQr')}
      </Text>

      <View style={styles.secretCard}>
        <Text style={[typography.bodySmall, { color: colors.faint }]}>
          {t('security.twoFactor.enrollment.manualKey')}
        </Text>
        <Text selectable style={styles.secretText}>
          {formatTotpSecret(draft.secretKey)}
        </Text>
        <CtaButton
          ghost
          onPress={() => void enrollment.copySecret()}
          disabled={enrollment.busy}
          style={{ marginTop: spacing[4] }}
        >
          {enrollment.copying ? <ActivityIndicator color={colors.text} /> : null}
          <Text style={[typography.subtitle, { color: colors.text }]}>
            {enrollment.copied
              ? t('security.twoFactor.enrollment.keyCopied')
              : t('security.twoFactor.enrollment.copyKey')}
          </Text>
        </CtaButton>
        <Pressable
          accessibilityRole="button"
          onPress={() => void enrollment.openAuthenticator()}
          disabled={enrollment.busy}
          style={styles.openAuthenticator}
        >
          {enrollment.opening ? (
            <ActivityIndicator color={colors.accentHi} />
          ) : (
            <Icon name="arrow-right" size={16} color={colors.accentHi} />
          )}
          <Text style={[typography.subtitle, { color: colors.accentHi }]}>
            {t('security.twoFactor.enrollment.openAuthenticator')}
          </Text>
        </Pressable>
      </View>

      <View style={{ marginTop: spacing[7] }}>
        <Text style={[typography.subtitle, { color: colors.text }]}>
          {t('security.twoFactor.enrollment.codeLabel')}
        </Text>
        <TextInput
          accessibilityLabel={t('security.twoFactor.enrollment.codeLabel')}
          value={enrollment.code}
          onChangeText={enrollment.setCode}
          editable={!enrollment.busy}
          keyboardType="number-pad"
          maxLength={6}
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          importantForAutofill="yes"
          placeholder={t('security.twoFactor.enrollment.codePlaceholder')}
          placeholderTextColor={colors.faint}
          style={styles.codeInput}
        />
      </View>
      {enrollment.issue ? <ErrorFeedback issue={enrollment.issue} /> : null}
      <CtaButton
        onPress={() => void enrollment.confirmEnrollment()}
        disabled={enrollment.busy}
        style={{ marginTop: spacing[6] }}
      >
        {enrollment.enrolling ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <CtaText>{t('security.twoFactor.enrollment.confirm')}</CtaText>
        )}
      </CtaButton>
    </>
  );
}

function SuccessState({ onCompleted }: { onCompleted: () => void }) {
  const { t } = useTranslation('settings');
  return (
    <View style={{ flex: 1, justifyContent: 'center' }}>
      <View style={styles.successIcon}>
        <Icon name="check" size={30} color={colors.success} />
      </View>
      <Text style={[typography.title, styles.successTitle]}>
        {t('security.twoFactor.enrollment.successTitle')}
      </Text>
      <Text style={[typography.body, styles.centeredSecondaryText]}>
        {t('security.twoFactor.enrollment.successDescription')}
      </Text>
      <CtaButton onPress={onCompleted} style={{ marginTop: spacing[7] }}>
        <CtaText>{t('security.twoFactor.enrollment.done')}</CtaText>
      </CtaButton>
    </View>
  );
}

function UnavailableState() {
  const { t } = useTranslation('settings');
  return (
    <View style={styles.heroCard}>
      <Icon name="alert-triangle" size={22} color={colors.warning} />
      <View style={{ flex: 1 }}>
        <Text style={[typography.title, { color: colors.text }]}>
          {t('security.twoFactor.reauth.unavailableTitle')}
        </Text>
        <Text style={[typography.bodySmall, styles.secondaryText]}>
          {t('security.twoFactor.errors.reauthProviderUnsupported')}
        </Text>
      </View>
    </View>
  );
}

function ErrorFeedback({ issue }: { issue: MfaTotpIssue }) {
  const { t } = useTranslation('settings');
  return (
    <View accessibilityRole="alert" style={styles.feedback}>
      <Icon name="alert-triangle" size={17} color={colors.dangerText} />
      <Text style={[typography.bodySmall, { color: colors.dangerText, flex: 1 }]}>
        {t(`security.twoFactor.errors.${issue}`)}
      </Text>
    </View>
  );
}

const styles = {
  content: {
    flexGrow: 1,
    width: '100%' as const,
    maxWidth: sizes.contentMaxWidth,
    alignSelf: 'center' as const,
    paddingHorizontal: sizes.screenGutter,
    paddingTop: spacing[4],
    paddingBottom: spacing[10],
  },
  heroCard: {
    padding: spacing[4],
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: spacing[3],
  },
  secondaryText: {
    color: colors.textSecondary,
    marginTop: spacing[1],
  },
  centeredSecondaryText: {
    color: colors.textSecondary,
    textAlign: 'center' as const,
    marginTop: spacing[3],
  },
  qrCard: {
    width: 232,
    height: 232,
    alignSelf: 'center' as const,
    marginTop: spacing[6],
    padding: spacing[4],
    borderRadius: radii.xl,
    backgroundColor: '#ffffff',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  secretCard: {
    marginTop: spacing[6],
    padding: spacing[4],
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secretText: {
    color: colors.text,
    fontFamily: fonts.monoBold,
    fontSize: 16,
    lineHeight: 25,
    letterSpacing: 1,
    marginTop: spacing[2],
  },
  openAuthenticator: {
    minHeight: 48,
    marginTop: spacing[2],
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: spacing[2],
  },
  codeInput: {
    minHeight: 58,
    marginTop: spacing[2],
    paddingHorizontal: spacing[4],
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
    fontFamily: fonts.monoBold,
    fontSize: 24,
    letterSpacing: 7,
    textAlign: 'center' as const,
  },
  feedback: {
    marginTop: spacing[4],
    padding: spacing[3.5],
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(240,86,63,0.35)',
    backgroundColor: 'rgba(240,86,63,0.10)',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[2.5],
  },
  cancelButton: {
    minHeight: 48,
    marginTop: spacing[3],
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: radii.pill,
    alignSelf: 'center' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: 'rgba(34,197,94,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.35)',
  },
  successTitle: {
    color: colors.text,
    textAlign: 'center' as const,
    marginTop: spacing[5],
  },
};
