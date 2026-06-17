import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, Text, ActivityIndicator } from 'react-native';
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

  const [screen, setScreen] = useState<ScreenId>('splash');

  if (!fontsLoaded) {
    return (
      <View
        style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}
      >
        <ActivityIndicator color={colors.accentHi} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AppStateProvider>
        <StatusBar style="light" />
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {screen === 'splash' && <SplashScreen onDone={() => setScreen('onboarding')} />}
          {screen === 'onboarding' && <OnboardingScreen onDone={() => setScreen('quiz')} />}
          {screen === 'quiz' && <QuizScreen onDone={() => setScreen('analyzing')} />}
          {screen === 'analyzing' && <AnalyzingScreen onDone={() => setScreen('plan')} />}
          {screen === 'plan' && <PlanReadyScreen onContinue={() => setScreen('auth')} />}
          {screen === 'auth' && <AuthScreen onDone={() => setScreen('paywall')} />}
          {screen === 'paywall' && <PaywallScreen onDone={() => setScreen('app')} />}
          {screen === 'app' && <AppShell />}
        </View>
      </AppStateProvider>
    </SafeAreaProvider>
  );
}
