import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, Pressable, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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

import { AppStateProvider, useAppState } from './src/state/AppState';
import { AuthProvider, useAuth } from './src/state/AuthContext';
import { SubscriptionProvider } from './src/state/SubscriptionContext';
import { PromoCodeProvider } from './src/state/PromoCodeContext';
import { useSubscription } from './src/hooks/useSubscription';
import { resolvePremiumGate, type RootScreenId } from './src/lib/premiumGate';
import { PhotoVaultProvider } from './src/state/PhotoVaultContext';
import { addQuestionnaire } from './src/services/userProfile';
import { logAuthError } from './src/services/auth';
import { configureRevenueCat } from './src/services/revenueCatService';
import { SplashScreen } from './src/screens/SplashScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { QuizScreen } from './src/screens/QuizScreen';
import { AnalyzingScreen } from './src/screens/AnalyzingScreen';
import { PlanReadyScreen } from './src/screens/PlanReadyScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { EmailVerificationScreen } from './src/screens/EmailVerificationScreen';
import { PaywallScreen } from './src/screens/PaywallScreen';
import { AppShell } from './src/screens/AppShell';
import { FullScreenLoading } from './src/components/ui/FullScreenLoading';
import { requiresEmailVerification } from './src/lib/emailVerification';
import { colors } from './src/theme/tokens';
import { initI18n } from './src/i18n';
import { reconcileLanguageOnLoad } from './src/i18n/syncLanguage';
import { reconcileUnitsOnLoad } from './src/units/syncUnits';
import { UnitsProvider } from './src/state/UnitsContext';
import { cleanupPhotoVaultTempFiles } from './src/services/photoVaultFileCrypto';
import { logPhotoVaultIssue } from './src/lib/photoVaultErrors';
import { logInfo } from './src/lib/logger';

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

