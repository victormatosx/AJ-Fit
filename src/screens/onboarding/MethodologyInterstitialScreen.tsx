import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { VideoView } from 'expo-video';
import { Image } from 'expo-image';
import { Display, Slash } from '../../components/ui/Display';
import { CtaButton, CtaText } from '../../components/ui/CtaButton';
import { SegBar } from '../../components/ui/SegBar';
import { colors, fonts, motion, sizes, spacing } from '../../theme/tokens';
import { useReducedMotionPreference } from '../../lib/reducedMotion';
import { getMethodologyVideoPlayer } from '../../onboarding/onboardingVideoPreload';
import type { OnboardingProgress } from '../../onboarding/useOnboardingFunnel';

const METHODOLOGY_VIDEO_POSTER = require('../../../assets/onboarding/methodology-video-poster.jpg');

/**
 * Cinematic, video-backed replacement for the old three-pillar-card layout.
 * The video is pure art direction (background, muted, looping) — the CTA is
 * never gated on it. Unlike `InterstitialLayout`-based screens, this one
 * composes its own chrome so the video background stays local to this step.
 *
 * The player itself is a singleton owned by `onboardingVideoPreload`, not
 * created here — `OnboardingFunnelScreen` starts warming it up a couple of
 * steps before the user can reach this screen, so the native decoder has
 * already opened the local asset by the time `VideoView` mounts. A poster
 * frame (extracted from the video's own first frame, so the handoff can't
 * look like a photo swap) covers the screen from the first paint and only
 * fades out once `onFirstFrameRender` confirms a frame has actually been
 * drawn — the only signal expo-video gives that's specific enough to hide,
 * rather than just relocate, the black-frame gap. `status === 'readyToPlay'`
 * is not enough for this: it only means enough data is buffered to *start*
 * playback, not that a frame has reached the screen.
 */
export function MethodologyInterstitialScreen({
  progress,
  onContinue,
}: {
  progress: OnboardingProgress;
  onContinue: () => void;
}) {
  const { t } = useTranslation('onboarding');
  const reduceMotion = useReducedMotionPreference();
  const player = getMethodologyVideoPlayer();

  const posterOpacity = useRef(new Animated.Value(1)).current;
  const [firstFrameRendered, setFirstFrameRendered] = useState(false);

  // The player is a singleton that outlives this screen's mount (see
  // onboardingVideoPreload), so pausing on cleanup is safe — unlike a
  // `useVideoPlayer()`-owned player, nothing releases it out from under us.
  useEffect(() => {
    if (reduceMotion) {
      player.pause();
      return;
    }
    player.play();
    return () => {
      player.pause();
    };
  }, [player, reduceMotion]);

  // Reduce Motion: keep the static poster as the permanent visual instead
  // of ever confirming/fading to a moving frame.
  useEffect(() => {
    if (reduceMotion || !firstFrameRendered) return;
    Animated.timing(posterOpacity, {
      toValue: 0,
      duration: motion.duration.fast,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [firstFrameRendered, reduceMotion, posterOpacity]);

  return (
    <View style={styles.root}>
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit="cover"
        nativeControls={false}
        allowsPictureInPicture={false}
        pointerEvents="none"
        onFirstFrameRender={() => setFirstFrameRendered(true)}
      />

      {/* Same crop/position as the video (`contentFit="cover"` on both) so
          the poster-to-video handoff reads as the image starting to move,
          not a photo being swapped out. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: posterOpacity }]} pointerEvents="none">
        <Image source={METHODOLOGY_VIDEO_POSTER} style={StyleSheet.absoluteFill} contentFit="cover" />
      </Animated.View>

      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(2,0,16,0.32)' }]} />
        <LinearGradient
          colors={['rgba(2,0,16,0)', 'rgba(2,0,16,0.6)', colors.bg]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={{ paddingHorizontal: sizes.screenGutter, paddingTop: spacing[3] }}>
          <SegBar value={progress.total ? progress.current / progress.total : 0} segs={progress.total || 1} />
        </View>

        <View style={{ flex: 1 }} />

        <View style={{ paddingHorizontal: sizes.screenGutter, paddingBottom: spacing[2] }}>
          <Slash>{t('interstitials.methodology.eyebrow')}</Slash>

          <View style={{ marginTop: spacing[2] }}>
            <Display size={32}>{t('interstitials.methodology.titleLine1')}</Display>
            <Display size={32} color={colors.accentHi}>
              {t('interstitials.methodology.titleLine2')}
            </Display>
          </View>

          <Text style={styles.body}>{t('interstitials.methodology.body')}</Text>

          <CtaButton onPress={onContinue} style={{ marginTop: spacing[5], marginBottom: spacing[2] }}>
            <CtaText>{t('interstitials.methodology.cta')}</CtaText>
          </CtaButton>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden' },
  safe: { flex: 1 },
  body: {
    fontFamily: fonts.ui,
    fontSize: 14.5,
    lineHeight: 21,
    color: colors.textSecondary,
    marginTop: spacing[2],
    maxWidth: 320,
  },
});
