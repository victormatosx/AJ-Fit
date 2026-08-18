import React from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Display, Slash } from '../../components/ui/Display';
import { CtaButton, CtaText } from '../../components/ui/CtaButton';
import { SegBar } from '../../components/ui/SegBar';
import { ScreenBg } from '../../components/ui/ScreenBg';
import { OutlineNumber } from '../../components/ui/OutlineNumber';
import { AjFitProgressCarousel } from '../../components/onboarding/AjFitProgressCarousel';
import { colors, sizes, spacing } from '../../theme/tokens';
import type { OnboardingProgress } from '../../onboarding/useOnboardingFunnel';

/**
 * The AJ Fit product itself — shown through a 3D circular carousel of
 * screenshots — is the pitch here, not a list of feature cards. See
 * `AjFitProgressCarousel` for the carousel mechanics. Structure mirrors
 * `EvolutionInterstitialScreen`: fixed headline + CTA rhythm, with a single
 * `flexGrow: 1` area around the carousel absorbing leftover height.
 */
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

  return (
    <ScreenBg>
      <OutlineNumber
        size={260}
        style={{ position: 'absolute', top: -40, right: -50, opacity: 0.35 }}
      >
        AJ
      </OutlineNumber>

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ paddingHorizontal: sizes.screenGutter, paddingTop: spacing[3] }}>
          <SegBar value={progress.total ? progress.current / progress.total : 0} segs={progress.total || 1} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: sizes.screenGutter,
            paddingTop: spacing[6],
            paddingBottom: spacing[3],
          }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ flexGrow: 1 }}>
            <View>
              <Slash>{t('interstitials.ajFitProgress.eyebrow')}</Slash>
              <View style={{ marginTop: spacing[3] }}>
                <Display size={30}>
                  {name
                    ? t('interstitials.ajFitProgress.titleLine1', { name })
                    : t('interstitials.ajFitProgress.titleLine1NoName')}
                </Display>
                <Display size={30} color={colors.accentHi}>
                  {t('interstitials.ajFitProgress.titleLine2')}
                </Display>
              </View>
            </View>

            <View style={{ flexGrow: 1, justifyContent: 'center', minHeight: spacing[8] }}>
              <AjFitProgressCarousel />
            </View>

            <CtaButton onPress={onContinue} style={{ marginBottom: spacing[2] }}>
              <CtaText>{t('interstitials.ajFitProgress.cta')}</CtaText>
            </CtaButton>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}
