import { NutritionReadyBanner } from './src/components/NutritionReadyBanner';
import { OnboardingNutritionRuntime } from './src/components/OnboardingNutritionRuntime';
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as NativeSplashScreen from 'expo-splash-screen';
import { View, ActivityIndicator, Pressable, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts, Anton_400Regular } from '@expo-google-fonts/anton';
import { useTranslation } from 'react-i18next';
import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
} from '@expo-google-fonts/archivo';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';

import { AppStateProvider as RawAppStateProvider, useAppState, defaultQuiz } from './src/state/AppState';
import { AuthProvider, useAuth } from './src/state/AuthContext';
import { SubscriptionProvider } from './src/state/SubscriptionContext';
import { DevSubscriptionOverrideProvider } from './src/dev/DevSubscriptionOverrideContext';
import { PromoCodeProvider } from './src/state/PromoCodeContext';
import { useSubscription } from './src/hooks/useSubscription';
import {
  resolvePremiumGate,
  explainPremiumGateBlockers,
  type RootScreenId,
} from './src/lib/premiumGate';
import { PhotoVaultProvider } from './src/state/PhotoVaultContext';
import { addQuestionnaire } from './src/services/userProfile';
import { logAuthError } from './src/services/auth';
import { configureRevenueCat } from './src/services/revenueCatService';
import { WordmarkSplash } from './src/components/ui/WordmarkSplash';
import { FullScreenLoading } from './src/components/ui/FullScreenLoading';
import { hasCompletedInitialBoot, markInitialBootCompleted } from './src/lib/initialBootReadiness';
import { OnboardingFunnelScreen } from './src/screens/OnboardingFunnelScreen';

import type { OnboardingAuthContext } from './src/onboarding/authContext';
import { AuthScreen } from './src/screens/AuthScreen';
import { EmailVerificationScreen } from './src/screens/EmailVerificationScreen';
import { PaywallScreen } from './src/screens/PaywallScreen';
import { AppShell } from './src/screens/AppShell';
import { requiresEmailVerification } from './src/lib/emailVerification';
import { ThemeProvider, useTheme } from './src/theme';
import { NativeThemeSync } from './src/theme/NativeThemeSync';
import { initI18n } from './src/i18n';
import { reconcileLanguageOnLoad } from './src/i18n/syncLanguage';
import { reconcileUnitsOnLoad } from './src/units/syncUnits';
import { UnitsProvider } from './src/state/UnitsContext';
import { needsPreferencesReconciliation } from './src/lib/preferencesReconciliation';
import { useWorkoutReadinessGate } from './src/workoutPrescription/useWorkoutReadinessGate';
import {
  cleanupPhotoVaultShareFiles,
  cleanupPhotoVaultTempFiles,
} from './src/services/photoVaultFileCrypto';
import {
  kickPhotoVaultUploadQueue,
  reconcilePhotoVaultUploadQueue,
} from './src/services/photoVaultUploadQueue';
import { logPhotoVaultIssue } from './src/lib/photoVaultErrors';
import { logInfo } from './src/lib/logger';
import { recordPerfMark } from './src/lib/perf';
import { configureWorkoutLifecycleTelemetry } from './src/workoutLifecycle/telemetryProvider';
import { DeepLinkProvider, useDeepLinkIntent } from './src/state/DeepLinkContext';
import { PushNotificationsRuntime } from './src/components/PushNotificationsRuntime';
import { PushDeviceRegistrationRuntime } from './src/components/PushDeviceRegistrationRuntime';
import { SubscriptionCelebrationRuntime } from './src/components/subscription/SubscriptionCelebrationRuntime';

// Operational lifecycle events are delivered to an authenticated/App-Check
// callable and then Cloud Logging. Installation is synchronous; delivery is
// always best-effort and never blocks a domain transition.
configureWorkoutLifecycleTelemetry();
recordPerfMark('app_epoch');

