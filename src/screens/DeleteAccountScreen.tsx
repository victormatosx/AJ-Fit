import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ReauthenticationMethods } from '../components/auth/ReauthenticationMethods';
import { SupportScreenHeader } from '../components/support/SupportScreenHeader';
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { Icon } from '../components/ui/Icon';
import { ScreenBg } from '../components/ui/ScreenBg';
import { useAccountDeletionFlow, type AccountDeletionFlowIssue } from '../hooks/useAccountDeletionFlow';
import { useSubscription } from '../hooks/useSubscription';
import { PREMIUM_ENTITLEMENT_ID } from '../lib/subscriptionConstants';
import { useScreenFocusEffect } from '../state/ScreenActivity';
import { colors, fonts, radii, sizes, spacing, typography } from '../theme/tokens';

/**
 * "Excluir Conta" — Fase 12. Presentation only: every decision, every
 * network call, every piece of state lives in `useAccountDeletionFlow`
 * (mirrors `ChangePasswordScreen`/`TwoFactorSettingsScreen`'s hook/screen
 * split). This screen never calls `accountDeletionOrchestrator.ts`,
 * `accountDeletionReauth.ts`, or `accountDeletionShutdown.ts` directly.
 *
 * ONE flow, driven by `flow.step` — not four separate screens/routes. The
 * same component serves both entry points (Settings and Security both open
 * it — Fase 12 §3).
 */
export function DeleteAccountScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('settings');
  const flow = useAccountDeletionFlow();
  const { isPremium, loading: subscriptionLoading, customerInfo, manageSubscription } = useSubscription();
  // UI-only (not sensitive by itself — mirrors whether the password TEXT is
  // masked, same as ChangePasswordScreen's per-field `*Visible` state, kept
  // local to the screen rather than in the hook).
  const [passwordVisible, setPasswordVisible] = useState(false);

  // Sensitive state (password, MFA code, in-flight provider material) is
  // wiped the moment this screen deactivates — same discipline as
  // ChangePasswordScreen/TwoFactorSettingsScreen (Fase 12 §39-ish local
  // convention, not a new pattern).
  useScreenFocusEffect(() => {
    return () => {
      flow.reset();
      setPasswordVisible(false);
    };
  });

  const backAllowed = flow.step !== 'submitting' && !flow.accepted;

  const handleManageSubscription = async () => {
    const activeEntitlement = customerInfo?.entitlements.active[PREMIUM_ENTITLEMENT_ID] ?? null;
    const store = activeEntitlement?.store && activeEntitlement.store !== 'UNKNOWN_STORE' ? activeEntitlement.store : null;
    await manageSubscription({ store, managementURL: customerInfo?.managementURL ?? null });
  };

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <SupportScreenHeader
          title={t('security.deleteAccountFlow.screenTitle')}
          onBack={onBack}
          disabled={!backAllowed}
        />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          {flow.step === 'intro' && (
            <IntroStep
              isPremium={isPremium}
              subscriptionLoading={subscriptionLoading}
              onManageSubscription={() => void handleManageSubscription()}
              onContinue={() => void flow.continueToNextStep()}
            />
          )}

          {flow.step === 'reauth' && (
            <ReauthStep
              providers={flow.reauthenticationProviders}
              password={flow.reauthPassword}
              onChangePassword={flow.setReauthPassword}
              passwordVisible={passwordVisible}
              onTogglePassword={() => setPasswordVisible((value) => !value)}
              busyProvider={flow.reauthProvider}
              onConfirmProvider={(provider) => void flow.submitReauth(provider)}
              mfaChallenge={flow.mfaChallenge}
              mfaCode={flow.mfaCode}
              onChangeMfaCode={flow.setMfaCode}
              onSubmitMfaCode={() => void flow.submitMfaCode()}
              onCancelMfa={flow.cancelMfa}
              issue={flow.issue}
              busy={flow.reauthProvider !== null}
            />
          )}

          {flow.step === 'confirm' && (
            <ConfirmStep
              onConfirm={() => void flow.confirmDeletion()}
              issue={flow.issue}
            />
          )}

          {flow.step === 'submitting' && <SubmittingStep />}
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}

