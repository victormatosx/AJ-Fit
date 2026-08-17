import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Display } from '../../components/ui/Display';
import { CtaButton, CtaText } from '../../components/ui/CtaButton';
import { SegBar } from '../../components/ui/SegBar';
import { EvolutionCarousel } from '../../components/onboarding/EvolutionCarousel';
import { colors, fonts, sizes, spacing } from '../../theme/tokens';
import type { OnboardingProgress } from '../../onboarding/useOnboardingFunnel';

export function EvolutionInterstitialScreen({
  progress,
  onContinue,
}: {
  progress: OnboardingProgress;
  onContinue: () => void;
}) {
  const { t } = useTranslation('onboarding');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ paddingHorizontal: sizes.screenGutter, paddingTop: spacing[3] }}>
          <SegBar
            value={progress.total ? progress.current / progress.total : 0}
            segs={progress.total || 1}
          />
        </View>

        {/* Same flexGrow-spacer approach as the other interstitials (see
            MethodologyInterstitialScreen/GuidedWorkoutInterstitialScreen):
            the ScrollView needs its own `flex: 1` so its content fills the
            space under the progress bar, and the single `flexGrow: 1` area
            wrapping the carousel is what absorbs leftover height on tall
            screens — headline and CTA keep their fixed rhythm, the carousel
            centers within whatever room is left. On short screens the
            ScrollView takes over instead of clipping the CTA. */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: sizes.screenGutter,
            paddingTop: spacing[8],
            paddingBottom: spacing[3],
          }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ flexGrow: 1 }}>
            <View>
              <Display size={30}>{t('interstitials.evolution.titleLine1')}</Display>
              <Display size={30} color={colors.accentHi}>
                {t('interstitials.evolution.titleLine2')}
              </Display>
              <Text
                style={{
                  marginTop: spacing[2],
                  fontFamily: fonts.ui,
                  fontSize: 15,
                  lineHeight: 21,
                  color: colors.mute,
                  maxWidth: 340,
                }}
              >
                {t('interstitials.evolution.intro')}
              </Text>
            </View>

            <View style={{ flexGrow: 1, justifyContent: 'center', minHeight: spacing[8] }}>
              <EvolutionCarousel />
            </View>

            <CtaButton onPress={onContinue} style={{ marginBottom: spacing[2] }}>
              <CtaText>{t('interstitials.evolution.cta')}</CtaText>
            </CtaButton>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
