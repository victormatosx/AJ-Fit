import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';

import { ReauthenticationMethods } from '../components/auth/ReauthenticationMethods';
import { SupportScreenHeader } from '../components/support/SupportScreenHeader';
import { CtaButton } from '../components/ui/CtaButton';
import { Icon } from '../components/ui/Icon';
import { ScreenBg } from '../components/ui/ScreenBg';
import { useRecoveryCodes } from '../hooks/useRecoveryCodes';
import { getReauthenticationProviders } from '../lib/authProviders';
import { useAuth } from '../state/AuthContext';
import {
  activateRecoveryCodesScreenProtection,
  deactivateRecoveryCodesScreenProtection,
} from '../services/recoveryCodesScreenProtection';
import { radii, spacing, typography } from '../theme/tokens';
import { useTheme, type AppTheme } from '../theme';
import { useScreenFocusEffect } from '../state/ScreenActivity';

/**
 * The one-time reveal of a user's MFA recovery codes.
 *
 *
 * PLAINTEXT LIFECYCLE — the whole point of this screen
 * ---------------------------------------------------
 * The codes exist in `useRecoveryCodes`'s React state and nowhere else. This
 * screen is materialized-but-inactive under `PersistentScreen` like the rest
 * of the settings stack, so the `useScreenFocusEffect` cleanup below wipes
 * them the moment it deactivates — the same discipline `TotpEnrollmentScreen`
 * applies to the TOTP secret. Nothing is written to storage, ever.
 *
 * Because the backend never stores plaintext and exposes no read-back
 * endpoint, a user who leaves without saving cannot be shown these codes
 * again. That is why leaving is guarded, and why the confirmation checkbox is
 * not decorative.
 *
 *
 * WHAT IS DELIBERATELY NOT SHOWN
 * ------------------------------
 * No recoverySetId, no selector, no digest, no version, no pepper version, no
 * timestamps. The user needs ten strings; everything else is backend state
 * that would only invite screenshots of information that cannot help them.
 */

export type RecoveryCodesOrigin = 'enrollment' | 'regeneration';

/**
 * The issues this screen has copy for.
 *
 * `useRecoveryCodes` can also surface TOTP issues from the reauthentication
 * half, but that half runs in `TwoFactorSettingsScreen` — by the time this
 * screen renders, identity is already proved. Anything unexpected collapses to
 * the generic message rather than rendering a missing translation key.
 */
const TRANSLATED_ISSUES = [
  'recoveryUnauthenticated',
  'recoveryReauthRequired',
  'recoveryConflict',
  'recoveryNetworkUnavailable',
  'recoveryInvalidResponse',
  'recoveryGenerationFailed',
] as const;

type TranslatedIssue = (typeof TRANSLATED_ISSUES)[number];

function issueKey(issue: string | null): TranslatedIssue {
  return TRANSLATED_ISSUES.includes(issue as TranslatedIssue)
    ? (issue as TranslatedIssue)
    : 'recoveryGenerationFailed';
}

