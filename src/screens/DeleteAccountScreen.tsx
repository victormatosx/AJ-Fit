import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ReauthenticationMethods } from '../components/auth/ReauthenticationMethods';
import { SupportScreenHeader } from '../components/support/SupportScreenHeader';
import {
  DeleteAccountHero,
  DeletionImpactList,
  DeletionStepProgress,
  DeletionSubscriptionNotice,
  SubscriptionWarningCard,
} from '../components/deleteAccount/DeleteAccountVisuals';
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { MonoLabel } from '../components/ui/Display';
import { Icon, type IconName } from '../components/ui/Icon';
import { ScreenBg } from '../components/ui/ScreenBg';
import { useAccountDeletionFlow, type AccountDeletionFlowIssue } from '../hooks/useAccountDeletionFlow';
import { useSubscription } from '../hooks/useSubscription';
import { PREMIUM_ENTITLEMENT_ID } from '../lib/subscriptionConstants';
import { useScreenFocusEffect } from '../state/ScreenActivity';
import { useTheme } from '../theme';
import { radii, sizes, spacing, typography } from '../theme/tokens';

/**
 * "Excluir Conta" — Fase 12. Presentation only: every decision, every
 * network call, every piece of state lives in `useAccountDeletionFlow`
 * (mirrors `ChangePasswordScreen`'s hook/screen split). This screen never
 * calls `accountDeletionOrchestrator.ts`,
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

  // Sensitive state (password and in-flight provider material) is wiped the
  // moment this screen deactivates — the same discipline as ChangePasswordScreen.
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
        {flow.step !== 'submitting' && flow.step !== 'reconciliation' ? (
          <View style={{ alignItems: 'center', paddingBottom: spacing[3] }}>
            <DeletionStepProgress step={flow.step} />
          </View>
        ) : null}
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
              issue={flow.issue}
              busy={flow.reauthProvider !== null}
            />
          )}

          {flow.step === 'confirm' && (
            <ConfirmStep
              onConfirm={() => flow.confirmDeletion()}
              issue={flow.issue}
            />
          )}

          {flow.step === 'submitting' && <SubmittingStep />}
          {flow.step === 'reconciliation' && (
            <ReconciliationStep onContinue={() => void flow.completeAcceptedDeletion()} />
          )}
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
    <View style={{ gap: spacing[7] }}>
      <DeleteAccountHero
        icon="shield"
        title={t('security.deleteAccountFlow.screenTitle')}
        subtitle={t('security.deleteAccountFlow.intro.consequence3')}
      />

      <View style={{ gap: spacing[3] }}>
        <MonoLabel>{t('security.deleteAccountFlow.intro.impactTitle')}</MonoLabel>
        <DeletionImpactList
          items={[
            t('security.deleteAccountFlow.intro.consequence1'),
            t('security.deleteAccountFlow.intro.consequence2'),
          ]}
        />
      </View>

      <SubscriptionWarningCard
        eyebrow={t('security.deleteAccountFlow.intro.subscriptionEyebrow')}
        title={t('security.deleteAccountFlow.intro.subscriptionTitle')}
        body={t('security.deleteAccountFlow.intro.subscriptionBody')}
        manageLabel={t('security.deleteAccountFlow.intro.manageSubscription')}
        onManage={onManageSubscription}
        showManage={!subscriptionLoading && isPremium}
      />

      <CtaButton onPress={onContinue}>
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
  issue: AccountDeletionFlowIssue | null;
  busy: boolean;
}) {
  const { t } = useTranslation('settings');
  return (
    <View style={{ gap: spacing[6] }}>
      <DeleteAccountHero
        icon="shield"
        title={t('security.deleteAccountFlow.reauth.title')}
        subtitle={t('security.deleteAccountFlow.reauth.description')}
      />

      {/*
        Rendered ABOVE the password field/CTA (unlike `ConfirmStep`, where it
        stays below): right after a failed submit the on-screen keyboard is
        still up, pushing anything placed after the button out of view in
        this ScrollView — an error banner below the button risked being
        invisible exactly when it matters (account-deletion password-reauth
        audit: a rejection the user never scrolled to see read, from their
        side, as "nothing happened, it just asked for the password again").
      */}
      {issue ? <Feedback issue={issue} message={issueMessage(issue, t)} /> : null}

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
    </View>
  );
}