/**
 * Configures the RevenueCat SDK at module evaluation time — the same
 * singleton-bootstrap pattern src/lib/firebase.ts already uses for
 * `auth`/`db`. Never called from a screen: SubscriptionProvider and every
 * other SDK-touching function in revenueCatService.ts independently await
 * configuration readiness themselves (see `ensureConfigured()` there) — this
 * call is only what triggers configuration as early as possible, not what
 * makes later calls safe.
 *
 * This line running before `registerRootComponent(App)` (index.ts) — i.e.
 * before React mounts anything or fires a single effect — is what guarantees
 * `Purchases.configure()`'s synchronous JS call (see
 * `configureRevenueCat()`'s doc comment for why it must stay synchronous,
 * with no `await` preceding it) always happens first, deterministically,
 * regardless of how fast Firebase auth or any other effect resolves. Not
 * awaited here on purpose: a missing/invalid key must only be logged, never
 * thrown into the app tree at bootstrap — every real caller downstream still
 * gets that same rejection via `ensureConfigured()`. `configureRevenueCat`
 * is idempotent, so this line re-running under Fast Refresh (editing this
 * file re-executes its top-level code) is harmless.
 */
configureRevenueCat().catch(() => {
  // configureRevenueCat already emitted the sanitized root-cause error.
});

/**
 * Keeps the native splash (fixed #020010, see app.json's expo-splash-screen
 * config — background color only, no image: WordmarkSplash's first frame is
 * the "AJ." composition, which needs a runtime layout measurement no static
 * native asset can replicate) up until `WordmarkSplash` itself calls
 * `hideAsync()`, once its own first frame is measured and correct — see
 * `src/components/ui/WordmarkSplash.tsx`. Without this, the native splash
 * can disappear before that first frame paints, exposing a blank/wrong
 * frame underneath.
 */
NativeSplashScreen.preventAutoHideAsync().catch(() => {
  // Best-effort: a rejection here just means the default auto-hide runs.
});

function SubscriptionResolutionError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => Promise<void>;
}) {
  const { theme } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.background,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 28,
      }}
    >
      <Text
        style={{
          color: theme.colors.textPrimary,
          fontFamily: 'Archivo_700Bold',
          fontSize: 18,
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: theme.colors.textMuted,
          fontFamily: 'Archivo_400Regular',
          fontSize: 14,
          lineHeight: 21,
          textAlign: 'center',
          marginTop: 10,
        }}
      >
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Tentar verificar assinatura novamente"
        onPress={() => void onRetry()}
        style={{
          marginTop: 22,
          borderWidth: 1,
          borderColor: theme.colors.primaryEmphasis,
          paddingHorizontal: 22,
          paddingVertical: 12,
        }}
      >
        <Text
          style={{
            color: theme.colors.textPrimary,
            fontFamily: 'Archivo_700Bold',
            fontSize: 13,
          }}
        >
          TENTAR NOVAMENTE
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * Bridges AuthContext's uid into `AppStateProvider` without that module
 * importing AuthContext itself (see its doc comment) — the only reason this
 * one-line wrapper exists.
 */