function SubscriptionResolutionError({
  message,
  offline,
  onRetry,
}: {
  message: string;
  offline: boolean;
  onRetry: () => Promise<void>;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 28,
      }}
    >
      <Text
        style={{
          color: colors.text,
          fontFamily: 'Archivo_700Bold',
          fontSize: 18,
          textAlign: 'center',
        }}
      >
        {offline ? 'Conexão necessária' : 'Assinatura indisponível'}
      </Text>
      <Text
        style={{
          color: colors.mute,
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
          borderColor: colors.accentHi,
          paddingHorizontal: 22,
          paddingVertical: 12,
        }}
      >
        <Text
          style={{
            color: colors.text,
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

function RootNavigator() {
  const { user, profile, questionnaire, initializing, profileLoading, refreshProfile, logout } =
    useAuth();
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
  const { quiz } = useAppState();
  const [screen, setScreenState] = useState<RootScreenId>('splash');
  // Mirrors `screen` synchronously so late/stale callbacks (e.g. the splash
  // timer firing after the router already moved on) can check the current
  // route without depending on a stale closure over the state value.
  const screenRef = useRef<RootScreenId | null>('splash');
  // Guards the forced-questionnaire save below against double submission
  // (e.g. a fast double-tap on the last quiz question).
  const [savingQuestionnaire, setSavingQuestionnaire] = useState(false);
  // Account-preference reconciliation runs at every profileLoading→false transition.
  // While it runs, resolvePremiumGate holds the routing gate closed (same as
  // profileLoading) so the first authed screen renders with reconciled
  // language and units already applied. Fires once per profile-load cycle —
  // no polling, no timers. This NEVER influences the Premium decision below —
  // it only delays which screen becomes visible, exactly like the other
  // pre-Premium checks resolvePremiumGate already made (auth, questionnaire).
  const [preferencesReconciling, setPreferencesReconciling] = useState(false);
  const prevProfileLoadingRef = useRef(true);

  const setScreen = (next: RootScreenId) => {
    screenRef.current = next;
    setScreenState(next);
  };

  useEffect(() => {
    const wasLoading = prevProfileLoadingRef.current;
    prevProfileLoadingRef.current = profileLoading;
    // Account creation can briefly finish the auth listener's pre-provision
    // profile read with `profile === null`. That is not a malformed profile:
    // provisionNewUser is still creating it. Wait for the authoritative
    // post-provision load instead of reporting missing preferences as errors.
    if (initializing || profileLoading || !wasLoading || !user || !profile) return;
    setPreferencesReconciling(true);
    Promise.all([
      reconcileLanguageOnLoad({
        uid: user.uid,
        remoteLanguage: profile.preferences.language,
      }),
      reconcileUnitsOnLoad({
        uid: user.uid,
        remoteUnits: profile.preferences.units,
      }),
    ]).finally(() => setPreferencesReconciling(false));
  }, [initializing, profileLoading, user, profile]);

  // This pure decision is also the render guard: AppShell is never mounted
  // from a stale/requested route while auth, email verification, preference
  // reconciliation, questionnaire, or the CustomerInfo for the current
  // Firebase UID is unresolved. Once all prerequisites are known,
  // RevenueCat's `premium` entitlement exclusively chooses app vs. paywall.
  const resolvedScreen = resolvePremiumGate({
    requestedScreen: screen,
    authInitializing: initializing,
    profileLoading,
    authenticated: Boolean(user),
    emailVerificationRequired,
    preferencesReconciling,
    hasQuestionnaire: Boolean(questionnaire),
    subscriptionLoading,
    subscriptionConfigured,
    isPremium,
  });

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
      hasQuestionnaire: Boolean(questionnaire),
      subscriptionLoading,
      subscriptionConfigured,
      subscriptionStatus,
      isPremium,
    });
  }, [
    user?.uid,
    screen,
    resolvedScreen,
    initializing,
    profileLoading,
    emailVerificationRequired,
    preferencesReconciling,
    questionnaire,
    subscriptionLoading,
    subscriptionConfigured,
    subscriptionStatus,
    isPremium,
  ]);

  // Keep the requested screen aligned with the centrally resolved route so
  // logout/account switches continue from the effective screen, while still
  // rendering `resolvedScreen` immediately (before this effect can run).
  useEffect(() => {
    if (resolvedScreen && resolvedScreen !== screen) setScreen(resolvedScreen);
  }, [resolvedScreen, screen]);

  screenRef.current = resolvedScreen;

  if (!resolvedScreen) {
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
          message={subscriptionError ?? 'Não foi possível verificar a assinatura agora.'}
          offline={subscriptionErrorKind === 'offline'}
          onRetry={retrySubscription}
        />
      );
    }
    return <FullScreenLoading />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {resolvedScreen === 'splash' && (
        <SplashScreen
          onDone={() => {
            // Guard against the splash's own timer firing after the router
            // already moved on (e.g. an authenticated cold start bootstraps
            // straight to 'app' before this fires) — only advance to
            // onboarding if we're still actually showing the splash.
            if (screenRef.current === 'splash') setScreen('onboarding');
          }}
        />
      )}
      {resolvedScreen === 'onboarding' && (
        <OnboardingScreen
          onDone={() => setScreen('quiz')}
          onLogin={() => setScreen('auth')}
        />
      )}
      {resolvedScreen === 'quiz' && (
        <QuizScreen
          onDone={async () => {
            if (user) {
              // Forced questionnaire for an already-authenticated user (e.g. a
              // social login that never had one). Persist it and let the
              // central gate above choose app/paywall once `questionnaire`
              // reloads — this screen never navigates itself in that case.
              if (savingQuestionnaire) return;
              setSavingQuestionnaire(true);
              try {
                await addQuestionnaire(user.uid, quiz, 1);
                await refreshProfile();
              } catch (err) {
                logAuthError('quiz:save-questionnaire', err);
                // Stays on 'quiz' — the gate keeps it there until a
                // questionnaire actually exists, so the user can just retry.
              } finally {
                setSavingQuestionnaire(false);
              }
              return;
            }
            // Anonymous pre-signup funnel: unchanged.
            setScreen('analyzing');
          }}
        />
      )}
      {resolvedScreen === 'analyzing' && <AnalyzingScreen onDone={() => setScreen('plan')} />}
      {resolvedScreen === 'plan' && <PlanReadyScreen onContinue={() => setScreen('auth')} />}
      {resolvedScreen === 'auth' && <AuthScreen />}
      {resolvedScreen === 'emailVerification' && <EmailVerificationScreen />}
      {resolvedScreen === 'paywall' && (
        <PaywallScreen
          onClose={async () => {
            try {
              await logout();
            } catch (err) {
              logAuthError('paywall:logout', err);
            }
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
            backgroundColor: 'rgba(0,0,0,0.35)',
          }}
        >
          <ActivityIndicator color={colors.accentHi} />
        </View>
      )}
    </View>
  );
}

export default function App() {
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
  }, []);

  useEffect(() => {
    initI18n().finally(() => setI18nReady(true));
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        {/* Nested inside AuthProvider so SubscriptionProvider can read
            useAuth()'s `user`/`initializing` and react to it (calling
            loginRevenueCat/logoutRevenueCat internally). AuthContext itself
            is untouched — it stays the sole owner of identity and knows
            nothing about RevenueCat; SubscriptionContext just watches it. */}
        <SubscriptionProvider>
          <PromoCodeProvider>
            <UnitsProvider>
              <AppStateProvider>
                {/* Inside AuthProvider so it can re-lock on logout and account
                    switches; wraps the navigator so its AppState listener is
                    mounted for the whole session. */}
                <PhotoVaultProvider>
                  <StatusBar style="light" />
                  {/* Providers mount immediately so Firebase profile reads,
                      RevenueCat identity synchronization, vault locking and
                      preference hydration can overlap font/i18n loading. */}
                  {fontsLoaded && i18nReady ? <RootNavigator /> : <FullScreenLoading />}
                </PhotoVaultProvider>
              </AppStateProvider>
            </UnitsProvider>
          </PromoCodeProvider>
        </SubscriptionProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