function ConfirmStep({
  onConfirm,
  issue,
}: {
  onConfirm: () => Promise<void>;
  issue: AccountDeletionFlowIssue | null;
}) {
  const { t } = useTranslation('settings');
  const { theme } = useTheme();
  const [isConfirming, setIsConfirming] = useState(false);

  const handleConfirm = async () => {
    if (isConfirming) return;
    setIsConfirming(true);
    try {
      await onConfirm();
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <View style={{ gap: spacing[6] }}>
      <DeleteAccountHero
        icon="trash"
        tone="danger"
        title={t('security.deleteAccountFlow.confirm.title')}
        subtitle={t('security.deleteAccountFlow.confirm.heroSubtitle')}
      />

      <DeletionImpactList
        items={[
          t('security.deleteAccountFlow.confirm.bullet1'),
          t('security.deleteAccountFlow.confirm.bullet2'),
          t('security.deleteAccountFlow.confirm.bullet3'),
        ]}
      />

      <DeletionSubscriptionNotice text={t('security.deleteAccountFlow.confirm.bullet4')} />

      {issue ? <Feedback issue={issue} message={issueMessage(issue, t)} /> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isConfirming, busy: isConfirming }}
        onPress={() => void handleConfirm()}
        disabled={isConfirming}
        style={({ pressed }) => [
          styles.destructiveButton,
          {
            borderColor: theme.colors.feedbackDangerBorder,
            backgroundColor: theme.colors.feedbackDangerBackground,
          },
          { opacity: isConfirming ? 0.7 : pressed ? 0.85 : 1 },
        ]}
      >
        {isConfirming ? (
          <ActivityIndicator color={theme.colors.dangerText} />
        ) : (
          <Text style={[typography.button, { color: theme.colors.dangerText, textTransform: 'uppercase' }]}>
            {t('security.deleteAccountFlow.confirm.action')}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

function ReconciliationStep({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation('settings');
  return (
    <View style={{ gap: spacing[6] }}>
      <DeleteAccountHero
        icon="alert-triangle"
        title={t('security.deleteAccountFlow.reconciliation.title')}
        subtitle={t('security.deleteAccountFlow.errors.reconciliationRequired')}
      />
      <CtaButton onPress={onContinue}>
        <CtaText>{t('security.deleteAccountFlow.reconciliation.action')}</CtaText>
      </CtaButton>
    </View>
  );
}

function SubmittingStep() {
  const { t } = useTranslation('settings');
  return (
    <View style={{ paddingTop: spacing[10] }}>
      <DeleteAccountHero
        icon="trash"
        tone="accent"
        loading
        title={t('security.deleteAccountFlow.submitting.message')}
        subtitle={t('security.deleteAccountFlow.submitting.description')}
      />
    </View>
  );
}

function Feedback({ issue, message }: { issue: AccountDeletionFlowIssue; message: string }) {
  const { theme } = useTheme();
  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.feedback,
        {
          borderColor: theme.colors.feedbackErrorBorder,
          backgroundColor: theme.colors.feedbackErrorBackground,
        },
      ]}
    >
      <Icon name={issueIcon(issue)} size={17} color={theme.colors.dangerText} />
      <Text style={[typography.bodySmall, { color: theme.colors.dangerText, flex: 1 }]}>{message}</Text>
    </View>
  );
}

function issueIcon(issue: AccountDeletionFlowIssue): IconName {
  switch (issue) {
    case 'NETWORK_ERROR':
      return 'globe';
    case 'WRONG_PASSWORD':
    case 'PASSWORD_REQUIRED':
      return 'key';
    case 'SESSION_EXPIRED':
    case 'USER_SIGNED_OUT':
      return 'lock';
    default:
      return 'alert-triangle';
  }
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
  destructiveButton: {
    minHeight: 58,
    borderRadius: radii.control,
    borderWidth: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  feedback: {
    padding: spacing[3.5],
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[2.5],
  },
};