function IntroStep({
  isPremium,
  subscriptionLoading,
  onManageSubscription,
  onContinue,
}: {
  isPremium: boolean;
  subscriptionLoading: boolean;
  onManageSubscription: () => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <View style={{ gap: spacing[5] }}>
      <InfoCard icon="trash" tone="danger" text={t('security.deleteAccountFlow.intro.consequence1')} />
      <InfoCard icon="shield" text={t('security.deleteAccountFlow.intro.consequence2')} />
      <InfoCard icon="file-text" text={t('security.deleteAccountFlow.intro.consequence3')} />

      <View style={styles.subscriptionCard}>
        <Icon name="alert-triangle" size={19} color={colors.warning} />
        <View style={{ flex: 1, gap: spacing[2] }}>
          <Text style={[typography.subtitle, { color: colors.text }]}>
            {t('security.deleteAccountFlow.intro.subscriptionTitle')}
          </Text>
          <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
            {t('security.deleteAccountFlow.intro.subscriptionBody')}
          </Text>
          {!subscriptionLoading && isPremium ? (
            <Pressable accessibilityRole="button" onPress={onManageSubscription} style={styles.linkButton}>
              <Text style={[typography.subtitle, { color: colors.accentHi }]}>
                {t('security.deleteAccountFlow.intro.manageSubscription')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <CtaButton ghost onPress={onContinue} style={{ marginTop: spacing[4] }}>
        <CtaText>{t('security.deleteAccountFlow.intro.continueAction')}</CtaText>
      </CtaButton>
    </View>
  );
}

function ReauthStep({
  providers,
  password,
  onChangePassword,
  passwordVisible,
  onTogglePassword,
  busyProvider,
  onConfirmProvider,
  mfaChallenge,
  mfaCode,
  onChangeMfaCode,
  onSubmitMfaCode,
  onCancelMfa,
  issue,
  busy,
}: {
  providers: readonly ('password' | 'google' | 'apple')[];
  password: string;
  onChangePassword: (value: string) => void;
  passwordVisible: boolean;
  onTogglePassword: () => void;
  busyProvider: 'password' | 'google' | 'apple' | null;
  onConfirmProvider: (provider: 'password' | 'google' | 'apple') => void;
  mfaChallenge: unknown;
  mfaCode: string;
  onChangeMfaCode: (value: string) => void;
  onSubmitMfaCode: () => void;
  onCancelMfa: () => void;
  issue: AccountDeletionFlowIssue | null;
  busy: boolean;
}) {
  const { t } = useTranslation('settings');
  return (
    <View style={{ gap: spacing[5] }}>
      <Text style={[typography.title, { color: colors.text }]}>
        {t('security.deleteAccountFlow.reauth.title')}
      </Text>
      <Text style={[typography.body, { color: colors.textSecondary }]}>
        {mfaChallenge
          ? t('security.deleteAccountFlow.reauth.codeDescription')
          : t('security.deleteAccountFlow.reauth.description')}
      </Text>

      {mfaChallenge ? (
        <>
          <TextInput
            accessibilityLabel={t('security.twoFactor.enrollment.codeLabel')}
            value={mfaCode}
            onChangeText={onChangeMfaCode}
            editable={!busy}
            keyboardType="number-pad"
            maxLength={6}
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            importantForAutofill="yes"
            placeholder={t('security.twoFactor.enrollment.codePlaceholder')}
            placeholderTextColor={colors.faint}
            style={styles.codeInput}
            onSubmitEditing={onSubmitMfaCode}
          />
          <CtaButton onPress={onSubmitMfaCode} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.text} /> : <CtaText>{t('security.twoFactor.actions.continue')}</CtaText>}
          </CtaButton>
          <Pressable accessibilityRole="button" onPress={onCancelMfa} disabled={busy} style={styles.linkButtonCentered}>
            <Text style={[typography.subtitle, { color: colors.mute }]}>{t('security.twoFactor.actions.cancel')}</Text>
          </Pressable>
        </>
      ) : (
        <ReauthenticationMethods
          providers={providers}
          password={password}
          passwordVisible={passwordVisible}
          busyProvider={busyProvider}
          disabled={busy}
          onChangePassword={onChangePassword}
          onTogglePassword={onTogglePassword}
          onConfirm={onConfirmProvider}
        />
      )}

      {issue ? <Feedback tone="error" message={issueMessage(issue, t)} /> : null}
    </View>
  );
}

function ConfirmStep({
  onConfirm,
  issue,
}: {
  onConfirm: () => void;
  issue: AccountDeletionFlowIssue | null;
}) {
  const { t } = useTranslation('settings');
  return (
    <View style={{ gap: spacing[5] }}>
      <Text style={[typography.title, { color: colors.text }]}>
        {t('security.deleteAccountFlow.confirm.title')}
      </Text>
      <View style={{ gap: spacing[3] }}>
        <SummaryBullet text={t('security.deleteAccountFlow.confirm.bullet1')} />
        <SummaryBullet text={t('security.deleteAccountFlow.confirm.bullet2')} />
        <SummaryBullet text={t('security.deleteAccountFlow.confirm.bullet3')} />
        <SummaryBullet text={t('security.deleteAccountFlow.confirm.bullet4')} />
      </View>

      {issue ? <Feedback tone="error" message={issueMessage(issue, t)} /> : null}

      <Pressable
        accessibilityRole="button"
        onPress={onConfirm}
        style={({ pressed }) => [styles.destructiveButton, { opacity: pressed ? 0.85 : 1 }]}
      >
        <Text style={[typography.subtitle, { color: colors.dangerText }]}>
          {t('security.deleteAccountFlow.confirm.action')}
        </Text>
      </Pressable>
    </View>
  );
}

function SubmittingStep() {
  const { t } = useTranslation('settings');
  return (
    <View style={{ alignItems: 'center', gap: spacing[5], paddingTop: spacing[10] }}>
      <ActivityIndicator color={colors.accentHi} size="large" />
      <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
        {t('security.deleteAccountFlow.submitting.message')}
      </Text>
    </View>
  );
}

function SummaryBullet({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing[2.5], alignItems: 'flex-start' }}>
      <Icon name="check" size={16} color={colors.textSecondary} />
      <Text style={[typography.bodySmall, { color: colors.textSecondary, flex: 1 }]}>{text}</Text>
    </View>
  );
}

