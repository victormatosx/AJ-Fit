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

import { AppStateProvider } from './src/state/AppState';
import { AuthProvider, useAuth } from './src/state/AuthContext';
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
  const { user, initializing } = useAuth();
  const [screen, setScreen] = useState<ScreenId>('splash');
  const bootstrapped = useRef(false);

  // On cold start, once auth state resolves, send already-authenticated users
  // straight into the app instead of through the onboarding funnel.
  useEffect(() => {
    if (initializing || bootstrapped.current) return;
    bootstrapped.current = true;
    if (user) setScreen('app');
  }, [initializing, user]);

  // Route protection: kick unauthenticated users out of private screens
  // (also handles logout, which clears `user` while inside the app).
  useEffect(() => {
    if (initializing) return;
    if (!user && PROTECTED.includes(screen)) setScreen('auth');
  }, [initializing, user, screen]);

  if (initializing) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {screen === 'splash' && <SplashScreen onDone={() => setScreen('onboarding')} />}
      {screen === 'onboarding' && <OnboardingScreen onDone={() => setScreen('quiz')} />}
      {screen === 'quiz' && <QuizScreen onDone={() => setScreen('analyzing')} />}
      {screen === 'analyzing' && <AnalyzingScreen onDone={() => setScreen('plan')} />}
      {screen === 'plan' && <PlanReadyScreen onContinue={() => setScreen('auth')} />}
      {screen === 'auth' && <AuthScreen onDone={() => setScreen('app')} />}
      {screen === 'paywall' && <PaywallScreen onDone={() => setScreen('app')} />}
      {screen === 'app' && <AppShell />}
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
