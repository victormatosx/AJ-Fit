import React from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  InterstitialLayout,
  InterstitialBody,
  InterstitialHighlight,
  InterstitialTitle,
} from '../../components/onboarding/InterstitialLayout';
import { Icon } from '../../components/ui/Icon';
import { colors, fonts, spacing } from '../../theme/tokens';
import type { OnboardingProgress } from '../../onboarding/useOnboardingFunnel';

function PhaseChip({ label, active }: { label: string; active: boolean }) {
  return (
    <View
      style={{
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 10,
        backgroundColor: active ? 'rgba(11,112,249,0.16)' : 'rgba(255,255,255,0.04)',
        borderWidth: 1,
        borderColor: active ? colors.accent : 'rgba(255,255,255,0.08)',
      }}
    >
      <Text
        style={{
          fontFamily: fonts.monoBold,
          fontSize: 11,
          letterSpacing: 1.5,
          color: active ? colors.accentHi : colors.faint,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function EvolutionInterstitialScreen({
  progress,
  onContinue,
}: {
  progress: OnboardingProgress;
  onContinue: () => void;
}) {
  const { t } = useTranslation('onboarding');
  return (
    <InterstitialLayout
      eyebrow={t('interstitials.evolution.eyebrow')}
      progress={progress}
      ctaLabel={t('interstitials.evolution.cta')}
      onContinue={onContinue}
    >
      <InterstitialTitle>{t('interstitials.evolution.titleLine1')}{'\n'}{t('interstitials.evolution.titleLine2')}</InterstitialTitle>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[4] }}>
        <PhaseChip label={t('interstitials.evolution.phase1')} active />
        <Icon name="arrow-right" size={14} color={colors.faint} />
        <PhaseChip label={t('interstitials.evolution.phase2')} active={false} />
        <Icon name="arrow-right" size={14} color={colors.faint} />
        <PhaseChip label={t('interstitials.evolution.phase3')} active={false} />
      </View>

      <InterstitialBody>{t('interstitials.evolution.body')}</InterstitialBody>
      <InterstitialHighlight>{t('interstitials.evolution.highlight')}</InterstitialHighlight>
    </InterstitialLayout>
  );
}