function InfoCard({
  icon,
  text,
  tone,
}: {
  icon: 'trash' | 'shield' | 'file-text';
  text: string;
  tone?: 'danger';
}) {
  return (
    <View style={styles.infoCard}>
      <Icon name={icon} size={19} color={tone === 'danger' ? colors.dangerText : colors.accentHi} />
      <Text style={[typography.body, { color: colors.textSecondary, flex: 1 }]}>{text}</Text>
    </View>
  );
}

function Feedback({ tone, message }: { tone: 'error'; message: string }) {
  return (
    <View accessibilityRole="alert" style={styles.feedback}>
      <Icon name="alert-triangle" size={17} color={colors.dangerText} />
      <Text style={[typography.bodySmall, { color: colors.dangerText, flex: 1 }]}>{message}</Text>
    </View>
  );
}

function issueMessage(
  issue: AccountDeletionFlowIssue,
  t: ReturnType<typeof useTranslation<'settings'>>['t'],
): string {
  return t(`security.deleteAccountFlow.errors.${issue}`, {
    defaultValue: t('security.deleteAccountFlow.errors.REAUTH_FAILED'),
  });
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
  infoCard: {
    padding: spacing[4],
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: spacing[3],
  },
  subscriptionCard: {
    padding: spacing[4],
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: 'rgba(234,179,8,0.35)',
    backgroundColor: 'rgba(234,179,8,0.08)',
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: spacing[3],
  },
  linkButton: {
    minHeight: 32,
    justifyContent: 'center' as const,
    alignItems: 'flex-start' as const,
  },
  linkButtonCentered: {
    minHeight: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  destructiveButton: {
    minHeight: 58,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: 'rgba(240,86,63,0.4)',
    backgroundColor: 'rgba(240,86,63,0.10)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  feedback: {
    padding: spacing[3.5],
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(240,86,63,0.35)',
    backgroundColor: 'rgba(240,86,63,0.10)',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[2.5],
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
};
