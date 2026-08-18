import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Display, Slash } from '../../components/ui/Display';
import { CtaButton, CtaText } from '../../components/ui/CtaButton';
import { SegBar } from '../../components/ui/SegBar';
import { ScreenBg } from '../../components/ui/ScreenBg';
import { OutlineNumber } from '../../components/ui/OutlineNumber';
import { GuidedWorkoutCarousel } from '../../components/onboarding/GuidedWorkoutCarousel';
import { colors, fonts, sizes, spacing } from '../../theme/tokens';
import type { OnboardingProgress } from '../../onboarding/useOnboardingFunnel';

/**
 * Product-demo interstitial: an auto-advancing carousel of three short demo
 * clips (`video-01/02/03.mp4`) *is* the pitch, each with its own caption
 * below the carousel — see `GuidedWorkoutCarousel` for the playback/preload
 * architecture (`onboardingVideoPreload.ts`).
 */
export function GuidedWorkoutInterstitialScreen({
  progress,
  onContinue,
}: {
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

        <View style={{ paddingHorizontal: sizes.screenGutter, paddingTop: spacing[6] }}>
          <Slash>{t('interstitials.guidedWorkout.eyebrow')}</Slash>
          <View style={{ marginTop: spacing[3] }}>
            <Display size={30}>{t('interstitials.guidedWorkout.titleLine1')}</Display>
            <Display size={30} color={colors.accentHi}>
              {t('interstitials.guidedWorkout.titleLine2')}
            </Display>
          </View>
        </View>

        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: spacing[3],
            paddingHorizontal: sizes.screenGutter,
          }}
        >
          <GuidedWorkoutCarousel />
        </View>

        <View style={{ paddingHorizontal: sizes.screenGutter, paddingBottom: spacing[2] }}>
          <Text style={styles.body}>{t('interstitials.guidedWorkout.body')}</Text>

          <CtaButton onPress={onContinue} style={{ marginTop: spacing[3], marginBottom: spacing[2] }}>
            <CtaText>{t('interstitials.guidedWorkout.cta')}</CtaText>
          </CtaButton>
        </View>
      </SafeAreaView>
    </ScreenBg>
  );
}

const styles = StyleSheet.create({
  body: {
    fontFamily: fonts.ui,
    fontSize: 14,
    lineHeight: 20,
    color: colors.mute,
    textAlign: 'center',
    maxWidth: 260,
    alignSelf: 'center',
  },
});
