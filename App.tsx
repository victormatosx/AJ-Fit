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
import { addQuestionnaire } from './src/services/userProfile';
import { logAuthError } from './src/services/auth';
import { SplashScreen } from './src/screens/SplashScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { QuizScreen } from './src/screens/QuizScreen';
import { AnalyzingScreen } from './src/screens/AnalyzingScreen';
import { PlanReadyScreen } from './src/screens/PlanReadyScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { PaywallScreen } from './src/screens/PaywallScreen';
import { AppShell } from './src/screens/AppShell';
import { colors } from './src/theme/tokens';

type ScreenId =
  | 'splash'
  | 'onboarding'
  | 'quiz'
  | 'analyzing'
  | 'plan'
  | 'auth'
  | 'paywall'
  | 'app';

// Screens that require an authenticated user.
const PROTECTED: ScreenId[] = ['paywall', 'app'];

// Pre-app funnel screens. An authenticated user who already satisfies every
// access requirement (currently: has a questionnaire) should never be shown
// these — they belong to users who are still signing up.
const FUNNEL_ONLY: ScreenId[] = [
  'splash',
  'onboarding',
  'quiz',
  'analyzing',
  'plan',
  'auth',
];

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
  const { user, questionnaire, initializing, profileLoading, refreshProfile } = useAuth();
  const { quiz } = useAppState();
  const [screen, setScreenState] = useState<ScreenId>('splash');
  // Mirrors `screen` synchronously so late/stale callbacks (e.g. the splash
  // timer firing after the router already moved on) can check the current
  // route without depending on a stale closure over the state value.
  const screenRef = useRef<ScreenId>('splash');
  // Guards the forced-questionnaire save below against double submission
  // (e.g. a fast double-tap on the last quiz question).
  const [savingQuestionnaire, setSavingQuestionnaire] = useState(false);

  const setScreen = (next: ScreenId) => {
    screenRef.current = next;
    setScreenState(next);
  };

  // Single source of truth for navigation: authenticated users are routed
  // purely from their current state — never from the screen they happen to
  // be on — so the rule "no questionnaire ⇒ no app" holds no matter how the
  // user got authenticated (email, Google, Apple, a restored session) or
  // which screen was showing when auth state changed. Runs on cold start and
  // on every subsequent auth/questionnaire change (login, logout, forced
  // questionnaire completion).
  useEffect(() => {
    // `profileLoading` covers the gap between a sign-in/sign-up call setting
    // `user` and its matching Firestore read landing in `questionnaire` —
    // without this, a fully-onboarded user would flash through 'quiz' on
    // every login while that read is still in flight.
    if (initializing || profileLoading) return;

    if (!user) {
      // Unauthenticated: keep out of screens that require a session (also
      // handles logout, which clears `user` while inside the app).
      if (PROTECTED.includes(screen)) setScreen('auth');
      return;
    }

    if (!questionnaire) {
      // Authenticated but without a questionnaire — mandatory detour,
      // regardless of screen (covers social-login first-timers and any
      // restored session that was left in this state).
      if (screen !== 'quiz') setScreen('quiz');
      return;
    }

    // Authenticated + has a questionnaire: never show the signup funnel.
    if (FUNNEL_ONLY.includes(screen)) setScreen('app');
  }, [initializing, profileLoading, user, questionnaire, screen]);

  if (initializing) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {screen === 'splash' && (
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
      {screen === 'onboarding' && (
        <OnboardingScreen
          onDone={() => setScreen('quiz')}
          onLogin={() => setScreen('auth')}
        />
      )}
      {screen === 'quiz' && (
        <QuizScreen
          onDone={async () => {
            if (user) {
              // Forced questionnaire for an already-authenticated user (e.g. a
              // social login that never had one). Persist it and let the
              // effect above route to 'app' once `questionnaire` reloads —
              // this screen never navigates itself in that case.
              if (savingQuestionnaire) return;
              setSavingQuestionnaire(true);
              try {
                await addQuestionnaire(user.uid, quiz, 1);
                await refreshProfile();
              } catch (err) {
                logAuthError('quiz:save-questionnaire', err);
                // Stays on 'quiz' — the effect above keeps it there until a
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
      {screen === 'analyzing' && <AnalyzingScreen onDone={() => setScreen('plan')} />}
      {screen === 'plan' && <PlanReadyScreen onContinue={() => setScreen('auth')} />}
      {screen === 'auth' && <AuthScreen />}
      {screen === 'paywall' && <PaywallScreen onDone={() => setScreen('app')} />}
      {screen === 'app' && <AppShell />}
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
        <AppStateProvider>
          <StatusBar style="light" />
          <RootNavigator />
        </AppStateProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