function AppStateProviderConnected({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <RawAppStateProvider uid={user?.uid ?? null}>{children}</RawAppStateProvider>;
}

function RootNavigator({ onDestinationReady }: { onDestinationReady: () => void }) {
  const { theme } = useTheme();
  const { t } = useTranslation('common');
  const { openNutritionPlan } = useDeepLinkIntent();
  const {
    user,
    profile,
    questionnaire,
    cachedPresentation,
    questionnaireResolution,
    initializing,
    profileLoading,
    refreshProfile,
    logout,
  } = useAuth();
  const {
    loading: subscriptionLoading,
    configured: subscriptionConfigured,
    isPremium,
    status: subscriptionStatus,
    errorKind: subscriptionErrorKind,
    error: subscriptionError,
    retry: retrySubscription,
  } = useSubscription();
  const emailVerificationRequired = requiresEmailVerification(user);
  // `!== null` folds two states into "resolved": an absent field (a
  // document written before this marker existed — never reinterpreted as
  // "new") and an actual `Timestamp` (the backend confirmed a purchase/
  // restore at least once). Only an explicit `null` — written only by
  // `provisionNewUser` for accounts created from this field's introduction
  // onward — means "still pending". See the `UserProfile.metadata` doc
  // comment in src/services/userProfile.ts.
  const commercialGateResolved = profile?.metadata.commercialGateResolvedAt !== null;
  const { quiz, setQuiz } = useAppState();
  // The root splash is not a router state — it's a single overlay in
  // AppContent, independent of `resolvedScreen`. An unauthenticated cold
  // start's real first destination is the onboarding funnel, so that's
  // what's requested from the start.
  const [screen, setScreenState] = useState<RootScreenId>('onboardingFunnel');
  // Mirrors `screen` synchronously so late/stale callbacks can check the
  // current route without depending on a stale closure over the state value.
  const screenRef = useRef<RootScreenId | null>('onboardingFunnel');
  // Guards the forced-questionnaire save below against double submission
  // (e.g. a fast double-tap on the last quiz question).
  const [savingQuestionnaire, setSavingQuestionnaire] = useState(false);
  // Account-preference reconciliation runs once per authenticated identity.
  // While it runs, resolvePremiumGate holds the routing gate closed (same as
  // profileLoading) so the first authed screen renders with reconciled
  // language and units already applied. This NEVER influences the Premium
  // decision below — it only delays which screen becomes visible, exactly
  // like the other pre-Premium checks resolvePremiumGate already made
  // (auth, questionnaire).
  //
  // `reconciledUidRef`/`reconcilingUidRef` (not `useState`) are what make
  // `preferencesReconciling` correct on the SAME render where
  // `profileLoading` first becomes `false` — see
  // `src/lib/preferencesReconciliation.ts`'s doc comment for the exact
  // one-render-late bug this fixes (a `useState` flipped from a
  // `useEffect` necessarily lags a render behind, letting the gate open to
  // 'app' for one paint before reconciliation had even started).
  const reconciledUidRef = useRef<string | null>(null);
  const reconcilingUidRef = useRef<string | null>(null);
  const [, forceReconciliationRerender] = useReducer((c: number) => c + 1, 0);
  const preferencesReconciling = needsPreferencesReconciliation({
    authInitializing: initializing,
    profileLoading,
    uid: user?.uid ?? null,
    hasProfile: Boolean(profile),
    reconciledUid: reconciledUidRef.current,
  });
  // Copy-only context for AuthScreen (which funnel step sent the user here).
  // No auth/commerce logic reads this — see src/onboarding/authContext.ts.
  const [onboardingAuthContext, setOnboardingAuthContext] = useState<OnboardingAuthContext | null>(
    null,
  );

  // Ref (not state) so it can be read/reset from effects defined further
  // below, before its own hydration effect — see the effect near
  // `resolvedScreen` for the full rationale.
  const repairHydratedUidRef = useRef<string | null>(null);

  const setScreen = (next: RootScreenId) => {
    screenRef.current = next;
    setScreenState(next);
  };

  useEffect(() => {
    if (emailVerificationRequired || !preferencesReconciling || !user || !profile) return;
    // Guards against re-kicking the same in-flight reconciliation on every
    // render while it's pending (this effect's deps include `profile`,
    // which the reconciliation's own writes can cause to change).
    if (reconcilingUidRef.current === user.uid) return;
    reconcilingUidRef.current = user.uid;
    recordPerfMark('preferences_reconciliation_start');
    Promise.all([
      reconcileLanguageOnLoad({
        uid: user.uid,
        remoteLanguage: profile.preferences.language,
      }),
      reconcileUnitsOnLoad({
        uid: user.uid,
        remoteUnits: profile.preferences.units,
      }),
    ]).finally(() => {
      reconciledUidRef.current = user.uid;
      reconcilingUidRef.current = null;
      recordPerfMark('preferences_reconciliation_settled');
      forceReconciliationRerender();
    });
  }, [emailVerificationRequired, preferencesReconciling, user, profile]);

  // A logout (or account switch mid-flight) must not leave a stale
  // `reconciledUidRef` that lets a DIFFERENT future uid skip reconciliation
  // — `needsPreferencesReconciliation` already re-derives `true` for any
  // uid that doesn't match `reconciledUidRef.current`, but clearing it here
  // too keeps the ref from silently holding a signed-out user's uid forever.
  useEffect(() => {
    if (!user) reconciledUidRef.current = null;
  }, [user]);

  // This pure decision is also the render guard: AppShell is never mounted
  // from a stale/requested route while auth, email verification, preference
  // reconciliation, questionnaire, or the CustomerInfo for the current
  // Firebase UID is unresolved. Once all prerequisites are known, AppShell
  // opens regardless of `isPremium` (Fase 1 limited-mode rollout) — the
  // entitlement keeps flowing through `useSubscription()` for capability
  // gating inside AppShell in later phases, it just no longer blocks entry.
  // First-app-entry readiness (audit: onboarding→Home lifecycle) — starts as
  // soon as auth + questionnaire are resolved, so it overlaps with the
  // user's time on Paywall instead of adding a new wait after it. See
  // `useWorkoutReadinessGate`'s doc comment: for an established account
  // (program already exists) this resolves in one fast read; only a
  // genuinely first-time account waits on it, and it never blocks forever.
  const workoutReadinessGate = useWorkoutReadinessGate({
    enabled: Boolean(user) && questionnaireResolution === 'found',
    uid: user?.uid ?? null,
    questionnaire,
  });

  const resolvedScreen = resolvePremiumGate({
    requestedScreen: screen,
    authInitializing: initializing,
    profileLoading,
    authenticated: Boolean(user),
    emailVerificationRequired,
    preferencesReconciling,
    questionnaireResolution,
    subscriptionLoading,
    subscriptionConfigured,
    isPremium,
    commercialGateResolved,
    workoutReadinessGate,
  });

  useEffect(() => {
    if (workoutReadinessGate === 'ready') recordPerfMark('workout_readiness_ready');
  }, [workoutReadinessGate]);

  useEffect(() => {
    if (resolvedScreen === 'app') recordPerfMark('premium_gate_resolved_app');
  }, [resolvedScreen]);

  // Repair re-entry: `resolvePremiumGate` sends an authenticated user with an
  // EXISTING but incomplete questionnaire back to `'onboardingFunnel'` too
  // (`workoutReadinessGate === 'needsQuestionnaire'` — see premiumGate.ts).
  // Unlike the brand-new-account case (`questionnaireResolution ===
  // 'not_found'`, where `questionnaire` is null and `quiz` is correctly
  // blank), here real answers already exist server-side — prefilling `quiz`
  // from them means the reduced funnel re-asks nothing the user already
  // answered; only whichever field was actually missing stays unset. Runs
  // once per uid (not on every render where the condition holds) so it never
  // clobbers the user's own edits mid-repair.
  useEffect(() => {
    if (!user) {
      repairHydratedUidRef.current = null;
      return;
    }
    if (resolvedScreen !== 'onboardingFunnel' || !questionnaire) return;
    if (repairHydratedUidRef.current === user.uid) return;
    repairHydratedUidRef.current = user.uid;
    setQuiz({ ...defaultQuiz, ...questionnaire.answers });
  }, [user, questionnaire, resolvedScreen, setQuiz]);

  useEffect(() => {
    logInfo('subscription', 'navigation_gate_evaluated', {
      uid: user?.uid,
      requestedScreen: screen,
      resolvedScreen: resolvedScreen ?? 'unresolved',
      authInitializing: initializing,
      profileLoading,
      authenticated: Boolean(user),
      emailVerificationRequired,
      preferencesReconciling,
      questionnaireResolution,
      subscriptionLoading,
      subscriptionConfigured,
      subscriptionStatus,
      isPremium,
      commercialGateResolved,
      workoutReadinessGate,
      // Diagnostic-only, never read by the gate — see
      // `explainPremiumGateBlockers`'s doc comment.
      blockingReasons: explainPremiumGateBlockers({
        requestedScreen: screen,
        authInitializing: initializing,
        profileLoading,
        authenticated: Boolean(user),
        emailVerificationRequired,
        preferencesReconciling,
        questionnaireResolution,
        subscriptionLoading,
        subscriptionConfigured,
        isPremium,
        commercialGateResolved,
        workoutReadinessGate,
      }),
    });
  }, [
    user?.uid,
    screen,
    resolvedScreen,
    initializing,
    profileLoading,
    emailVerificationRequired,
    preferencesReconciling,
    questionnaireResolution,
    subscriptionLoading,
    subscriptionConfigured,
    subscriptionStatus,
    isPremium,
    commercialGateResolved,
    workoutReadinessGate,
  ]);

  // Keep the requested screen aligned with the centrally resolved route so
  // logout/account switches continue from the effective screen, while still
  // rendering `resolvedScreen` immediately (before this effect can run).
  useEffect(() => {
    if (resolvedScreen && resolvedScreen !== screen) setScreen(resolvedScreen);
  }, [resolvedScreen, screen]);

  // Retry-exhausted questionnaire/profile read failure — checked BEFORE the
  // subscription-error condition below since it can't have resolved a
  // `questionnaire` yet either way. Never falls through to onboarding
  // (`resolvePremiumGate` already refuses that for `'error'`) — this is the
  // recoverable-error UI instead of an indefinite spinner.
  const questionnaireReadError =
    !initializing && !profileLoading && Boolean(user) && questionnaireResolution === 'error';
  const subscriptionReadError =
    !initializing &&
    !profileLoading &&
    Boolean(user) &&
    Boolean(questionnaire) &&
    subscriptionStatus === 'error' &&
    !subscriptionConfigured;

  // Everything that reaches the single root splash's `ready` signal with no
  // internal async gate of its own: the three destinations that render
  // their real first frame synchronously on mount, PLUS both terminal
  // read-error presentations below (an error card IS the destination's
  // first real frame — "ready" means resolved, not necessarily succeeded).
  // 'app' and 'paywall' report readiness themselves, once Home/Offerings
  // are actually ready — see AppShell.tsx/PaywallScreen.tsx.
  useEffect(() => {
    if (
      resolvedScreen === 'auth' ||
      resolvedScreen === 'emailVerification' ||
      resolvedScreen === 'onboardingFunnel' ||
      (!resolvedScreen && (questionnaireReadError || subscriptionReadError))
    ) {
      onDestinationReady();
    }
  }, [resolvedScreen, questionnaireReadError, subscriptionReadError, onDestinationReady]);

  screenRef.current = resolvedScreen;

  if (!resolvedScreen) {
    if (questionnaireReadError) {
      return (
        <SubscriptionResolutionError
          title="Não foi possível carregar seus dados"
          message={cachedPresentation?.profile
            ? t(cachedPresentation.questionnaire?.days
              ? 'status.cachedQuestionnaireOffline'
              : 'status.cachedProfileOffline', {
              name: cachedPresentation.profile.name,
              days: cachedPresentation.questionnaire?.days ?? 0,
            })
            : 'Verifique sua conexão e tente novamente.'}
          onRetry={refreshProfile}
        />
      );
    }
    if (subscriptionReadError) {
      return (
        <SubscriptionResolutionError
          title={subscriptionErrorKind === 'offline' ? 'Conexão necessária' : 'Assinatura indisponível'}
          message={subscriptionError ?? 'Não foi possível verificar a assinatura agora.'}
          onRetry={retrySubscription}
        />
      );
    }
    // Ordinary intermediate loading — no name/plan/"Atualizando…" flash
    // before the real destination. Fully occluded by WordmarkSplash for the
    // very first cold start (see App.tsx); this is only ever visible as
    // ordinary runtime loading afterward (e.g. a second login's profile/
    // subscription resolving).
    return <FullScreenLoading />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <OnboardingNutritionRuntime accessReady={resolvedScreen === 'app' && isPremium} />
      <NutritionReadyBanner enabled={resolvedScreen === 'app' && isPremium} onOpen={openNutritionPlan} />
      {resolvedScreen === 'onboardingFunnel' && (
        <OnboardingFunnelScreen
          mode={user ? 'forcedQuestionnaire' : 'anonymous'}
          onAuthRequested={(ctx) => {
            setOnboardingAuthContext(ctx);
            setScreen('auth');
          }}
          onForcedQuestionnaireDone={async () => {
            // Forced questionnaire for an already-authenticated user (e.g. a
            // social login that never had one). Persist it and let the
            // central gate above choose app/paywall once `questionnaire`
            // reloads — this screen never navigates itself in that case.
            // Deliberately no `generateAndPersistWorkoutProgram` call here:
            // once the gate opens AppShell (auth + questionnaire +
            // commercial gate all resolved), `useWorkoutPrescription`'s
            // automatic reconciliation generates the first program itself —
            // a single source of truth instead of a second, premature
            // attempt racing it here (and, before, an unhandled crash from
            // this attempt used to abort BEFORE `refreshProfile()`, leaving
            // the freshly-saved questionnaire invisible to the gate).
            if (!user || savingQuestionnaire) return;
            setSavingQuestionnaire(true);
            try {
              await addQuestionnaire(user.uid, quiz, 1);
              await refreshProfile();
            } catch (err) {
              logAuthError('quiz:save-questionnaire', err);
              // Stays on 'onboardingFunnel' — the gate keeps it there until a
              // questionnaire actually exists, so the user can just retry.
            } finally {
              setSavingQuestionnaire(false);
            }
          }}
        />
      )}
      {resolvedScreen === 'auth' && <AuthScreen entryContext={onboardingAuthContext} />}
      {resolvedScreen === 'emailVerification' && <EmailVerificationScreen />}
      {resolvedScreen === 'paywall' && (
        <PaywallScreen
          entryContext={onboardingAuthContext}
          onReady={onDestinationReady}
          // Reinstates the documented pre-"Fase 1" rule for this one case
          // (docs/24_funil_onboarding_arquitetura.md §8 — "Botão X do
          // Paywall": preserved exactly as it was, `onClose` calls
          // `logout()`). Only reachable here for a brand-new account whose
          // initial commercial gate is still pending — an ESTABLISHED
          // account never renders this branch (see `resolvePremiumGate`),
          // so this never logs out an existing non-Premium user. The
          // on-demand `<PaywallScreen>` inside AppShell (`showPremium`)
          // is untouched and keeps its own `onClose` that just closes the
          // modal — that instance is a different context and was never
          // part of this rule.
          onClose={() => {
            void logout();
          }}
        />
      )}
      {resolvedScreen === 'app' && <AppShell onHomeReady={onDestinationReady} />}
      {savingQuestionnaire && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.loadingOverlay,
          }}
        >
          <ActivityIndicator color={theme.colors.primaryEmphasis} />
        </View>
      )}
    </View>
  );
}

