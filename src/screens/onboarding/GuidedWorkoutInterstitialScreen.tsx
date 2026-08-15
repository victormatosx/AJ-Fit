import React from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  InterstitialLayout,
  InterstitialHighlight,
  InterstitialTitle,
} from '../../components/onboarding/InterstitialLayout';
import { colors, fonts, spacing } from '../../theme/tokens';
import type { OnboardingProgress } from '../../onboarding/useOnboardingFunnel';

/** Visual mock of a workout row — exercise/sets/reps/load/rest are all real fields the app already tracks. */
type LooseT = (key: string) => string;

function WorkoutRowMock() {
  const { t } = useTranslation('onboarding');
  const tLoose = t as unknown as LooseT;
  const cols: { key: string; value: string }[] = [
    { key: 'sets', value: '4' },
    { key: 'reps', value: '10' },
    { key: 'load', value: '40kg' },
    { key: 'rest', value: '90s' },
  ];
  return (
    <View
      style={{
        marginTop: spacing[4],
        padding: spacing[3],
        borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.07)',
      }}
    >
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: '#fff' }}>
        {t('interstitials.guidedWorkout.row.exercise')}
      </Text>
      <View style={{ flexDirection: 'row', marginTop: spacing[2], gap: spacing[3] }}>
        {cols.map((c) => (
          <View key={c.key} style={{ alignItems: 'center', flex: 1 }}>
            <Text style={{ fontFamily: fonts.display, fontSize: 20, color: colors.accentHi }}>{c.value}</Text>
            <Text style={{ fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1.5, color: colors.faint, marginTop: 2 }}>
              {tLoose(`interstitials.guidedWorkout.row.${c.key}`).toUpperCase()}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function GuidedWorkoutInterstitialScreen({
  progress,
  onContinue,
}: {
  progress: OnboardingProgress;
  onContinue: () => void;
}) {
  const { t } = useTranslation('onboarding');
  return (
    <InterstitialLayout
      eyebrow={t('interstitials.guidedWorkout.eyebrow')}
      progress={progress}
      ctaLabel={t('interstitials.guidedWorkout.cta')}
      onContinue={onContinue}
    >
      <InterstitialTitle>
        {t('interstitials.guidedWorkout.titleLine1')}
        {'\n'}
        {t('interstitials.guidedWorkout.titleLine2')}
      </InterstitialTitle>
      <WorkoutRowMock />
      <InterstitialHighlight>{t('interstitials.guidedWorkout.highlight')}</InterstitialHighlight>
    </InterstitialLayout>
  );
}
