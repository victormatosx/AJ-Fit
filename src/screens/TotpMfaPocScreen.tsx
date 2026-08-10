import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, MonoLabel, Slash } from '../components/ui/Display';
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { Icon } from '../components/ui/Icon';
import { useTotpMfaPoc } from '../hooks/useTotpMfaPoc';
import {
  totpMfaIssueFromError,
  type TotpMfaPocIssue,
} from '../lib/totpMfaPoc';
import { useAuth } from '../state/AuthContext';
import { colors, fonts, radii, sizes, spacing, typography } from '../theme/tokens';

export function TotpMfaPocScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('auth');
  const poc = useTotpMfaPoc();
  const { user, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutIssue, setSignOutIssue] = useState<TotpMfaPocIssue | null>(null);

  if (!__DEV__) return null;

  const handleLogout = async () => {
    if (poc.busy || signingOut) return;
    setSigningOut(true);
    setSignOutIssue(null);
    try {
      await logout();
    } catch (error) {
      setSignOutIssue(totpMfaIssueFromError(error));
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('actions.back')}
            onPress={onBack}
            style={styles.backButton}
          >
            <Icon name="arrow-left" size={17} color={colors.text} />
          </Pressable>
          <MonoLabel>{t('totpMfaPoc.badge').toUpperCase()}</MonoLabel>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Slash>{t('totpMfaPoc.enrollment.kicker').toUpperCase()}</Slash>
          <Display size={34} style={{ marginTop: spacing[2] }}>
            {t('totpMfaPoc.enrollment.title').toUpperCase()}
          </Display>
          <Text style={[typography.body, styles.secondaryText]}>
            {t('totpMfaPoc.enrollment.description')}
          </Text>

          <InfoCard>
            <InfoRow label={t('totpMfaPoc.account')} value={user?.email ?? '—'} />
            <InfoRow
              label={t('totpMfaPoc.emailStatus')}
              value={
                user?.emailVerified
                  ? t('totpMfaPoc.verified')
                  : t('totpMfaPoc.notVerified')
              }
            />
          </InfoCard>

          <View style={{ marginTop: spacing[6] }}>
            <MonoLabel>{t('totpMfaPoc.enrolledFactors').toUpperCase()}</MonoLabel>
            {poc.factors.length === 0 ? (
              <Text style={[typography.bodySmall, styles.secondaryText]}>
                {t('totpMfaPoc.noFactors')}
              </Text>
            ) : (
              poc.factors.map((factor) => (
                <InfoCard key={factor.uid} compact>
                  <InfoRow
                    label={t('totpMfaPoc.factorFields.factorId')}
                    value={factor.factorId}
                  />
                  <InfoRow
                    label={t('totpMfaPoc.factorFields.displayName')}
                    value={factor.displayName ?? t('totpMfaPoc.noDisplayName')}
                  />
                  <InfoRow
                    label={t('totpMfaPoc.factorFields.enrollmentTime')}
                    value={factor.enrollmentTime}
                  />
                </InfoCard>
              ))
            )}
          </View>

          {!poc.draft ? (
            <CtaButton
              onPress={() => void poc.generate()}
              disabled={poc.busy || signingOut}
              style={{ marginTop: spacing[6] }}
            >
              {poc.generating && <ActivityIndicator color={colors.text} />}
              <CtaText>
                {poc.generating
                  ? t('totpMfaPoc.actions.generating')
                  : t('totpMfaPoc.actions.generate')}
              </CtaText>
            </CtaButton>
          ) : (
            <View style={{ marginTop: spacing[6], gap: spacing[4] }}>
              <InfoCard>
                <MonoLabel>{t('totpMfaPoc.setupKey').toUpperCase()}</MonoLabel>
                <Text selectable style={styles.secretText}>
                  {poc.draft.secretKey}
                </Text>
                <Text style={[typography.bodySmall, styles.secondaryText]}>
                  {t('totpMfaPoc.manualCopy')}
                </Text>
                <MonoLabel style={{ marginTop: spacing[4] }}>
                  {t('totpMfaPoc.otpAuthUri').toUpperCase()}
                </MonoLabel>
                <Text selectable style={styles.uriText}>
                  {poc.draft.otpAuthUri}
                </Text>
                <Text style={[typography.data, styles.metaText]}>
                  {t('totpMfaPoc.secretMetadata', {
                    algorithm: poc.draft.hashingAlgorithm,
                    digits: poc.draft.codeLength,
                    seconds: poc.draft.codeIntervalSeconds,
                  })}
                </Text>
              </InfoCard>

              <TextInput
                accessibilityLabel={t('totpMfaPoc.codeLabel')}
                value={poc.code}
                onChangeText={(value) => poc.setCode(value.replace(/\s/g, ''))}
                editable={!poc.busy}
                keyboardType="number-pad"
                maxLength={6}
                placeholder={t('totpMfaPoc.codePlaceholder')}
                placeholderTextColor={colors.faint}
                style={styles.codeInput}
              />
              <CtaButton onPress={() => void poc.enroll()} disabled={poc.busy}>
                {poc.enrolling && <ActivityIndicator color={colors.text} />}
                <CtaText>
                  {poc.enrolling
                    ? t('totpMfaPoc.actions.enrolling')
                    : t('totpMfaPoc.actions.enroll')}
                </CtaText>
              </CtaButton>
              <CtaButton ghost onPress={poc.discardDraft} disabled={poc.busy}>
                {t('totpMfaPoc.actions.discard')}
              </CtaButton>
            </View>
          )}

          {poc.issue || signOutIssue ? (
            <Feedback
              tone="error"
              text={issueText(poc.issue ?? signOutIssue!, t)}
            />
          ) : poc.enrolled ? (
            <Feedback tone="success" text={t('totpMfaPoc.feedback.enrolled')} />
          ) : null}

          <InfoCard compact>
            <MonoLabel>{t('totpMfaPoc.loginTest.title').toUpperCase()}</MonoLabel>
            <Text style={[typography.bodySmall, styles.secondaryText]}>
              {t('totpMfaPoc.loginTest.instructions')}
            </Text>
          </InfoCard>

          <CtaButton
            ghost
            onPress={() => void handleLogout()}
            disabled={poc.busy || signingOut}
            style={{ marginTop: spacing[4] }}
          >
            {signingOut && <ActivityIndicator color={colors.text} />}
            <Text style={{ ...typography.subtitle, color: colors.text }}>
              {signingOut
                ? t('totpMfaPoc.actions.signingOut')
                : t('totpMfaPoc.actions.signOutAndTest')}
            </Text>
          </CtaButton>
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}

