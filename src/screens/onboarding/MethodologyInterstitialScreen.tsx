import React from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InterstitialLayout, InterstitialBody, InterstitialTitle } from '../../components/onboarding/InterstitialLayout';
import { Icon, type IconName } from '../../components/ui/Icon';
import { colors, fonts, spacing } from '../../theme/tokens';
import type { OnboardingProgress } from '../../onboarding/useOnboardingFunnel';

const PILLARS: { key: 'volume' | 'progression' | 'recovery'; icon: IconName }[] = [
  { key: 'volume', icon: 'chart' },
  { key: 'progression', icon: 'trophy' },
  { key: 'recovery', icon: 'heart' },
];

export function MethodologyInterstitialScreen({
  progress,
  onContinue,
}: {
  progress: OnboardingProgress;
  onContinue: () => void;
}) {
  const { t } = useTranslation('onboarding');
  const tLoose = t as unknown as (key: string) => string;
  return (
    <InterstitialLayout
      eyebrow={t('interstitials.methodology.eyebrow')}
      progress={progress}
      ctaLabel={t('interstitials.methodology.cta')}
      onContinue={onContinue}
    >
      <InterstitialTitle>
        {t('interstitials.methodology.titleLine1')}
        {'\n'}
        {t('interstitials.methodology.titleLine2')}
      </InterstitialTitle>

      <View style={{ gap: spacing[3], marginTop: spacing[4] }}>
        {PILLARS.map((p) => (
          <View
            key={p.key}
            style={{
              flexDirection: 'row',
              gap: spacing[3],
              padding: spacing[3],
              borderRadius: 14,
              backgroundColor: 'rgba(255,255,255,0.03)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.07)',
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                backgroundColor: 'rgba(11,112,249,0.16)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={p.icon} size={19} color={colors.accentHi} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: '#fff' }}>
                {tLoose(`interstitials.methodology.pillars.${p.key}.title`)}
              </Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.mute, marginTop: 2 }}>
                {tLoose(`interstitials.methodology.pillars.${p.key}.body`)}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <InterstitialBody>{t('interstitials.methodology.body')}</InterstitialBody>
    </InterstitialLayout>
  );
}
