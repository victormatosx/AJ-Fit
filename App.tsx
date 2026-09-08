import React, { useEffect, useReducer, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as NativeSplashScreen from 'expo-splash-screen';
import { View, ActivityIndicator, Pressable, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts, Anton_400Regular } from '@expo-google-fonts/anton';
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
import { SplashScreen } from './src/screens/SplashScreen';
import { OnboardingFunnelScreen } from './src/screens/OnboardingFunnelScreen';
import { clearOnboardingDraft } from './src/onboarding/draftStorage';
import type { OnboardingAuthContext } from './src/onboarding/authContext';
import { AuthScreen } from './src/screens/AuthScreen';
import { EmailVerificationScreen } from './src/screens/EmailVerificationScreen';
import { PaywallScreen } from './src/screens/PaywallScreen';
import { AppShell } from './src/screens/AppShell';
import { FullScreenLoading } from './src/components/ui/FullScreenLoading';
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
import { logPhotoVaultIssue } from './src/lib/photoVaultErrors';
import { logInfo } from './src/lib/logger';
import { configureWorkoutLifecycleTelemetry } from './src/workoutLifecycle/telemetryProvider';
import { DeepLinkProvider } from './src/state/DeepLinkContext';

// Operational lifecycle events are delivered to an authenticated/App-Check
// callable and then Cloud Logging. Installation is synchronous; delivery is
// always best-effort and never blocks a domain transition.
configureWorkoutLifecycleTelemetry();

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
 * Keeps the native splash (fixed black, see app.json's expo-splash-screen
 * config) on screen until AppContent's first commit, instead of the default
 * auto-hide-on-bundle-load. Without this, the native splash can disappear
 * before the first frame paints, exposing a blank white frame underneath —
 * the same class of flash the in-JS Dark splash exists to avoid.
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

function RootNavigator() {
  const { theme } = useTheme();
  const {
    user,
    profile,
    questionnaire,
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
  const [screen, setScreenState] = useState<RootScreenId>('splash');
  // Mirrors `screen` synchronously so late/stale callbacks (e.g. the splash
  // timer firing after the router already moved on) can check the current
  // route without depending on a stale closure over the state value.
  const screenRef = useRef<RootScreenId | null>('splash');
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

  // The anonymous draft is only useful before a questionnaire exists under
  // the real UID. Once both are true, provisioning + addQuestionnaire have
  // already durably written the data server-side — safe to drop the local
  // copy. Idempotent (AsyncStorage removeItem on an absent key is a no-op),
  // so this can fire on every render where the condition holds.
  useEffect(() => {
    if (user && questionnaire) void clearOnboardingDraft();
  }, [user, questionnaire]);

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

  screenRef.current = resolvedScreen;

  if (!resolvedScreen) {
    // Retry-exhausted questionnaire/profile read failure — checked BEFORE
    // the subscription-error branch below since it can't have resolved a
    // `questionnaire` yet either way. Never falls through to onboarding
    // (`resolvePremiumGate` already refuses that for `'error'`); this is
    // the recoverable-error UI instead of an indefinite spinner. Reuses
    // the same component/visual language as the subscription error below,
    // per the "don't invent new design" instruction.
    if (!initializing && !profileLoading && user && questionnaireResolution === 'error') {
      return (
        <SubscriptionResolutionError
          title="Não foi possível carregar seus dados"
          message="Verifique sua conexão e tente novamente."
          onRetry={refreshProfile}
        />
      );
    }
    if (
      !initializing &&
      !profileLoading &&
      user &&
      questionnaire &&
      subscriptionStatus === 'error' &&
      !subscriptionConfigured
    ) {
      return (
        <SubscriptionResolutionError
          title={subscriptionErrorKind === 'offline' ? 'Conexão necessária' : 'Assinatura indisponível'}
          message={subscriptionError ?? 'Não foi possível verificar a assinatura agora.'}
          onRetry={retrySubscription}
        />
      );
    }
    return <FullScreenLoading />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {resolvedScreen === 'splash' && (
        <SplashScreen
          onDone={() => {
            // Guard against the splash's own timer firing after the router
            // already moved on (e.g. an authenticated cold start bootstraps
            // straight to 'app' before this fires) — only advance to
            // onboarding if we're still actually showing the splash.
            if (screenRef.current === 'splash') setScreen('onboardingFunnel');
          }}
        />
      )}
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
      {resolvedScreen === 'app' && <AppShell />}
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

  // i18n bootstrap runs in parallel with `useFonts` — same `<FullScreenLoading/>`
  // covers both. `initI18n()` is idempotent (module-level memoization), so
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
      // A cold process has no resumable local upload queue. Both plaintext
      // and abandoned ciphertext staging files are therefore safe to remove.
      cleanupPhotoVaultTempFiles({ includeEncrypted: true });
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

  useEffect(() => {
    // First commit of the JS tree already paints the Dark FullScreenLoading
    // gate (same near-black background as the native splash), so it is safe
    // to hand off here regardless of how long hydration/fonts/i18n still take.
    void NativeSplashScreen.hideAsync();
  }, []);

  return (
    // Root for react-native-gesture-handler. Required on Android for any
    // gesture to be recognized at all; the Photo Vault viewer mounts a second
    // one inside its native Modal, which is a separate view hierarchy.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
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
                            the real app in Dark. */}
                        {themeHydrated && fontsLoaded && i18nReady
                          ? <RootNavigator />
                          : <FullScreenLoading />}
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
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