export function RecoveryCodesScreen({
  origin,
  onDone,
  onDismiss,
}: {
  /** Where the flow came from, which changes only the copy. */
  origin: RecoveryCodesOrigin;
  /** The user confirmed they saved the codes. */
  onDone: () => void;
  /** The user left without confirming. Codes are already wiped. */
  onDismiss: () => void;
}) {
  const { t } = useTranslation('settings');
  const { theme } = useTheme();
  const colors = theme.colors;
  const styles = createStyles(theme);
  const recovery = useRecoveryCodes();
  const [copied, setCopied] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [reauthCode, setReauthCode] = useState('');

  const { generate, clear, status, requireReauth } = recovery;
  const reauthProviders = getReauthenticationProviders(useAuth().user);

  // Generation is kicked off exactly once per activation, never from a plain
  // render effect: it rotates any previous set, so a re-render must not be
  // able to invalidate codes the user is currently reading.
  //
  // The two origins differ in one way only. Enrollment arrives seconds after the
  // user reauthenticated to enroll, so the backend's 5-minute recent-auth
  // window is certainly open and generation starts immediately. Regeneration
  // can be reached at any time from settings, so it asks for identity first —
  // and because the account has TOTP enrolled, Firebase will demand a TOTP
  // code as part of that reauthentication. Generating the codes that stand in
  // for a second factor must never be possible with the first factor alone.
  useScreenFocusEffect(() => {
    if (origin === 'enrollment') {
      void generate();
    } else {
      requireReauth();
    }
    void activateRecoveryCodesScreenProtection();

    return () => {
      void deactivateRecoveryCodesScreenProtection();
      // Wipes the plaintext the instant the screen stops being visible.
      clear();
      setCopied(false);
      setPassword('');
      setPasswordVisible(false);
      setReauthCode('');
    };
  });

  useEffect(() => {
    if (status !== 'ready') setCopied(false);
  }, [status]);

  const leave = () => {
    if (!recovery.hasCodes) {
      clear();
      onDismiss();
      return;
    }

    Alert.alert(
      t('security.recoveryCodes.leaveTitle'),
      t('security.recoveryCodes.leaveDescription'),
      [
        { text: t('security.recoveryCodes.leaveStay'), style: 'cancel' },
        {
          text: t('security.recoveryCodes.leaveConfirm'),
          style: 'destructive',
          onPress: () => {
            clear();
            onDismiss();
          },
        },
      ],
    );
  };

  const handleCopy = async () => {
    await Clipboard.setStringAsync(recovery.codes.join('\n'));
    setCopied(true);
  };

  const handleDone = () => {
    clear();
    onDone();
  };

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <SupportScreenHeader
          title={t('security.recoveryCodes.title')}
          onBack={leave}
          disabled={recovery.busy}
        />
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          {recovery.status === 'reauthRequired' ? (
            <View style={{ marginTop: spacing[4], gap: spacing[4] }}>
              <Text style={[typography.body, { color: colors.mute }]}>
                {t('security.twoFactor.reauth.enableDescription')}
              </Text>
              <ReauthenticationMethods
                providers={reauthProviders}
                password={password}
                passwordVisible={passwordVisible}
                busyProvider={recovery.busy ? 'password' : null}
                disabled={recovery.busy}
                onChangePassword={setPassword}
                onTogglePassword={() => setPasswordVisible((value) => !value)}
                onConfirm={(provider) =>
                  void recovery.reauthenticateAndGenerate(
                    provider === 'password' ? { provider, password } : { provider },
                  )
                }
              />
              {recovery.issue ? (
                <Text style={[typography.subtitle, { color: colors.warning }]}>
                  {t(`security.recoveryCodes.issues.${issueKey(recovery.issue)}`)}
                </Text>
              ) : null}
            </View>
          ) : recovery.status === 'reauthChallenge' ? (
            <View style={{ marginTop: spacing[4], gap: spacing[3] }}>
              <Text style={[typography.body, { color: colors.mute }]}>
                {t('security.twoFactor.reauth.codeDescription')}
              </Text>
              <TextInput
                value={reauthCode}
                onChangeText={setReauthCode}
                keyboardType="number-pad"
                maxLength={6}
                editable={!recovery.busy}
                accessibilityLabel={t('security.twoFactor.enrollment.codeLabel')}
                placeholder={t('security.twoFactor.enrollment.codePlaceholder')}
                placeholderTextColor={colors.mute}
                style={styles.codeInput}
              />
              <CtaButton
                onPress={() => void recovery.submitReauthCode(reauthCode)}
                disabled={recovery.busy || reauthCode.trim().length < 6}
              >
                {t('security.twoFactor.actions.continue')}
              </CtaButton>
            </View>
          ) : recovery.busy && !recovery.hasCodes ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[typography.subtitle, styles.centeredText]}>
                {t('security.recoveryCodes.generating')}
              </Text>
            </View>
          ) : recovery.status === 'failed' ? (
            <FailureState
              origin={origin}
              message={t(`security.recoveryCodes.issues.${issueKey(recovery.issue)}`)}
              retryable={recovery.retryable}
              busy={recovery.busy}
              onRetry={() => void recovery.generate()}
              onDismiss={onDismiss}
            />
          ) : recovery.hasCodes ? (
            <>
              <Text style={[typography.body, styles.description]}>
                {t('security.recoveryCodes.description')}
              </Text>

              <View style={styles.warningCard}>
                <Icon name="alert-triangle" size={18} color={colors.warning} />
                <Text style={[typography.subtitle, styles.warningText]}>
                  {t('security.recoveryCodes.warningOneTime')}
                </Text>
              </View>

              <View style={styles.codesCard}>
                {recovery.codes.map((code) => (
                  <Text key={code} selectable style={styles.code}>
                    {code}
                  </Text>
                ))}
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('security.recoveryCodes.copyAll')}
                onPress={() => void handleCopy()}
                style={styles.copyButton}
              >
                <Icon name={copied ? 'check' : 'file-text'} size={16} color={colors.primary} />
                <Text style={[typography.subtitle, { color: colors.primary }]}>
                  {copied
                    ? t('security.recoveryCodes.copied')
                    : t('security.recoveryCodes.copyAll')}
                </Text>
              </Pressable>

              {copied ? (
                // Stated plainly rather than promising an automatic wipe: no
                // platform API lets the app guarantee the clipboard is cleared.
                <Text style={[typography.bodySmall, styles.clipboardNotice]}>
                  {t('security.recoveryCodes.clipboardNotice')}
                </Text>
              ) : null}

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: recovery.confirmed }}
                accessibilityLabel={t('security.recoveryCodes.confirmSaved')}
                onPress={() => recovery.setConfirmed(!recovery.confirmed)}
                style={styles.confirmRow}
              >
                <View
                  style={[
                    styles.checkbox,
                    recovery.confirmed ? styles.checkboxChecked : null,
                  ]}
                >
                  {recovery.confirmed ? (
                    <Icon name="check" size={14} color={colors.primaryForeground} />
                  ) : null}
                </View>
                <Text style={[typography.subtitle, styles.confirmText]}>
                  {t('security.recoveryCodes.confirmSaved')}
                </Text>
              </Pressable>

              <CtaButton
                onPress={handleDone}
                disabled={!recovery.confirmed}
                style={{ marginTop: spacing[6] }}
              >
                {t('security.recoveryCodes.done')}
              </CtaButton>
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}

