import React from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InterstitialLayout, InterstitialTitle } from '../../components/onboarding/InterstitialLayout';
import { Icon, type IconName } from '../../components/ui/Icon';
import { colors, fonts, spacing } from '../../theme/tokens';
import type { OnboardingProgress } from '../../onboarding/useOnboardingFunnel';

const FEATURES: { key: 'loads' | 'body' | 'photos'; icon: IconName }[] = [
  { key: 'loads', icon: 'chart' },
  { key: 'body', icon: 'user' },
  { key: 'photos', icon: 'camera' },
];

export function AjFitProgressInterstitialScreen({
  name,
  progress,
  onContinue,
}: {
  name: string | null;
  progress: OnboardingProgress;
  onContinue: () => void;
}) {
  const { t } = useTranslation('onboarding');
  const tLoose = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  return (
    <InterstitialLayout
      eyebrow={t('interstitials.ajFitProgress.eyebrow')}
      progress={progress}
      ctaLabel={t('interstitials.ajFitProgress.cta')}
      onContinue={onContinue}
    >
      <InterstitialTitle>
        {name
          ? t('interstitials.ajFitProgress.titleLine1', { name })
          : t('interstitials.ajFitProgress.titleLine1NoName')}
        {'\n'}
        {t('interstitials.ajFitProgress.titleLine2')}
      </InterstitialTitle>

      <View style={{ gap: spacing[2.5], marginTop: spacing[4] }}>
        {FEATURES.map((f) => (
          <View
            key={f.key}
            style={{
              flexDirection: 'row',
              gap: spacing[3],
              padding: spacing[3],
              borderRadius: 14,
              backgroundColor: 'rgba(255,255,255,0.03)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.07)',
              alignItems: 'center',
            }}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                backgroundColor: 'rgba(11,112,249,0.16)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={f.icon} size={18} color={colors.accentHi} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: '#fff' }}>
                {tLoose(`interstitials.ajFitProgress.features.${f.key}.title`)}
              </Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.mute, marginTop: 2 }}>
                {tLoose(`interstitials.ajFitProgress.features.${f.key}.body`)}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </InterstitialLayout>
  );
}
