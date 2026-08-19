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
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { Display, Slash } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { ScreenBg } from '../components/ui/ScreenBg';
import { useTotpChallenge } from '../hooks/useTotpChallenge';
import type { MfaTotpIssue } from '../lib/mfaTotp';
import type { TotpSignInChallenge } from '../services/mfaTotp';
import { radii, sizes, spacing, typography } from '../theme/tokens';
import { useTheme, type AppTheme } from '../theme';

export function TotpChallengeScreen({
  challenge,
  onCancel,
  onSessionExpired,
}: {
  challenge: TotpSignInChallenge;
  onCancel: () => void;
  onSessionExpired: () => void;
}) {
  const { t } = useTranslation('auth');
  const { theme } = useTheme();
  const styles = createStyles(theme);
  const mfa = useTotpChallenge(challenge, { onCancel, onSessionExpired });
  const busy = mfa.resolving || mfa.completed;

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('totpChallenge.actions.backToLogin')}
              onPress={mfa.cancel}
              disabled={busy}
              hitSlop={12}
              style={styles.backButton}
            >
              <Icon name="arrow-left" size={18} color={theme.colors.textMuted} />
              <Text style={[typography.subtitle, { color: theme.colors.textMuted }]}>
                {t('totpChallenge.actions.backToLogin')}
              </Text>
            </Pressable>

            <Slash>{t('totpChallenge.kicker').toUpperCase()}</Slash>
            <Display size={38} style={{ marginTop: spacing[3] }}>
              {t('totpChallenge.title').toUpperCase()}
            </Display>
            <Text style={[typography.body, styles.description]}>
              {t('totpChallenge.description')}
            </Text>

            {challenge.hints.length > 1 ? (
              <View
                accessibilityRole="radiogroup"
                style={{ marginTop: spacing[6], gap: spacing[2] }}
              >
                <Text style={[typography.subtitle, { color: theme.colors.textPrimary }]}>
                  {t('totpChallenge.factor.selectionLabel')}
                </Text>
                {challenge.hints.map((hint, index) => {
                  const selected = hint.uid === mfa.selectedHintUid;
                  return (
                    <Pressable
                      key={hint.uid}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, disabled: busy }}
                      onPress={() => mfa.selectHint(hint.uid)}
                      disabled={busy}
                      style={[styles.hint, selected && styles.hintSelected]}
                    >
                      <Icon name="key" size={18} color={theme.colors.primaryEmphasis} />
                      <Text
                        style={[typography.subtitle, { color: theme.colors.textPrimary, flex: 1 }]}
                      >
                        {hint.displayName ??
                          t('totpChallenge.factor.defaultName', { index: index + 1 })}
                      </Text>
                      {selected ? (
                        <Icon name="check" size={17} color={theme.colors.success} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <View style={{ marginTop: spacing[7] }}>
              <Text style={[typography.subtitle, { color: theme.colors.textPrimary }]}>
                {t('totpChallenge.codeLabel')}
              </Text>
              <TextInput
                accessibilityLabel={t('totpChallenge.codeAccessibilityLabel')}
                value={mfa.code}
                onChangeText={mfa.setCode}
                editable={!busy}
                keyboardType="number-pad"
                maxLength={6}
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                importantForAutofill="yes"
                autoFocus
                placeholder={t('totpChallenge.codePlaceholder')}
                placeholderTextColor={theme.colors.textFaint}
                style={styles.codeInput}
                onSubmitEditing={() => void mfa.resolve()}
              />
            </View>

            {mfa.issue ? (
              <View accessibilityRole="alert" style={styles.feedback}>
                <Icon name="alert-triangle" size={17} color={theme.colors.dangerText} />
                <Text
                  style={[typography.bodySmall, { color: theme.colors.dangerText, flex: 1 }]}
                >
                  {issueText(mfa.issue, t)}
                </Text>
              </View>
            ) : null}

            <View style={{ flex: 1, minHeight: spacing[10] }} />
            <CtaButton onPress={() => void mfa.resolve()} disabled={busy}>
              {busy ? <ActivityIndicator color={theme.colors.textPrimary} /> : null}
              <CtaText>
                {busy
                  ? t('totpChallenge.actions.verifying')
                  : t('totpChallenge.actions.continue')}
              </CtaText>
            </CtaButton>
            <Pressable
              accessibilityRole="button"
              onPress={mfa.cancel}
              disabled={busy}
              style={styles.cancelButton}
            >
              <Text style={[typography.subtitle, { color: theme.colors.textMuted }]}>
                {t('totpChallenge.actions.cancel')}
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenBg>
  );
}

function issueText(
  issue: MfaTotpIssue,
  t: ReturnType<typeof useTranslation<'auth'>>['t'],
) {
  switch (issue) {
    case 'codeRequired':
      return t('totpChallenge.errors.codeRequired');
    case 'codeNonNumeric':
      return t('totpChallenge.errors.codeNonNumeric');
    case 'codeLength':
      return t('totpChallenge.errors.codeLength');
    case 'invalidCode':
    case 'expiredCode':
      return t('totpChallenge.errors.invalidCode');
    case 'network':
      return t('totpChallenge.errors.network');
    case 'tooManyRequests':
      return t('totpChallenge.errors.tooManyRequests');
    default:
      return t('totpChallenge.errors.generic');
  }
}

function createStyles(theme: AppTheme) {
  return {
  content: {
    flexGrow: 1,
    width: '100%' as const,
    maxWidth: sizes.contentMaxWidth,
    alignSelf: 'center' as const,
    paddingHorizontal: sizes.screenGutter,
    paddingTop: spacing[4],
    paddingBottom: spacing[8],
  },
  backButton: {
    minHeight: 44,
    alignSelf: 'flex-start' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[2],
    marginBottom: spacing[4],
  },
  description: {
    color: theme.colors.textSecondary,
    marginTop: spacing[4],
  },
  hint: {
    minHeight: 52,
    paddingHorizontal: spacing[4],
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[3],
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  hintSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.surfaceSelected,
  },
  codeInput: {
    height: 64,
    marginTop: spacing[2],
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surfaceElevated,
    color: theme.colors.textPrimary,
    fontFamily: theme.fonts.monoBold,
    fontSize: 26,
    letterSpacing: 8,
    textAlign: 'center' as const,
  },
  feedback: {
    marginTop: spacing[4],
    padding: spacing[3.5],
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: theme.colors.feedbackDangerBorder,
    backgroundColor: theme.colors.feedbackDangerBackground,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[2.5],
  },
  cancelButton: {
    minHeight: 48,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: spacing[3],
  },
  };
}