/**
 * Shown when generation fails.
 *
 * The enrollment case is the one that matters: TOTP is already active and must
 * NOT be rolled back just because this step failed. The copy says so
 * explicitly, so a user does not assume their 2FA is broken and go turn it off.
 */
function FailureState({
  origin,
  message,
  retryable,
  busy,
  onRetry,
  onDismiss,
}: {
  origin: RecoveryCodesOrigin;
  message: string;
  retryable: boolean;
  busy: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation('settings');
  const { theme } = useTheme();
  const colors = theme.colors;
  const styles = createStyles(theme);

  return (
    <View style={styles.centered}>
      <View style={styles.failureIcon}>
        <Icon name="alert-triangle" size={28} color={colors.warning} />
      </View>
      <Text style={[typography.title, styles.centeredText]}>
        {origin === 'enrollment'
          ? t('security.recoveryCodes.failure.enrollmentTitle')
          : t('security.recoveryCodes.failure.regenerationTitle')}
      </Text>
      <Text style={[typography.body, styles.centeredText, { color: colors.mute }]}>
        {origin === 'enrollment'
          ? t('security.recoveryCodes.failure.enrollmentDescription')
          : t('security.recoveryCodes.failure.regenerationDescription')}
      </Text>
      <Text style={[typography.subtitle, styles.centeredText, { color: colors.mute }]}>
        {message}
      </Text>

      {retryable ? (
        <CtaButton onPress={onRetry} disabled={busy} style={{ marginTop: spacing[6] }}>
          {t('security.recoveryCodes.failure.retry')}
        </CtaButton>
      ) : null}

      <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.laterButton}>
        <Text style={[typography.subtitle, { color: colors.mute }]}>
          {t('security.recoveryCodes.failure.later')}
        </Text>
      </Pressable>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  const colors = theme.colors;
  return {
    content: {
      paddingHorizontal: spacing[5],
      paddingBottom: spacing[10],
    },
    centered: {
      alignItems: 'center' as const,
      paddingTop: spacing[8],
      gap: spacing[3],
    },
    centeredText: {
      color: colors.text,
      textAlign: 'center' as const,
    },
    description: {
      color: colors.mute,
      marginTop: spacing[4],
    },
    warningCard: {
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      gap: spacing[3],
      marginTop: spacing[5],
      padding: spacing[4],
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.warning,
      backgroundColor: colors.surface,
    },
    warningText: {
      flex: 1,
      color: colors.text,
    },
    codesCard: {
      marginTop: spacing[5],
      padding: spacing[4],
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      gap: spacing[2],
    },
    code: {
      color: colors.text,
      fontFamily: theme.fonts.monoBold,
      fontSize: 14,
      letterSpacing: 1,
      textAlign: 'center' as const,
    },
    copyButton: {
      minHeight: 48,
      marginTop: spacing[4],
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: spacing[2],
    },
    clipboardNotice: {
      color: colors.mute,
      textAlign: 'center' as const,
      marginTop: spacing[1],
    },
    confirmRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing[3],
      marginTop: spacing[6],
      minHeight: 48,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: radii.sm,
      borderWidth: 2,
      borderColor: colors.borderStrong,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    checkboxChecked: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    confirmText: {
      flex: 1,
      color: colors.text,
    },
    failureIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.warning,
    },
    codeInput: {
      minHeight: 58,
      paddingHorizontal: spacing[4],
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surfaceRaised,
      color: colors.text,
      fontFamily: theme.fonts.monoBold,
      fontSize: 20,
      letterSpacing: 6,
      textAlign: 'center' as const,
    },
    laterButton: {
      minHeight: 48,
      marginTop: spacing[3],
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
  };
}
