import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator } from 'react-native';
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
import { useSubscription } from './src/hooks/useSubscription';
import { resolvePremiumGate, type RootScreenId } from './src/lib/premiumGate';
import { addQuestionnaire } from './src/services/userProfile';
import { logAuthError } from './src/services/auth';
import { configureRevenueCat, logRevenueCatError } from './src/services/revenueCatService';
import { SplashScreen } from './src/screens/SplashScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { QuizScreen } from './src/screens/QuizScreen';
import { AnalyzingScreen } from './src/screens/AnalyzingScreen';
import { PlanReadyScreen } from './src/screens/PlanReadyScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { PaywallScreen } from './src/screens/PaywallScreen';
import { AppShell } from './src/screens/AppShell';
import { colors } from './src/theme/tokens';

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
configureRevenueCat().catch((err) => logRevenueCatError('bootstrap', err));

function Loading() {
  return (
    <View
      style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}
    >
      <ActivityIndicator color={colors.accentHi} />
    </View>
  );
}

function RootNavigator() {
  const { user, questionnaire, initializing, profileLoading, refreshProfile, logout } = useAuth();
  const {
    loading: subscriptionLoading,
    configured: subscriptionConfigured,
    isPremium,
  } = useSubscription();
  const { quiz } = useAppState();
  const [screen, setScreenState] = useState<RootScreenId>('splash');
  // Mirrors `screen` synchronously so late/stale callbacks (e.g. the splash
  // timer firing after the router already moved on) can check the current
  // route without depending on a stale closure over the state value.
  const screenRef = useRef<RootScreenId | null>('splash');
  // Guards the forced-questionnaire save below against double submission
  // (e.g. a fast double-tap on the last quiz question).
  const [savingQuestionnaire, setSavingQuestionnaire] = useState(false);

  const setScreen = (next: RootScreenId) => {
    screenRef.current = next;
    setScreenState(next);
  };

  // This pure decision is also the render guard: AppShell is never mounted
  // from a stale/requested route while auth, questionnaire, or the CustomerInfo
  // for the current Firebase UID is unresolved. Once all three are known,
  // RevenueCat's `premium` entitlement exclusively chooses app vs. paywall.
  const resolvedScreen = resolvePremiumGate({
    requestedScreen: screen,
    authInitializing: initializing,
    profileLoading,
    authenticated: Boolean(user),
    hasQuestionnaire: Boolean(questionnaire),
    subscriptionLoading,
    subscriptionConfigured,
    isPremium,
  });

  // Keep the requested screen aligned with the centrally resolved route so
  // logout/account switches continue from the effective screen, while still
  // rendering `resolvedScreen` immediately (before this effect can run).
  useEffect(() => {
    if (resolvedScreen && resolvedScreen !== screen) setScreen(resolvedScreen);
  }, [resolvedScreen, screen]);

  screenRef.current = resolvedScreen;

  if (!resolvedScreen) return <Loading />;

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

  if (!fontsLoaded) {
    return <Loading />;
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        {/* Nested inside AuthProvider so SubscriptionProvider can read
            useAuth()'s `user`/`initializing` and react to it (calling
            loginRevenueCat/logoutRevenueCat internally). AuthContext itself
            is untouched — it stays the sole owner of identity and knows
            nothing about RevenueCat; SubscriptionContext just watches it. */}
        <SubscriptionProvider>
          <AppStateProvider>
            <StatusBar style="light" />
            <RootNavigator />
          </AppStateProvider>
        </SubscriptionProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