function AppContent() {
  const { theme, hydrated: themeHydrated } = useTheme();
  const [fontsLoaded] = useFonts({
    Anton_400Regular,
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_700Bold,
  });

  // i18n bootstrap runs in parallel with `useFonts` — both are covered by
  // WordmarkSplash sitting on top, unconditionally, for the whole wait (see
  // the bottom of this component). `initI18n()` is idempotent (module-level
  // memoization), so
  // Fast Refresh cannot re-init. `.finally` ensures the gate opens even if
  // resolution fails (a broken AsyncStorage read still falls through to the
  // system locale + English fallback inside initI18n).
  const [i18nReady, setI18nReady] = useState(false);
  useEffect(() => {
    // A crash/force-kill bypasses every normal unmount/lock cleanup. Sweep
    // the controlled plaintext directory on the next startup before any
    // private screen can be unlocked. Failure is observable but never blocks
    // the public app bootstrap.
    try {
      // Both swept directories live under the CACHE root and hold only
      // transient work: staged plaintext, and ciphertext staged for a transfer
      // that was meant to finish inside a single call.
      //
      // This used to be justified by "a cold process has no resumable local
      // upload queue". That is no longer true — a prepared photo now survives
      // a force-kill — but the sweep stays correct, because the durable queue
      // deliberately does NOT live here: its ciphertext is in the DOCUMENT
      // directory (`services/photoVaultDurableStore`), which nothing in this
      // sweep can reach. Reconciling that queue is a separate step below, and
      // it is the only thing allowed to delete a pending photo.
      cleanupPhotoVaultTempFiles({ includeEncrypted: true });
    } catch {
      logPhotoVaultIssue('startupCleanup', 'vaultTempCleanupFailed');
    }
    try {
      // Matches the persisted queue against the ciphertext actually on disk.
      // Drops only what is PROVEN unusable and reclaims only blobs no job
      // claims; anything ambiguous is kept, because the cost of keeping it is
      // disk and the cost of dropping it is a photo the user believes is
      // saved. Needs no vault session: it reads records and file sizes only.
      void reconcilePhotoVaultUploadQueue().then(() => {
        kickPhotoVaultUploadQueue('cold-start');
      });
    } catch {
      logPhotoVaultIssue('startupCleanup', 'vaultTempCleanupFailed');
    }
    try {
      // Crash recovery for the Comparator's export queue (docs on
      // `cleanupPhotoVaultShareFiles`). Kept as its own try/catch so a
      // failure sweeping one directory never skips sweeping the other.
      cleanupPhotoVaultShareFiles();
    } catch {
      logPhotoVaultIssue('startupCleanup', 'vaultShareCleanupFailed');
    }
  }, []);

  useEffect(() => {
    initI18n().finally(() => setI18nReady(true));
  }, []);

  // Module-scope latch (src/lib/initialBootReadiness.ts), not React state —
  // survives this whole process's lifetime regardless of remounts, so the
  // splash can never come back once it's played: not on background/
  // foreground, not on a tab switch, not on internal navigation, not even
  // on a later logout/login. `destinationReady` is the single signal
  // WordmarkSplash waits on, reported by whichever root destination
  // (auth/onboarding/emailVerification/paywall/app/error) actually mounts —
  // see `onDestinationReady` threaded into RootNavigator below.
  const [booting, setBooting] = useState(() => !hasCompletedInitialBoot());
  const [destinationReady, setDestinationReady] = useState(false);
  const handleDestinationReady = useCallback(() => setDestinationReady(true), []);
  const handleSplashDone = useCallback(() => {
    markInitialBootCompleted();
    setBooting(false);
  }, []);

  return (
    // Outer, unrelated to react-native-gesture-handler's own root below —
    // exists only so WordmarkSplash can sit as a sibling overlay on top of
    // the ENTIRE app tree (absolute-positioned, paints last), instead of
    // needing to be threaded deep inside it. The real destination screen
    // mounts and loads immediately, underneath, in parallel — nothing here
    // waits for the splash to finish.
    <View style={{ flex: 1 }}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <AuthProvider>
            {/* Passive push listeners and identity binding never request OS
                permission and never participate in startup readiness. */}
            <PushNotificationsRuntime />
            <PushDeviceRegistrationRuntime />
            {/* Nested inside AuthProvider so SubscriptionProvider can read
                useAuth()'s `user`/`initializing` and react to it (calling
                loginRevenueCat/logoutRevenueCat internally). AuthContext itself
                is untouched — it stays the sole owner of identity and knows
                nothing about RevenueCat; SubscriptionContext just watches it. */}
            {/* Owns the UID-bound, session-scoped Dev Subscription Override
                state (dev/QA only, see src/dev/). Nested above SubscriptionProvider so it can
                transform the RevenueCat-derived state before the rest of the
                app ever sees it — inert everywhere outside a development
                build. */}
            <DevSubscriptionOverrideProvider>
              <SubscriptionProvider>
                <PromoCodeProvider>
                  <UnitsProvider>
                    <AppStateProviderConnected>
                      {/* Inside AuthProvider so it can re-lock on logout and account
                          switches; wraps the navigator so its AppState listener is
                          mounted for the whole session. */}
                      <PhotoVaultProvider>
                        {/* Retains cold-start and foreground URLs until the guarded
                            navigator can consume them. It never changes auth,
                            prescription or schedule authority. */}
                        <DeepLinkProvider>
                          <StatusBar style={theme.statusBar.style} />
                          <NativeThemeSync />
                          {/* Business providers mount immediately so Firebase profile
                              reads, RevenueCat identity synchronization and vault
                              locking overlap the local theme/font/i18n bootstrap.
                              Only the definitive UI is held behind this visual gate,
                              preventing a stored Light preference from first painting
                              the real app in Dark. Renders nothing while false — with
                              nothing yet to report ready, WordmarkSplash's own hold
                              phase already covers this wait, unconditionally. */}
                          {themeHydrated && fontsLoaded && i18nReady ? (
                            <>
                              <RootNavigator onDestinationReady={handleDestinationReady} />
                              <SubscriptionCelebrationRuntime />
                            </>
                          ) : null}
                        </DeepLinkProvider>
                      </PhotoVaultProvider>
                    </AppStateProviderConnected>
                  </UnitsProvider>
                </PromoCodeProvider>
              </SubscriptionProvider>
            </DevSubscriptionOverrideProvider>
          </AuthProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
      {booting && (
        <WordmarkSplash
          ready={destinationReady}
          fontsLoaded={fontsLoaded}
          onDone={handleSplashDone}
        />
      )}
    </View>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
