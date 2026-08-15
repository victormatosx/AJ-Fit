import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InterstitialLayout, InterstitialBody, InterstitialTitle } from '../../components/onboarding/InterstitialLayout';
import type { OnboardingProgress } from '../../onboarding/useOnboardingFunnel';

export function WelcomeInterstitialScreen({
  name,
  progress,
  onContinue,
}: {
  name: string | null;
  progress: OnboardingProgress;
  onContinue: () => void;
}) {
  const { t } = useTranslation('onboarding');
  return (
    <InterstitialLayout
      eyebrow={t('welcome.eyebrow')}
      progress={progress}
      ctaLabel={t('welcome.cta')}
      onContinue={onContinue}
    >
      <View style={{ justifyContent: 'center', flex: 1 }}>
        <InterstitialTitle>
          {name ? t('welcome.greeting', { name }) : t('welcome.greetingNoName')}
        </InterstitialTitle>
        <InterstitialBody>{t('welcome.body')}</InterstitialBody>
      </View>
    </InterstitialLayout>
  );
}
