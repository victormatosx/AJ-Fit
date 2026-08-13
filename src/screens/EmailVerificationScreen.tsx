import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { Display, Slash } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { ScreenBg } from '../components/ui/ScreenBg';
import { useEmailVerification } from '../hooks/useEmailVerification';
import type { EmailVerificationIssue } from '../lib/emailVerification';
import {
  colors,
  fonts,
  radii,
  sizes,
  spacing,
  typography,
} from '../theme/tokens';

export function EmailVerificationScreen() {
  const { t } = useTranslation('auth');
  const verification = useEmailVerification();

  const feedback = verification.issue
    ? {
        tone: 'error' as const,
        message: issueMessage(verification.issue, t),
      }
    : verification.resent
      ? {
          tone: 'success' as const,
          message: t('emailVerification.feedback.resent'),
        }
      : verification.verified
        ? {
            tone: 'success' as const,
            message: t('emailVerification.feedback.verified'),
          }
        : null;

  return (
    <ScreenBg>
      <OutlineNumber
        size={260}
        style={{ position: 'absolute', top: -40, right: -50, opacity: 0.3 }}
      >
        AJ
      </OutlineNumber>

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={{
              flex: 1,
              width: '100%',
              maxWidth: sizes.contentMaxWidth,
              alignSelf: 'center',
              paddingHorizontal: sizes.screenGutter,
              paddingTop: spacing[8],
              paddingBottom: spacing[8],
            }}
          >
            <View>
              <Slash style={{ marginBottom: spacing[3.5] }}>
                {t('emailVerification.kicker').toUpperCase()}
              </Slash>
              <Display size={38}>
                {t('emailVerification.titleLine1').toUpperCase()}
              </Display>
              <Display size={38}>
                {t('emailVerification.titleLine2').toUpperCase()}
              </Display>
            </View>

            <View
              style={{
                marginTop: spacing[8],
                padding: spacing[5],
                borderRadius: radii.xl,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
              }}
            >
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: radii.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.accentSoft,
                  borderWidth: 1,
                  borderColor: colors.borderStrong,
                }}
              >
                <Icon name="mail" size={22} color={colors.accentHi} />
              </View>
              <Text
                style={{
                  ...typography.body,
                  color: colors.textSecondary,
                  marginTop: spacing[4],
                }}
              >
                {t('emailVerification.descriptionBeforeEmail')}
              </Text>
              <Text
                selectable
                style={{
                  color: colors.text,
                  fontFamily: fonts.uiSemi,
                  fontSize: 15,
                  lineHeight: 22,
                  marginTop: spacing[1],
                }}
              >
                {verification.email || t('emailVerification.emailUnavailable')}
              </Text>
              <Text
                style={{
                  ...typography.body,
                  color: colors.textSecondary,
                  marginTop: spacing[4],
                }}
              >
                {t('emailVerification.descriptionAfterEmail')}
              </Text>
            </View>

            {feedback && (
              <Feedback tone={feedback.tone} message={feedback.message} />
            )}

            <View style={{ flex: 1, minHeight: spacing[8] }} />

            <View style={{ gap: spacing[3] }}>
              <CtaButton
                onPress={() => void verification.check()}
                disabled={verification.busy}
              >
                {verification.checking && <ActivityIndicator color={colors.text} />}
                <CtaText>
                  {verification.checking
                    ? t('emailVerification.actions.checking')
                    : t('emailVerification.actions.check')}
                </CtaText>
              </CtaButton>

              <CtaButton
                ghost
                onPress={() => void verification.resend()}
                disabled={verification.busy}
              >
                {verification.resending && <ActivityIndicator color={colors.text} />}
                <Text style={{ ...typography.subtitle, color: colors.text }}>
                  {verification.resending
                    ? t('emailVerification.actions.resending')
                    : t('emailVerification.actions.resend')}
                </Text>
              </CtaButton>

              <Pressable
                accessibilityRole="button"
                onPress={() => void verification.signOut()}
                disabled={verification.busy}
                style={{
                  minHeight: 48,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: spacing[2],
                  opacity: verification.busy ? 0.35 : 1,
                }}
              >
                {verification.signingOut ? (
                  <ActivityIndicator color={colors.mute} />
                ) : (
                  <Icon name="arrow-left" size={17} color={colors.mute} />
                )}
                <Text style={{ ...typography.subtitle, color: colors.mute }}>
                  {verification.signingOut
                    ? t('emailVerification.actions.signingOut')
                    : t('emailVerification.actions.signOut')}
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}

function issueMessage(
  issue: EmailVerificationIssue,
  t: ReturnType<typeof useTranslation<'auth'>>['t'],
): string {
  return t(`emailVerification.feedback.${issue}`);
}

function Feedback({
  tone,
  message,
}: {
  tone: 'error' | 'success';
  message: string;
}) {
  const success = tone === 'success';
  const color = success ? colors.success : colors.dangerText;

  return (
    <View
      accessibilityRole={success ? undefined : 'alert'}
      style={{
        marginTop: spacing[4],
        padding: spacing[3.5],
        borderRadius: radii.md,
        borderWidth: 1,
        borderColor: success ? 'rgba(34,197,94,0.35)' : 'rgba(240,86,63,0.35)',
        backgroundColor: success ? 'rgba(34,197,94,0.10)' : 'rgba(240,86,63,0.10)',
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing[2.5],
      }}
    >
      <Icon name={success ? 'check' : 'alert-triangle'} size={17} color={color} />
      <Text style={{ ...typography.bodySmall, color, flex: 1 }}>{message}</Text>
    </View>
  );
}
