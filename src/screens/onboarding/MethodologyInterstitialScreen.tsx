import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { useTranslation } from 'react-i18next';
import { VideoView } from 'expo-video';
import { Image } from 'expo-image';
import { AjInterstitialLayout } from '../../components/onboarding/AjInterstitialLayout';
import { motion } from '../../theme/tokens';
import { useTheme } from '../../theme';
import { useReducedMotionPreference } from '../../lib/reducedMotion';
import { getMethodologyVideoPlayer } from '../../onboarding/onboardingVideoPreload';
import type { OnboardingProgress } from '../../onboarding/useOnboardingFunnel';

const METHODOLOGY_VIDEO_POSTER = require('../../../assets/onboarding/methodology-video-poster.jpg');

/**
 * Video-backed methodology pitch. AJ introduces it and the clip plays in a
 * framed panel below him — the approved design's arrangement for the two
 * video interstitials, replacing the previous full-bleed background treatment.
 *
 * The playback architecture is untouched. The player is a singleton owned by
 * `onboardingVideoPreload`, not created here — `OnboardingFunnelScreen` starts
 * warming it up a couple of steps before the user can reach this screen, so
 * the native decoder has already opened the local asset by the time
 * `VideoView` mounts. A poster frame (extracted from the video's own first
 * frame, so the handoff can't look like a photo swap) covers the panel from
 * the first paint and only fades out once `onFirstFrameRender` confirms a
 * frame has actually been drawn — the only signal expo-video gives that is
 * specific enough to hide, rather than just relocate, the black-frame gap.
 * `status === 'readyToPlay'` is not enough for this: it only means enough data
 * is buffered to *start* playback, not that a frame has reached the screen.
 */
export function MethodologyInterstitialScreen({
  progress,
  onContinue,
}: {
  progress: OnboardingProgress;
  onContinue: () => void;
}) {
  const { t } = useTranslation('onboarding');
  const { theme } = useTheme();
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
    <AjInterstitialLayout
      progress={progress}
      lines={[
        `${t('interstitials.methodology.titleLine1')} ${t('interstitials.methodology.titleLine2')}`,
        t('interstitials.methodology.body'),
      ]}
      ctaLabel={t('interstitials.methodology.cta')}
      onContinue={onContinue}
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.background }]}>
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
      </View>
    </AjInterstitialLayout>
  );
}