function issueText(
  issue: TotpMfaPocIssue,
  t: ReturnType<typeof useTranslation<'auth'>>['t'],
) {
  return t(`totpMfaPoc.errors.${issue}`);
}

function InfoCard({
  children,
  compact = false,
}: {
  children: React.ReactNode;
  compact?: boolean;
}) {
  return <View style={[styles.card, compact && { marginTop: spacing[3] }]}>{children}</View>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={[typography.data, { color: colors.faint }]}>{label}</Text>
      <Text selectable style={[typography.bodySmall, { color: colors.text, flex: 1 }]}>
        {value}
      </Text>
    </View>
  );
}

function Feedback({ tone, text }: { tone: 'error' | 'success'; text: string }) {
  const success = tone === 'success';
  return (
    <View style={[styles.feedback, success && styles.feedbackSuccess]}>
      <Icon
        name={success ? 'check' : 'alert-triangle'}
        size={17}
        color={success ? colors.success : colors.dangerText}
      />
      <Text
        style={[
          typography.bodySmall,
          { color: success ? colors.success : colors.dangerText, flex: 1 },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = {
  header: {
    paddingHorizontal: sizes.screenGutter,
    paddingVertical: spacing[3],
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: radii.control,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  content: {
    width: '100%' as const,
    maxWidth: sizes.contentMaxWidth,
    alignSelf: 'center' as const,
    paddingHorizontal: sizes.screenGutter,
    paddingTop: spacing[4],
    paddingBottom: spacing[10],
  },
  secondaryText: {
    color: colors.textSecondary,
    marginTop: spacing[3],
  },
  card: {
    marginTop: spacing[5],
    padding: spacing[4],
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing[2],
  },
  infoRow: {
    flexDirection: 'row' as const,
    gap: spacing[3],
    alignItems: 'flex-start' as const,
  },
  secretText: {
    color: colors.text,
    fontFamily: fonts.monoBold,
    fontSize: 17,
    lineHeight: 25,
    letterSpacing: 1.2,
    marginTop: spacing[3],
  },
  uriText: {
    color: colors.accentHi,
    fontFamily: fonts.mono,
    fontSize: 10.5,
    lineHeight: 17,
    marginTop: spacing[2],
  },
  metaText: {
    color: colors.faint,
    marginTop: spacing[3],
  },
  codeInput: {
    height: 58,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
    fontFamily: fonts.monoBold,
    fontSize: 24,
    letterSpacing: 8,
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
    gap: spacing[2.5],
    alignItems: 'center' as const,
  },
  feedbackSuccess: {
    borderColor: 'rgba(34,197,94,0.35)',
    backgroundColor: 'rgba(34,197,94,0.10)',
  },
};
